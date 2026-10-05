import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { FastifyRequest } from "fastify";
import { bookingService } from "../../services/booking-service";
import { BookingUnavailableError } from "../../services/booking-assignment-service";
import { requireAuth } from "../../lib/auth/require-auth";
import { authedErrorResponses, errorResponseSchema } from "../../lib/auth/schemas";
import { paise } from "../../lib/money";
import { utcTimeHhmm } from "../../lib/job-hours";
import { bookingSessionSchema, istDateSchema } from "../../lib/api-schemas";
import { CUSTOMER_BOOKING_FILTERS } from "../../repositories/booking-repository";
import { readMultipartReview } from "../../lib/multipart";
import { reviewMultipartBodySchema, UPLOAD_FORM_FIELDS } from "../../lib/upload-form";
import {
  REVIEW_IMAGE_UPLOAD,
  optimizeReviewImage,
  reviewImageObjectKey,
  resolveReviewImageDisplayUrl,
} from "../../lib/review-image";
import { privateS3 } from "../../lib/s3";
import { extensionFromFilename, validateFileUpload } from "../../lib/file-upload";
import { replyUploadError } from "../../lib/upload-route";
import { resolveProfilePhotoDisplayUrl } from "../../lib/profile-photo";
import { paginatedResponseSchema, paginationQuerySchema } from "../../lib/pagination";

/** What is being booked, where and when — the same fields for booking and the availability check. */
const bookingRequestFields = {
  packageId: z
    .string()
    .uuid()
    .optional()
    .describe("When a package was chosen: saved on the booking and sets price and duration. serviceIds must all be in it."),
  serviceIds: z
    .array(z.string().uuid())
    .min(1)
    .optional()
    .describe("Services being booked; workers are matched on these (and the category). For a package, its services."),
  categoryId: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Optional. Categories are taken from the services; when sent, every selected service must belong to this one (else 400).",
    ),
  addressId: z.string().uuid(),
  bookingType: z.enum(["instant", "scheduled"]),
  scheduledDate: istDateSchema.optional(),
  scheduledStartTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM (24h)")
    .optional(),
};

type BookingRequestBody = {
  packageId?: string;
  serviceIds?: string[];
  scheduledDate?: string;
  bookingType: "instant" | "scheduled";
  scheduledStartTime?: string;
};

function withBookingRequestRules<T extends z.ZodType<BookingRequestBody>>(schema: T) {
  return schema
    .refine((data) => Boolean(data.packageId) || Boolean(data.serviceIds?.length), {
      message: "Send serviceIds (and packageId when a package is chosen)",
      path: ["serviceIds"],
    })
    .refine((data) => data.bookingType !== "scheduled" || (data.scheduledDate && data.scheduledStartTime), {
      message: "scheduledDate and scheduledStartTime are required for scheduled bookings",
      path: ["scheduledDate"],
    });
}

/** Body date/time strings → the Date values the service takes (IST wall-clock stored as UTC fields). */
function toBookingRequest<T extends { scheduledDate?: string; scheduledStartTime?: string }>(body: T) {
  const { scheduledDate, scheduledStartTime, ...rest } = body;
  return {
    ...rest,
    scheduledDate: scheduledDate ? new Date(`${scheduledDate}T00:00:00Z`) : undefined,
    scheduledStartTime: scheduledStartTime ? new Date(`1970-01-01T${scheduledStartTime}:00Z`) : undefined,
  };
}

const createBookingBodySchema = withBookingRequestRules(
  z.object({
    ...bookingRequestFields,
    paymentMethod: z.enum(["card", "upi", "wallet", "netbanking"]),
    couponCode: z.string().min(3).max(20).optional(),
    totalPricePaise: z.number().int().nonnegative().optional(),
  }),
);

const availabilityBodySchema = withBookingRequestRules(z.object(bookingRequestFields));

const availabilityResponseSchema = z.object({
  available: z.boolean(),
  availableWorkers: z.number().int().describe("Workers free for the whole slot (0 when unavailable)"),
  code: z
    .enum(["ZONE_NOT_SERVICEABLE", "OUTSIDE_JOB_HOURS", "NO_WORKER_IN_ZONE", "NO_WORKER_AVAILABLE"])
    .nullable()
    .describe("Why it is unavailable; null when available"),
  message: z.string().describe("Ready to show the customer"),
  slot: z.object({
    date: z.string().describe("IST, YYYY-MM-DD"),
    startTime: z.string().describe("IST, HH:mm"),
    endTime: z.string().describe("IST, HH:mm"),
    startsAt: z.string(),
    endsAt: z.string(),
    durationMinutes: z.number().int(),
  }),
});

/** 4xx for a booking request the customer has to fix (shared by booking and availability). */
function bookingRequestError(err: unknown): { status: 400 | 404; error: string } | null {
  if (!(err instanceof Error)) return null;
  switch (err.message) {
    case "ADDRESS_NOT_FOUND":
      return { status: 404, error: "Address not found" };
    case "SERVICES_REQUIRED":
      return { status: 400, error: "Send serviceIds (and packageId when a package is chosen)" };
    case "PACKAGE_SERVICE_MISMATCH":
      return { status: 400, error: "The selected services aren't part of this package" };
    case "INVALID_PACKAGE":
    case "INVALID_SERVICE":
      return { status: 400, error: "Selected package or service is not valid" };
    case "CATEGORY_MISMATCH":
      return { status: 400, error: "The selected services don't belong to this category" };
    case "SCHEDULE_REQUIRED":
    case "SCHEDULE_IN_PAST":
      return { status: 400, error: "Choose a valid future date and time" };
    default:
      return null;
  }
}

const serviceRefSchema = z.object({ id: z.string().uuid(), name: z.string() });
const packageRefSchema = z
  .object({ id: z.string().uuid(), name: z.string(), durationMinutes: z.number().int() })
  .nullable();
const completionOutcomeSchema = z.enum(["completed", "ended_early"]);
const providerRefSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string().nullable(),
  phoneNumber: z.string(),
  profilePhotoUrl: z.string().nullable(),
});
const assignedProviderSchema = providerRefSchema.nullable();
const helperDetailSchema = providerRefSchema
  .extend({
    avgRating: z.number(),
    totalJobsCompleted: z.number().int(),
  })
  .nullable();
const reviewResponseSchema = z.object({
  reviewId: z.string().uuid(),
  rating: z.number().int(),
  description: z.string().nullable(),
  comment: z.string().nullable(),
  tags: z.array(z.string()),
  imageUrl: z.string().nullable(),
});

const createBookingResponseSchema = z.object({
  bookingId: z.string().uuid(),
  status: z.string(),
  totalPricePaise: z.number().int(),
  discountPaise: z.number().int(),
  chargedFromWallet: z.boolean(),
  clientSecret: z.string().nullable(),
  sessionOtp: z.string(),
  assignedProvider: assignedProviderSchema,
});

const bookingDetailSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  bookingType: z.enum(["instant", "scheduled"]),
  scheduledDate: z.string().nullable(),
  scheduledStartTime: z.string().nullable(),
  services: z.array(serviceRefSchema),
  package: packageRefSchema,
  basePricePaise: z.number().int(),
  discountPaise: z.number().int(),
  couponCode: z.string().nullable(),
  totalPricePaise: z.number().int(),
  cancellationFeePaise: z.number().int().nullable(),
  sessionOtp: z.string().nullable(),
  assignedProvider: helperDetailSchema,
  hasReview: z.boolean(),
  canRate: z.boolean(),
  completionOutcome: completionOutcomeSchema.nullable(),
  review: reviewResponseSchema.nullable(),
  session: bookingSessionSchema.nullable(),
  createdAt: z.string(),
});

const bookingListItemSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  services: z.array(serviceRefSchema),
  packageName: z.string().nullable(),
  totalPricePaise: z.number().int(),
  scheduledDate: z.string().nullable(),
  createdAt: z.string(),
});

const cancelBookingBodySchema = z.object({ reason: z.string().max(500).optional() });

const cancelBookingResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  cancellationFeePaise: z.number().int().nullable(),
});

const reviewTagsSchema = z.array(z.string().trim().min(1).max(40)).max(8);

function parseReviewTags(value: unknown): string[] {
  let list: unknown[] = [];
  if (Array.isArray(value)) {
    list = value;
  } else if (typeof value === "string" && value.trim()) {
    const raw = value.trim();
    if (raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw);
        list = Array.isArray(parsed) ? parsed : [];
      } catch {
        list = [];
      }
    } else {
      list = raw.split(",").map((tag) => tag.trim()).filter(Boolean);
    }
  }
  const parsed = reviewTagsSchema.safeParse(list);
  return parsed.success ? parsed.data : [];
}

const reviewFieldsSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  description: z.string().max(1000).optional(),
  comment: z.string().max(1000).optional(),
  tags: z.union([z.array(z.string()), z.string()]).optional(),
});

const completeSessionBodySchema = z.object({
  outcome: completionOutcomeSchema,
});

const customerJobCompleteSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  outcome: completionOutcomeSchema,
  canRate: z.boolean(),
  startedAt: z.string(),
  completedAt: z.string(),
  durationMinutes: z.number().int(),
  elapsedSeconds: z.number().int().nonnegative(),
  services: z.array(serviceRefSchema),
  package: packageRefSchema,
  category: z.object({ id: z.string().uuid(), name: z.string() }),
  address: z
    .object({
      formattedAddress: z.string().nullable(),
      line1: z.string(),
      city: z.string().nullable(),
    })
    .passthrough(),
  scheduledDate: z.string().nullable(),
  scheduledStartTime: z.string().nullable(),
  totalPricePaise: z.number().int(),
  provider: helperDetailSchema,
});

async function parseReviewInput(request: FastifyRequest) {
  const isMultipart = String(request.headers["content-type"] ?? "").includes("multipart/form-data");
  const upload = isMultipart ? await readMultipartReview(request) : undefined;
  const parsed = reviewFieldsSchema.safeParse(
    upload
      ? { rating: upload.rating, description: upload.description, comment: upload.comment, tags: upload.tags }
      : request.body,
  );
  if (!parsed.success) throw new Error("INVALID_REVIEW");
  return {
    rating: parsed.data.rating,
    description: parsed.data.description || parsed.data.comment,
    tags: parseReviewTags(parsed.data.tags),
    file: upload?.file,
  };
}

async function toBookingDetail(booking: Awaited<ReturnType<typeof bookingService.getBooking>>) {
  const assigned = booking.assignments[0]?.provider;
  const review = booking.review;
  const [profilePhotoUrl, reviewImageUrl] = await Promise.all([
    assigned ? resolveProfilePhotoDisplayUrl(assigned.profilePhotoUrl) : Promise.resolve(null),
    review ? resolveReviewImageDisplayUrl(review.imageUrl) : Promise.resolve(null),
  ]);
  return {
    id: booking.id,
    status: booking.status,
    bookingType: booking.bookingType,
    scheduledDate: booking.scheduledDate?.toISOString() ?? null,
    scheduledStartTime: utcTimeHhmm(booking.scheduledStartTime),
    services: booking.services,
    package: booking.plan
      ? { id: booking.plan.id, name: booking.plan.name, durationMinutes: booking.plan.durationMinutes }
      : null,
    basePricePaise: paise(booking.basePricePaise),
    discountPaise: paise(booking.discountPaise),
    couponCode: booking.couponCode,
    totalPricePaise: paise(booking.totalPricePaise),
    cancellationFeePaise: booking.cancellationFeePaise === null ? null : paise(booking.cancellationFeePaise),
    sessionOtp: booking.sessionOtp,
    assignedProvider: assigned
      ? {
          id: assigned.id,
          fullName: assigned.fullName,
          phoneNumber: assigned.phoneNumber,
          profilePhotoUrl,
          avgRating: Number(assigned.avgRating),
          totalJobsCompleted: assigned.totalJobsCompleted,
        }
      : null,
    hasReview: review !== null,
    canRate: booking.status === "completed" && review === null,
    completionOutcome: booking.customerCompletionOutcome,
    review: review
      ? {
          reviewId: review.id,
          rating: review.rating,
          description: review.comment,
          comment: review.comment,
          tags: review.tags,
          imageUrl: reviewImageUrl,
        }
      : null,
    session: booking.session,
    createdAt: booking.createdAt.toISOString(),
  };
}

export const customerBookingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/customer/bookings/availability",
    {
      preHandler: requireAuth("customer"),
      schema: {
        tags: ["Customer Bookings"],
        summary: "Check whether workers are available before booking",
        description:
          "Runs the same checks as creating a booking, without booking or charging anything: the address is in a coverage zone, " +
          "the whole job fits the admin job hours (IST), and workers who offer the category or one of the selected services " +
          "are free for the whole slot (with a 30-minute rest gap). " +
          "For a package, send packageId with its serviceIds; the slot then uses the package duration. " +
          "Always 200 with `available`, `availableWorkers`, a `code` when unavailable, and a customer-facing `message`. " +
          "4xx only for a request to fix (unknown address, invalid services, services outside `categoryId`, a past time). " +
          "Availability can change before the booking is made; creating the booking re-checks everything.",
        security: [{ bearerAuth: [] }],
        body: availabilityBodySchema,
        response: {
          ...authedErrorResponses,
          200: availabilityResponseSchema,
          400: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await bookingService.checkAvailability(request.auth!.id, toBookingRequest(request.body));
      } catch (err) {
        const invalid = bookingRequestError(err);
        if (invalid) return reply.code(invalid.status).send({ error: invalid.error });
        throw err;
      }
    },
  );

  app.post(
    "/customer/bookings",
    {
      preHandler: requireAuth("customer"),
      schema: {
        tags: ["Customer Bookings"],
        summary: "Create a booking (instant or scheduled), charge wallet if needed, and assign a nearby worker",
        description:
          "Send serviceIds (one or more catalog services); when the customer chose a package, also send packageId, and serviceIds must be that package's services " +
          "(packageId alone still works and means all of its services). " +
          "A worker is assigned before the wallet is charged: they must belong to a coverage zone containing the address, " +
          "offer the service, and be free (with a 30-minute rest gap) for the whole job, which must fit inside admin job hours (IST). " +
          "A worker matches when their services include the category or one of the selected services; send `categoryId` to have it checked. " +
          "Otherwise nothing is charged and the response is 422 ZONE_NOT_SERVICEABLE, 400 OUTSIDE_JOB_HOURS, 422 NO_WORKER_IN_ZONE or 409 NO_WORKER_AVAILABLE " +
          "(`message` holds the code, `error` a customer-facing message).",
        security: [{ bearerAuth: [] }],
        body: createBookingBodySchema,
        response: {
          ...authedErrorResponses,
          201: createBookingResponseSchema,
          400: errorResponseSchema,
          402: errorResponseSchema,
          409: errorResponseSchema,
          422: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await bookingService.createBooking(request.auth!.id, toBookingRequest(request.body));
        return reply.code(201).send({
          ...result,
          totalPricePaise: paise(result.totalPricePaise),
          discountPaise: paise(result.discountPaise),
        });
      } catch (err) {
        if (err instanceof BookingUnavailableError) {
          const status =
            err.code === "OUTSIDE_JOB_HOURS"
              ? 400
              : err.code === "NO_WORKER_IN_ZONE" || err.code === "ZONE_NOT_SERVICEABLE"
                ? 422
                : 409;
          return reply.code(status).send({ error: err.publicMessage, message: err.code });
        }
        const invalid = bookingRequestError(err);
        if (invalid) return reply.code(invalid.status).send({ error: invalid.error });
        if (!(err instanceof Error)) throw err;
        if (err.message === "INSUFFICIENT_WALLET_BALANCE") {
          return reply.code(402).send({ error: "Wallet balance is not enough for this booking" });
        }
        if (err.message === "PAYMENT_GATEWAY_UNAVAILABLE") {
          return reply.code(400).send({ error: "Card and UPI payments are not available yet. Pay with wallet." });
        }
        if (err.message === "PRICE_MISMATCH") {
          return reply.code(400).send({ error: "Price does not match the current service total" });
        }
        if (
          err.message === "COUPON_NOT_FOUND" ||
          err.message === "COUPON_INACTIVE" ||
          err.message === "COUPON_EXPIRED" ||
          err.message === "COUPON_EXHAUSTED" ||
          err.message === "COUPON_NOT_APPLICABLE" ||
          err.message === "INVALID_CODE"
        ) {
          return reply.code(err.message === "COUPON_NOT_FOUND" ? 404 : 400).send({
            error: "This coupon cannot be applied",
          });
        }
        throw err;
      }
    },
  );

  app.get(
    "/customer/bookings/:bookingId",
    {
      preHandler: requireAuth("customer"),
      schema: {
        tags: ["Customer Bookings"],
        summary: "Get a single booking's details",
        security: [{ bearerAuth: [] }],
        params: z.object({ bookingId: z.string().uuid() }),
        response: { ...authedErrorResponses, 200: bookingDetailSchema },
      },
    },
    async (request, reply) => {
      try {
        const booking = await bookingService.getBooking(request.auth!.id, request.params.bookingId);
        return toBookingDetail(booking);
      } catch (err) {
        if (err instanceof Error && err.message === "BOOKING_NOT_FOUND") {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.get(
    "/customer/bookings/:bookingId/session",
    {
      preHandler: requireAuth("customer"),
      schema: {
        tags: ["Customer Bookings"],
        summary: "Active session: remaining timer and checklist",
        description:
          "Poll after the worker verifies OTP. Remaining time is computed from startedAt plus snapshot session minutes. Checklist status is done, in_progress (current task), or pending.",
        security: [{ bearerAuth: [] }],
        params: z.object({ bookingId: z.string().uuid() }),
        response: {
          ...authedErrorResponses,
          200: z
            .object({
              id: z.string().uuid(),
              status: z.string(),
              services: z.array(serviceRefSchema),
              package: packageRefSchema,
              provider: assignedProviderSchema,
              canComplete: z.boolean(),
              canRate: z.boolean(),
              completionOutcome: completionOutcomeSchema.nullable(),
            })
            .merge(bookingSessionSchema),
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await bookingService.getSession(request.auth!.id, request.params.bookingId);
      } catch (err) {
        if (err instanceof Error && err.message === "BOOKING_NOT_FOUND") {
          return reply.code(404).send({ error: err.message });
        }
        if (err instanceof Error && err.message === "SESSION_NOT_STARTED") {
          return reply.code(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.post(
    "/customer/bookings/:bookingId/complete",
    {
      preHandler: requireAuth("customer"),
      schema: {
        tags: ["Customer Bookings"],
        summary: "Mark the session complete or end it early",
        description:
          "outcome=completed (Session Complete — Rate Now) or ended_early. Stores the customer completion state, completes the job if the worker has not already, and notifies the helper.",
        security: [{ bearerAuth: [] }],
        params: z.object({ bookingId: z.string().uuid() }),
        body: completeSessionBodySchema,
        response: {
          ...authedErrorResponses,
          200: customerJobCompleteSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await bookingService.completeSession(
          request.auth!.id,
          request.params.bookingId,
          request.body.outcome,
        );
      } catch (err) {
        if (err instanceof Error && err.message === "BOOKING_NOT_FOUND") {
          return reply.code(404).send({ error: err.message });
        }
        if (
          err instanceof Error &&
          (err.message === "SESSION_NOT_STARTED" ||
            err.message === "SESSION_NOT_ACTIVE" ||
            err.message === "SESSION_ALREADY_COMPLETED")
        ) {
          return reply.code(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.get(
    "/customer/bookings",
    {
      preHandler: requireAuth("customer"),
      schema: {
        tags: ["Customer Bookings"],
        summary: "List the customer's booking history",
        description:
          "filter=scheduled (not started), in_progress, completed (completed/paid), cancelled (cancelled/no_provider/disputed). upcoming (default) is scheduled+in_progress; past is completed+cancelled. " +
          "Paginated, newest first: `page` (default 1) and `limit` (default 20, max 100); `total`/`totalPages` count everything matching the filter.",
        security: [{ bearerAuth: [] }],
        querystring: paginationQuerySchema.extend({
          filter: z.enum(CUSTOMER_BOOKING_FILTERS).default("upcoming"),
        }),
        response: { ...authedErrorResponses, 200: paginatedResponseSchema(bookingListItemSchema) },
      },
    },
    async (request) => {
      const { filter, page, limit } = request.query;
      const result = await bookingService.listBookings(request.auth!.id, filter, { page, limit });
      return {
        ...result,
        items: result.items.map((booking) => ({
        id: booking.id,
        status: booking.status,
        services: booking.services,
        packageName: booking.plan?.name ?? null,
        totalPricePaise: paise(booking.totalPricePaise),
        scheduledDate: booking.scheduledDate?.toISOString() ?? null,
        createdAt: booking.createdAt.toISOString(),
      })),
      };
    },
  );

  app.post(
    "/customer/bookings/:bookingId/cancel",
    {
      preHandler: requireAuth("customer"),
      schema: {
        tags: ["Customer Bookings"],
        summary: "Cancel a booking",
        security: [{ bearerAuth: [] }],
        params: z.object({ bookingId: z.string().uuid() }),
        body: cancelBookingBodySchema,
        response: { ...authedErrorResponses, 200: cancelBookingResponseSchema, 409: errorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const booking = await bookingService.cancelBooking(request.auth!.id, request.params.bookingId, request.body.reason);
        return {
          id: booking.id,
          status: booking.status,
          cancellationFeePaise: booking.cancellationFeePaise === null ? null : paise(booking.cancellationFeePaise),
        };
      } catch (err) {
        if (err instanceof Error && err.message === "BOOKING_NOT_FOUND") {
          return reply.code(404).send({ error: err.message });
        }
        if (err instanceof Error && err.message === "BOOKING_NOT_CANCELLABLE") {
          return reply.code(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  const rateWorker = {
    preHandler: requireAuth("customer"),
    schema: {
      tags: ["Customer Bookings"],
      summary: "Rate the helper after the session is complete",
      description: [
        "JSON: { rating: 1-5, description?: string, tags?: string[] } (`comment` is an alias of description).",
        "tags are optional 'what went well' labels (On time, Professional, etc.).",
        `Multipart: rating, description, tags (comma-separated or JSON), optional ${UPLOAD_FORM_FIELDS.file} (JPG, PNG, or WebP, max 5 MB).`,
      ].join(" "),
      security: [{ bearerAuth: [] }],
      consumes: ["application/json", "multipart/form-data"],
      params: z.object({ bookingId: z.string().uuid() }),
      body: reviewMultipartBodySchema,
      response: {
        ...authedErrorResponses,
        201: reviewResponseSchema,
        400: errorResponseSchema,
        409: errorResponseSchema,
      },
    },
  };

  const submitWorkerRating = async (
    request: Parameters<typeof parseReviewInput>[0] & { auth?: { id: string }; params: { bookingId: string } },
    reply: Parameters<typeof replyUploadError>[0],
  ) => {
      try {
        const input = await parseReviewInput(request);
        let imageUrl: string | undefined;
        if (input.file) {
          validateFileUpload(
            input.file.mimetype,
            extensionFromFilename(input.file.filename),
            input.file.buffer.length,
            REVIEW_IMAGE_UPLOAD,
          );
          const optimized = await optimizeReviewImage(input.file.buffer);
          imageUrl = reviewImageObjectKey(request.params.bookingId, privateS3.newFileId());
          await privateS3.upload(imageUrl, optimized.buffer, optimized.contentType);
        }
        const review = await bookingService.addReview(request.auth!.id, request.params.bookingId, {
          rating: input.rating,
          description: input.description,
          tags: input.tags,
          imageUrl,
        });
        return reply.code(201).send({
          reviewId: review.id,
          rating: review.rating,
          description: review.comment,
          comment: review.comment,
          tags: review.tags,
          imageUrl: await resolveReviewImageDisplayUrl(review.imageUrl),
        });
      } catch (err) {
        if (replyUploadError(reply, err)) return;
        if (err instanceof Error && err.message === "INVALID_REVIEW") {
          return reply.code(400).send({ error: err.message });
        }
        if (err instanceof Error && err.message === "BOOKING_NOT_FOUND") {
          return reply.code(404).send({ error: err.message });
        }
        if (
          err instanceof Error &&
          (err.message === "BOOKING_NOT_COMPLETED" || err.message === "ALREADY_REVIEWED" || err.message === "NO_PROVIDER_ASSIGNED")
        ) {
          return reply.code(409).send({ error: err.message });
        }
        throw err;
      }
    };

  app.post("/customer/bookings/:bookingId/rate", rateWorker, submitWorkerRating);
  app.post("/customer/bookings/:bookingId/review", rateWorker, submitWorkerRating);
};

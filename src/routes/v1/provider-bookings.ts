import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../lib/auth/require-auth";
import { authedErrorResponses, errorResponseSchema } from "../../lib/auth/schemas";
import { providerBookingService } from "../../services/provider-booking-service";
import { bookingSessionSchema, istDateSchema, updateChecklistBodySchema } from "../../lib/api-schemas";
import { PROVIDER_BOOKING_FILTERS } from "../../repositories/booking-repository";
import { readMultipartCompleteJob } from "../../lib/multipart";
import { completeJobMultipartBodySchema, UPLOAD_FORM_FIELDS } from "../../lib/upload-form";
import { replyUploadError } from "../../lib/upload-route";
import { indiaClock } from "../../lib/job-hours";
import { paginatedResponseSchema, paginationQuerySchema } from "../../lib/pagination";

const bookingIdParamsSchema = z.object({ bookingId: z.string().uuid() });
const listQuerySchema = paginationQuerySchema.extend({
  filter: z.enum(PROVIDER_BOOKING_FILTERS).default("all"),
});
const startSessionBodySchema = z.object({
  otp: z.string().regex(/^\d{4}$/, "expected 4-digit OTP"),
});

const serviceRefSchema = z.object({ id: z.string().uuid(), name: z.string() });
const packageRefSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    durationMinutes: z.number().int(),
  })
  .nullable();
const customerRefSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string().nullable(),
  phoneNumber: z.string(),
  profilePhotoUrl: z.string().nullable(),
});
const customerSchema = customerRefSchema.extend({
  verified: z.boolean(),
  floorNumber: z.number().int().nullable(),
});
const addressSchema = z.object({
  id: z.string().uuid(),
  label: z.string().nullable(),
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  pincode: z.string().nullable(),
  formattedAddress: z.string().nullable(),
  latitude: z.number(),
  longitude: z.number(),
});
const paymentSchema = z.object({
  status: z.string().nullable(),
  method: z.string().nullable(),
  prepaid: z.boolean(),
});
const categorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  iconUrl: z.string().nullable(),
});

const providerBookingListItemSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  bookingType: z.enum(["instant", "scheduled"]),
  scheduledDate: z.string().nullable(),
  scheduledStartTime: z.string().nullable(),
  scheduledEndTime: z.string().nullable(),
  durationMinutes: z.number().int().nullable(),
  totalPricePaise: z.number().int(),
  services: z.array(serviceRefSchema),
  package: packageRefSchema,
  category: categorySchema,
  customer: customerSchema,
  address: addressSchema,
  payment: paymentSchema,
  createdAt: z.string(),
});

const locationQueryFields = {
  lat: z.coerce.number().min(-90).max(90).optional().describe("Live latitude, for distances"),
  lng: z.coerce.number().min(-180).max(180).optional().describe("Live longitude, for distances"),
};
const bothOrNeither = (query: { lat?: number; lng?: number }) =>
  (query.lat === undefined) === (query.lng === undefined);
const bothOrNeitherError = { message: "Send both lat and lng, or neither", path: ["lat"] };

const calendarQuerySchema = z
  .object({ date: istDateSchema.optional(), ...locationQueryFields })
  .refine(bothOrNeither, bothOrNeitherError);
const homeQuerySchema = z.object(locationQueryFields).refine(bothOrNeither, bothOrNeitherError);

function liveLocation(query: { lat?: number; lng?: number }) {
  return query.lat !== undefined && query.lng !== undefined ? { lat: query.lat, lng: query.lng } : undefined;
}

const calendarJobSchema = providerBookingListItemSchema.extend({
  calendarStatus: z.enum(["upcoming", "en_route", "in_progress", "completed", "cancelled"]),
  timing: z.enum(["on_time", "late"]).nullable(),
  title: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  durationMinutes: z.number().int(),
  shortAddress: z.string(),
  distanceKm: z.number().nullable(),
  earningsPaise: z.number().int().nullable(),
});

const calendarResponseSchema = z.object({
  date: z.string(),
  summary: z.object({
    total: z.number().int(),
    upcoming: z.number().int(),
    inProgress: z.number().int(),
    completed: z.number().int(),
    cancelled: z.number().int(),
  }),
  jobs: z.array(calendarJobSchema),
});

const homeResponseSchema = z.object({
  nextJob: calendarJobSchema
    .nullable()
    .describe("The job underway, else the soonest one not ended yet (any day); null when there is none"),
  rating: z.object({
    average: z.number().nullable().describe("Average review rating, 1 decimal; null before the first review"),
    reviewCount: z.number().int(),
    minimumRequired: z.number().describe("Minimum average needed to keep receiving jobs"),
    meetsMinimum: z.boolean().nullable(),
  }),
  todaySchedule: z.object({
    date: z.string().describe("Today, IST (YYYY-MM-DD) — pass to /provider/bookings/calendar for View all"),
    total: z.number().int().describe("All of today's jobs, cancelled included (same as the calendar's summary.total)"),
    jobs: z.array(calendarJobSchema).describe("Up to 3 jobs around the current time, in time order"),
  }),
});

const providerBookingDetailSchema = providerBookingListItemSchema.extend({
  basePricePaise: z.number().int(),
  startedAt: z.string().nullable(),
  canStartSession: z.boolean(),
  session: bookingSessionSchema.nullable(),
});

const providerSessionSchema = z
  .object({
    id: z.string().uuid(),
    status: z.string(),
    services: z.array(serviceRefSchema),
    package: packageRefSchema,
    category: categorySchema,
    customer: customerRefSchema,
    address: z.object({
      formattedAddress: z.string().nullable(),
      line1: z.string(),
      city: z.string().nullable(),
    }),
  })
  .merge(bookingSessionSchema);

const providerJobCompleteSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  startedAt: z.string(),
  completedAt: z.string(),
  job: z.object({
    services: z.array(serviceRefSchema),
    package: packageRefSchema,
    category: categorySchema,
    address: addressSchema,
  }),
  customer: customerRefSchema,
  durationMinutes: z.number().int(),
  elapsedSeconds: z.number().int().nonnegative(),
  overtimeMinutes: z.number().int(),
  earningsPaise: z.number().int().describe("Worker's share of the captured payment, in paise (not the customer price)"),
  selfieUrl: z.string().nullable(),
  completionPhotoUrl: z.string().nullable(),
});

function replyProviderBookingError(reply: FastifyReply, err: unknown) {
  if (!(err instanceof Error)) throw err;
  if (err.message === "BOOKING_NOT_FOUND" || err.message === "CHECKLIST_ITEM_NOT_FOUND") {
    return reply.code(404).send({ error: err.message });
  }
  if (err.message === "INVALID_SESSION_OTP") {
    return reply.code(400).send({ error: err.message });
  }
  if (
    err.message === "BOOKING_NOT_STARTABLE" ||
    err.message === "SESSION_OTP_MISSING" ||
    err.message === "SESSION_NOT_STARTED" ||
    err.message === "SESSION_NOT_ACTIVE" ||
    err.message === "SESSION_ALREADY_COMPLETED"
  ) {
    return reply.code(409).send({ error: err.message });
  }
  throw err;
}

export const providerBookingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/provider/bookings",
    {
      preHandler: requireAuth("provider"),
      schema: {
        tags: ["Provider Bookings"],
        summary: "List jobs assigned to the authenticated worker",
        description:
          "filter=scheduled (assigned/en_route), in_progress, completed (completed/paid), cancelled (cancelled/no_provider/disputed). all is the default. upcoming/missed/done remain as aliases. " +
          "Paginated, soonest scheduled first: `page` (default 1) and `limit` (default 20, max 100); `total`/`totalPages` count everything matching the filter.",
        security: [{ bearerAuth: [] }],
        querystring: listQuerySchema,
        response: { ...authedErrorResponses, 200: paginatedResponseSchema(providerBookingListItemSchema) },
      },
    },
    async (request) => {
      const { filter, page, limit } = request.query;
      return providerBookingService.list(request.auth!.id, filter, { page, limit });
    },
  );

  app.get(
    "/provider/bookings/calendar",
    {
      preHandler: requireAuth("provider"),
      schema: {
        tags: ["Provider Bookings"],
        summary: "Job calendar: the worker's jobs on one day",
        description:
          "Upcoming (assigned / en_route), in-progress, completed and cancelled jobs on `date` (IST, YYYY-MM-DD; defaults to today), " +
          "sorted by start time. A job's day is its scheduled date, or the day an instant booking was made. " +
          "`startTime`/`endTime` are IST HH:mm; `startsAt`/`endsAt` are exact UTC instants. " +
          "`calendarStatus` drives the badge; `timing` is on_time/late against the booked start (10-minute grace), null when not applicable. " +
          "`distanceKm` is from `lat`/`lng` if sent (live location), else the worker's last reported location, else null. " +
          "`totalPricePaise` is the booking price, `earningsPaise` the worker's share. " +
          "`summary.total` counts every job listed, cancelled included; `summary.cancelled` counts those.",
        security: [{ bearerAuth: [] }],
        querystring: calendarQuerySchema,
        response: { ...authedErrorResponses, 200: calendarResponseSchema },
      },
    },
    async (request) =>
      providerBookingService.calendar(
        request.auth!.id,
        request.query.date ?? indiaClock().date,
        liveLocation(request.query),
      ),
  );

  app.get(
    "/provider/home",
    {
      preHandler: requireAuth("provider"),
      schema: {
        tags: ["Provider Home"],
        summary: "Worker home screen: next job, rating, and today's schedule",
        description:
          "`nextJob` is the job underway, otherwise the soonest assigned job that hasn't ended yet (it can be on a later day); null when none. " +
          "`rating` is the live average of the worker's reviews against the 4.0 minimum. " +
          "`todaySchedule.jobs` holds up to 3 of today's jobs around the current time (the latest one already started, then the next ones), " +
          "including completed and cancelled ones; `total` counts all of today's. For View all, call GET /provider/bookings/calendar?date={todaySchedule.date}. " +
          "Job objects are the same as the calendar's. Send `lat`/`lng` (live location) for distances, else the last reported location is used.",
        security: [{ bearerAuth: [] }],
        querystring: homeQuerySchema,
        response: { ...authedErrorResponses, 200: homeResponseSchema },
      },
    },
    async (request) => providerBookingService.home(request.auth!.id, liveLocation(request.query)),
  );

  app.get(
    "/provider/bookings/:bookingId",
    {
      preHandler: requireAuth("provider"),
      schema: {
        tags: ["Provider Bookings"],
        summary: "Get a job assigned to the authenticated worker",
        security: [{ bearerAuth: [] }],
        params: bookingIdParamsSchema,
        response: { ...authedErrorResponses, 200: providerBookingDetailSchema },
      },
    },
    async (request, reply) => {
      try {
        return await providerBookingService.getById(request.auth!.id, request.params.bookingId);
      } catch (err) {
        return replyProviderBookingError(reply, err);
      }
    },
  );

  app.post(
    "/provider/bookings/:bookingId/start",
    {
      preHandler: requireAuth("provider"),
      schema: {
        tags: ["Provider Bookings"],
        summary: "Verify the customer's 4-digit session OTP and start the job",
        description:
          "Ask the customer for the OTP shown on their booking. Succeeds only while the job is assigned or en_route. Starts the session timer from the booked sub-service session minutes (or package duration) and seeds the included-task checklist.",
        security: [{ bearerAuth: [] }],
        params: bookingIdParamsSchema,
        body: startSessionBodySchema,
        response: {
          ...authedErrorResponses,
          200: providerSessionSchema,
          400: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await providerBookingService.startSession(
          request.auth!.id,
          request.params.bookingId,
          request.body.otp,
        );
      } catch (err) {
        return replyProviderBookingError(reply, err);
      }
    },
  );

  app.get(
    "/provider/bookings/:bookingId/session",
    {
      preHandler: requireAuth("provider"),
      schema: {
        tags: ["Provider Bookings"],
        summary: "Active job session: remaining timer and checklist",
        description:
          "Poll this after OTP verification. Remaining time is computed from startedAt plus the snapshot session minutes, never stored.",
        security: [{ bearerAuth: [] }],
        params: bookingIdParamsSchema,
        response: {
          ...authedErrorResponses,
          200: providerSessionSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await providerBookingService.getSession(request.auth!.id, request.params.bookingId);
      } catch (err) {
        return replyProviderBookingError(reply, err);
      }
    },
  );

  app.patch(
    "/provider/bookings/:bookingId/checklist",
    {
      preHandler: requireAuth("provider"),
      schema: {
        tags: ["Provider Bookings"],
        summary: "Mark a session checklist item done or not done",
        security: [{ bearerAuth: [] }],
        params: bookingIdParamsSchema,
        body: updateChecklistBodySchema,
        response: {
          ...authedErrorResponses,
          200: providerSessionSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await providerBookingService.updateChecklist(
          request.auth!.id,
          request.params.bookingId,
          request.body.itemId,
          request.body.done,
        );
      } catch (err) {
        return replyProviderBookingError(reply, err);
      }
    },
  );

  app.post(
    "/provider/bookings/:bookingId/complete",
    {
      preHandler: requireAuth("provider"),
      schema: {
        tags: ["Provider Bookings"],
        summary: "Upload the worker selfie and mark the session complete",
        description: [
          "Send multipart/form-data after the worker taps Submit & Complete Job.",
          `Required: ${UPLOAD_FORM_FIELDS.selfie} (JPG, PNG, or WebP, max 5 MB; also accepts file).`,
          `Optional: ${UPLOAD_FORM_FIELDS.completionPhoto} of the finished service.`,
          "Job must be in_progress. Freezes the session timer, stores overtime minutes, and notifies the customer.",
        ].join(" "),
        security: [{ bearerAuth: [] }],
        consumes: ["multipart/form-data"],
        params: bookingIdParamsSchema,
        body: completeJobMultipartBodySchema,
        response: {
          ...authedErrorResponses,
          200: providerJobCompleteSchema,
          400: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const files = await readMultipartCompleteJob(request);
        return await providerBookingService.completeSession(request.auth!.id, request.params.bookingId, files);
      } catch (err) {
        if (replyUploadError(reply, err)) return;
        return replyProviderBookingError(reply, err);
      }
    },
  );
};

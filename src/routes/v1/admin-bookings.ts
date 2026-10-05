import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../../lib/auth/require-auth";
import { requireAnyPermission } from "../../lib/auth/permissions";
import { authedErrorResponses, errorResponseSchema } from "../../lib/auth/schemas";
import { bookingAdminListStatsSchema, mapPointSchema } from "../../lib/api-schemas";
import { paginatedResponseSchema } from "../../lib/pagination";
import { statusListQuerySchema } from "../../lib/status-list-query";
import { adminBookingService } from "../../services/admin-booking-service";

const BOOKING_STATUSES = [
  "draft",
  "confirmed",
  "searching",
  "assigned",
  "no_provider",
  "en_route",
  "in_progress",
  "completed",
  "disputed",
  "paid",
  "cancelled",
] as const;

const bookingListQuerySchema = statusListQuerySchema(BOOKING_STATUSES);

const bookingIdParamsSchema = z.object({ id: z.string().uuid() });
const assignBodySchema = z.object({ providerId: z.string().uuid() });

const providerRefSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string().nullable(),
  phoneNumber: z.string(),
  email: z.string().nullable(),
  status: z.string(),
  isAvailable: z.boolean(),
});

const assignmentSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  offerSequence: z.number().int(),
  offeredAt: z.coerce.date(),
  respondedAt: z.coerce.date().nullable(),
  expiresAt: z.coerce.date(),
  provider: providerRefSchema,
});

const adminBookingListItemSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  bookingType: z.enum(["instant", "scheduled"]),
  scheduledDate: z.coerce.date().nullable(),
  totalPricePaise: z.number().int(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  customer: z.object({
    id: z.string().uuid(),
    fullName: z.string().nullable(),
    phoneNumber: z.string(),
  }),
  city: z.string().nullable(),
  category: z.object({ id: z.string().uuid(), name: z.string() }),
  services: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  plan: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  assignedProvider: z
    .object({
      assignmentId: z.string().uuid(),
      provider: z.object({
        id: z.string().uuid(),
        fullName: z.string().nullable(),
        phoneNumber: z.string(),
      }),
    })
    .nullable(),
  paymentStatus: z.string().nullable(),
  paymentMethod: z.string().nullable(),
});

const adminBookingDetailSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  bookingType: z.enum(["instant", "scheduled"]),
  scheduledDate: z.coerce.date().nullable(),
  scheduledStartTime: z.coerce.date().nullable(),
  basePricePaise: z.number().int(),
  totalPricePaise: z.number().int(),
  overtimeRatePaise: z.number().int(),
  overtimeMinutes: z.number().int(),
  cancellationFeePaise: z.number().int().nullable(),
  cancelledBy: z.string().nullable(),
  cancellationReason: z.string().nullable(),
  startedAt: z.coerce.date().nullable(),
  completedAt: z.coerce.date().nullable(),
  slaDeadlineAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  customer: z.object({
    id: z.string().uuid(),
    fullName: z.string().nullable(),
    phoneNumber: z.string(),
    email: z.string().nullable(),
    status: z.string(),
  }),
  address: z.object({
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
    isDefault: z.boolean(),
    isServiceable: z.boolean(),
  }),
  category: z.object({ id: z.string().uuid(), name: z.string() }),
  services: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  plan: z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      durationMinutes: z.number().int(),
      pricePaise: z.number().int(),
    })
    .nullable(),
  assignedProvider: z
    .object({
      assignmentId: z.string().uuid(),
      status: z.string(),
      offeredAt: z.coerce.date(),
      respondedAt: z.coerce.date().nullable(),
      provider: providerRefSchema,
    })
    .nullable(),
  assignments: z.array(assignmentSchema),
  payments: z.array(
    z.object({
      id: z.string().uuid(),
      amountPaise: z.number().int(),
      status: z.string(),
      paymentMethod: z.string().nullable(),
      capturedAt: z.coerce.date().nullable(),
      createdAt: z.coerce.date(),
    }),
  ),
  review: z
    .object({
      id: z.string().uuid(),
      rating: z.number().int(),
      comment: z.string().nullable(),
      createdAt: z.coerce.date(),
    })
    .nullable(),
});

// hasPermission expands bookings:* / bookings:read → booking.view, etc.
const BOOKING_VIEW_PERMISSIONS = ["booking.view"] as const;
const BOOKING_ASSIGN_PERMISSIONS = ["booking.assign", "booking.reassign"] as const;
const BOOKING_CANCEL_PERMISSIONS = ["booking.cancel"] as const;
const cancelBodySchema = z.object({ reason: z.string().trim().max(500).optional() });

export const adminBookingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/admin/bookings",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(BOOKING_VIEW_PERMISSIONS)],
      schema: {
        tags: ["Admin Bookings"],
        summary: "List bookings (CRM)",
        description:
          "Paginated booking directory for CRM roles with booking view access. Includes directory-wide status stats.",
        security: [{ bearerAuth: [] }],
        querystring: bookingListQuerySchema,
        response: {
          200: paginatedResponseSchema(adminBookingListItemSchema).extend({
            stats: bookingAdminListStatsSchema,
            mapPoints: z.array(mapPointSchema),
          }),
          ...authedErrorResponses,
        },
      },
    },
    async (request) => adminBookingService.list(request.query),
  );

  app.get(
    "/admin/bookings/:id",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(BOOKING_VIEW_PERMISSIONS)],
      schema: {
        tags: ["Admin Bookings"],
        summary: "Get booking details (CRM)",
        description:
          "Shared booking detail for all CRM roles with booking view access (dispatcher, platform, operations, support, etc.).",
        security: [{ bearerAuth: [] }],
        params: bookingIdParamsSchema,
        response: {
          200: adminBookingDetailSchema,
          ...authedErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        return await adminBookingService.getById(request.params.id);
      } catch (err) {
        if (err instanceof Error && err.message === "BOOKING_NOT_FOUND") {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.post(
    "/admin/bookings/:id/assign",
    {
      preHandler: [
        requireAuth("admin"),
        requireAnyPermission(BOOKING_ASSIGN_PERMISSIONS),
      ],
      schema: {
        tags: ["Admin Bookings"],
        summary: "Assign or reassign a provider to a booking",
        description:
          "Assign an active provider to a booking. Customer is notified. Replaces any previously accepted assignment.",
        security: [{ bearerAuth: [] }],
        params: bookingIdParamsSchema,
        body: assignBodySchema,
        response: {
          200: adminBookingDetailSchema,
          400: errorResponseSchema,
          409: errorResponseSchema,
          ...authedErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        return await adminBookingService.assignProvider(
          request.params.id,
          request.body.providerId,
        );
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        if (err.message === "BOOKING_NOT_FOUND" || err.message === "PROVIDER_NOT_FOUND") {
          return reply.code(404).send({ error: err.message });
        }
        if (
          err.message === "BOOKING_NOT_ASSIGNABLE" ||
          err.message === "PROVIDER_INACTIVE"
        ) {
          return reply.code(400).send({ error: err.message });
        }
        if (err.message === "PROVIDER_ALREADY_ASSIGNED") {
          return reply.code(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.post(
    "/admin/bookings/:id/cancel",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(BOOKING_CANCEL_PERMISSIONS)],
      schema: {
        tags: ["Admin Bookings"],
        summary: "Cancel a booking",
        description:
          "Cancels the booking, releases assigned/offered workers, and notifies the customer and those workers. " +
          "Completed, paid, disputed, or already-cancelled bookings cannot be cancelled.",
        security: [{ bearerAuth: [] }],
        params: bookingIdParamsSchema,
        body: cancelBodySchema,
        response: {
          200: adminBookingDetailSchema,
          409: errorResponseSchema,
          ...authedErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        return await adminBookingService.cancel(request.params.id, request.body.reason);
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        if (err.message === "BOOKING_NOT_FOUND") {
          return reply.code(404).send({ error: err.message });
        }
        if (err.message === "BOOKING_NOT_CANCELLABLE") {
          return reply.code(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );
};

import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../lib/auth/require-auth";
import { authedErrorResponses, errorResponseSchema } from "../../lib/auth/schemas";
import { meResponseSchema, profilePhotoUploadResponseSchema } from "../../lib/api-schemas";
import { readMultipartFile } from "../../lib/multipart";
import { meService } from "../../services/me-service";
import { notificationService } from "../../services/notification-service";
import { paginationQuerySchema, paginatedResponseSchema } from "../../lib/pagination";
import { profilePhotoMultipartBodySchema } from "../../lib/upload-form";
import { replyUploadError, sendUploadError } from "../../lib/upload-route";

const fcmTokenBodySchema = z.object({
  /** Pass `null` or empty string to clear the token (e.g. on logout). */
  fcmToken: z.string().max(512).nullable(),
});

const fcmTokenResponseSchema = z.object({
  ok: z.literal(true),
  fcmToken: z.string().max(512).nullable(),
});

const notificationItemSchema = z.object({
  id: z.string().uuid(),
  templateKey: z.string(),
  title: z.string(),
  body: z.string(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  status: z.string(),
  sentAt: z.coerce.date().nullable(),
  readAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  unread: z.boolean(),
});

const notificationsQuerySchema = paginationQuerySchema.extend({
  unreadOnly: z
    .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
    .optional()
    .transform((value) => {
      if (value == null) return undefined;
      if (typeof value === "boolean") return value;
      return value === "true" || value === "1";
    }),
});

const okSchema = z.object({ ok: z.literal(true) });
const unreadCountSchema = z.object({ count: z.number().int() });
const notificationIdParamsSchema = z.object({ id: z.string().uuid() });

function actorFromAuth(auth: { type: string; id: string }) {
  return { type: auth.type as "customer" | "provider", id: auth.id };
}

function replyNotFound(reply: FastifyReply, err: unknown) {
  if (
    err instanceof Error &&
    (err.message === "USER_NOT_FOUND" ||
      err.message === "PROVIDER_NOT_FOUND" ||
      err.message === "ADMIN_NOT_FOUND" ||
      err.message === "SUPERVISOR_NOT_FOUND")
  ) {
    return reply.code(404).send({ error: err.message });
  }
  return null;
}

export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/me",
    {
      preHandler: requireAuth(["customer", "provider", "admin", "supervisor"]),
      schema: {
        tags: ["Me"],
        summary: "Get the authenticated user profile",
        description:
          "Shared path for customers, providers, admins, and supervisors. Customer responses include `walletBalancePaise`, `totalBookings`, `homeAddress` (the default saved address), and onboarding flags: `isProfileComplete` (full name), `hasHomeLocation` (a default address exists), and `isHomeSetupComplete` (home type and size). Provider (worker) responses include `kycStatus` (approved / pending / rejected / not_submitted, with `kycRejectionReason` when rejected) and `stats`: `totalJobsCompleted` and `totalEarnedPaise` (worker share of captured payments on completed jobs) all-time, plus `thisWeek` (Monday–Sunday IST, by job date) with scheduled / inProgress / completed job counts and `earnedPaise`. Admins receive `sidebar`: sections with only the modules their role can open. System modules are included only when assigned to the role. Super Admin still receives every active non-System module.",
        security: [{ bearerAuth: [] }],
        response: { 200: meResponseSchema, ...authedErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return await meService.getProfile(request.auth!);
      } catch (err) {
        if (replyNotFound(reply, err)) return;
        throw err;
      }
    },
  );

  app.patch(
    "/me/fcm-token",
    {
      preHandler: requireAuth(["customer", "provider"]),
      schema: {
        tags: ["Me"],
        summary: "Update FCM push token",
        description:
          "Shared for customer and provider apps. Stores the device FCM registration token for push notifications. Send `fcmToken: null` to clear.",
        security: [{ bearerAuth: [] }],
        body: fcmTokenBodySchema,
        response: {
          200: fcmTokenResponseSchema,
          ...authedErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const auth = request.auth!;
        return await meService.updateFcmToken(
          { type: auth.type as "customer" | "provider", id: auth.id },
          request.body.fcmToken,
        );
      } catch (err) {
        if (replyNotFound(reply, err)) return;
        throw err;
      }
    },
  );

  app.get(
    "/me/notifications",
    {
      preHandler: requireAuth(["customer", "provider"]),
      schema: {
        tags: ["Me"],
        summary: "List in-app notifications",
        description: "Inbox for the authenticated customer or provider (in_app channel).",
        security: [{ bearerAuth: [] }],
        querystring: notificationsQuerySchema,
        response: {
          200: paginatedResponseSchema(notificationItemSchema),
          ...authedErrorResponses,
        },
      },
    },
    async (request) =>
      notificationService.listForActor(actorFromAuth(request.auth!), request.query),
  );

  app.get(
    "/me/notifications/unread-count",
    {
      preHandler: requireAuth(["customer", "provider"]),
      schema: {
        tags: ["Me"],
        summary: "Unread in-app notification count",
        security: [{ bearerAuth: [] }],
        response: { 200: unreadCountSchema, ...authedErrorResponses },
      },
    },
    async (request) => notificationService.unreadCount(actorFromAuth(request.auth!)),
  );

  app.patch(
    "/me/notifications/read-all",
    {
      preHandler: requireAuth(["customer", "provider"]),
      schema: {
        tags: ["Me"],
        summary: "Mark all in-app notifications as read",
        security: [{ bearerAuth: [] }],
        response: { 200: okSchema, ...authedErrorResponses },
      },
    },
    async (request) => notificationService.markAllRead(actorFromAuth(request.auth!)),
  );

  app.patch(
    "/me/notifications/:id/read",
    {
      preHandler: requireAuth(["customer", "provider"]),
      schema: {
        tags: ["Me"],
        summary: "Mark one in-app notification as read",
        security: [{ bearerAuth: [] }],
        params: notificationIdParamsSchema,
        response: {
          200: okSchema,
          ...authedErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        return await notificationService.markRead(actorFromAuth(request.auth!), request.params.id);
      } catch (err) {
        if (err instanceof Error && err.message === "NOTIFICATION_NOT_FOUND") {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.post(
    "/me/profile-photo",
    {
      preHandler: requireAuth(["customer", "provider"]),
      schema: {
        tags: ["Me"],
        summary: "Upload profile photo (multipart/form-data)",
        description: [
          `Send multipart/form-data with an image field named file (also accepts photo, image, profilePhoto). JPG or PNG, max 2 MB.`,
          "Stored in private S3 under customers/profile/ or providers/profile/.",
        ].join(" "),
        security: [{ bearerAuth: [] }],
        consumes: ["multipart/form-data"],
        body: profilePhotoMultipartBodySchema,
        response: {
          200: profilePhotoUploadResponseSchema,
          400: errorResponseSchema,
          502: errorResponseSchema,
          ...authedErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const upload = await readMultipartFile(request);
        if (!upload.buffer) {
          return sendUploadError(reply, "INVALID_UPLOAD");
        }
        const auth = request.auth!;
        return await meService.uploadProfilePhoto(
          { type: auth.type as "customer" | "provider", id: auth.id },
          {
            filename: upload.filename,
            mimetype: upload.mimetype,
            buffer: upload.buffer,
          },
        );
      } catch (err) {
        if (replyUploadError(reply, err)) return;
        if (replyNotFound(reply, err)) return;
        throw err;
      }
    },
  );
};

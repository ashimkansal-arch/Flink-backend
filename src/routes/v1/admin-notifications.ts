import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../../lib/auth/require-auth";
import { authedErrorResponses, errorResponseSchema } from "../../lib/auth/schemas";
import { notificationCampaignService } from "../../services/notification-campaign-service";

const toneSchema = z.enum(["info", "success", "warning", "danger"]);
const audienceSchema = z.enum(["customers", "workers"]);

const campaignDtoSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  category: z.string(),
  tone: z.string(),
  audience: z.enum(["customers", "workers"]),
  recipientCount: z.number().int(),
  read: z.boolean(),
  archived: z.boolean(),
  createdAt: z.coerce.date(),
});

const createBodySchema = z.object({
  title: z.string().min(1).max(80),
  body: z.string().min(1).max(240),
  audience: audienceSchema,
  tone: toneSchema.optional().default("info"),
});

const updateBodySchema = z
  .object({
    read: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .refine((body) => body.read !== undefined || body.archived !== undefined, {
    message: "read or archived is required",
  });

const idParamsSchema = z.object({ id: z.string().uuid() });
const writeErrors = { 400: errorResponseSchema, ...authedErrorResponses } as const;

export const adminNotificationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/admin/notifications",
    {
      preHandler: [requireAuth("admin")],
      schema: {
        tags: ["Admin Notifications"],
        summary: "List recent broadcast campaigns",
        security: [{ bearerAuth: [] }],
        response: { 200: z.array(campaignDtoSchema), ...authedErrorResponses },
      },
    },
    async () => notificationCampaignService.list(),
  );

  app.post(
    "/admin/notifications",
    {
      preHandler: [requireAuth("admin")],
      schema: {
        tags: ["Admin Notifications"],
        summary: "Send a push notification to workers or customers",
        description: "Push only. Choose audience: workers (providers) or customers.",
        security: [{ bearerAuth: [] }],
        body: createBodySchema,
        response: { 201: campaignDtoSchema, ...writeErrors },
      },
    },
    async (request, reply) => {
      try {
        const auth = request.auth!;
        if (auth.type !== "admin") return reply.code(403).send({ error: "FORBIDDEN" });
        return reply.code(201).send(
          await notificationCampaignService.broadcast({
            ...request.body,
            createdByAdminId: auth.id,
          }),
        );
      } catch (err) {
        if (err instanceof Error && err.message === "TITLE_AND_MESSAGE_REQUIRED") {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.patch(
    "/admin/notifications/:id",
    {
      preHandler: [requireAuth("admin")],
      schema: {
        tags: ["Admin Notifications"],
        summary: "Mark a campaign read/unread or archive it",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        body: updateBodySchema,
        response: { 200: campaignDtoSchema, ...writeErrors },
      },
    },
    async (request, reply) => {
      try {
        return await notificationCampaignService.update(request.params.id, request.body);
      } catch (err) {
        if (err instanceof Error && err.message === "NOTIFICATION_NOT_FOUND") {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    },
  );
};

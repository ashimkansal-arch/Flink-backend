import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../../lib/auth/require-auth";
import { requirePermission } from "../../lib/auth/permissions";
import { authedErrorResponses, errorResponseSchema } from "../../lib/auth/schemas";
import { platformConfigService } from "../../services/platform-config-service";
import { adminProviderService } from "../../services/admin-provider-service";

const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/, "Use HH:mm (24h)");

const platformConfigSchema = z.object({
  providerKycUploadEnabled: z.boolean(),
  jobHoursStart: timeSchema,
  jobHoursEnd: timeSchema,
  allWorkersOnline: z.boolean(),
  updatedAt: z.coerce.date(),
});

async function settingsDto(
  config?: Awaited<ReturnType<typeof platformConfigService.get>>,
) {
  const [settings, allWorkersOnline] = await Promise.all([
    config ?? platformConfigService.get(),
    adminProviderService.allWorkersOnline(),
  ]);
  return { ...settings, allWorkersOnline };
}

const updateBodySchema = z
  .object({
    providerKycUploadEnabled: z.boolean().optional(),
    jobHoursStart: timeSchema.optional(),
    jobHoursEnd: timeSchema.optional(),
  })
  .refine(
    (body) =>
      body.providerKycUploadEnabled !== undefined ||
      body.jobHoursStart !== undefined ||
      body.jobHoursEnd !== undefined,
    { message: "At least one field is required" },
  );

const ERROR_STATUS: Record<string, 400> = {
  INVALID_JOB_HOURS_START: 400,
  INVALID_JOB_HOURS_END: 400,
};

export const adminSettingsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/admin/settings",
    {
      preHandler: [requireAuth("admin"), requirePermission("settings:update")],
      schema: {
        tags: ["Admin Settings"],
        summary: "Get platform ops settings",
        description:
          "Provider KYC self-upload toggle and job operating hours.",
        security: [{ bearerAuth: [] }],
        response: { 200: platformConfigSchema, ...authedErrorResponses },
      },
    },
    async () => settingsDto(),
  );

  app.patch(
    "/admin/settings",
    {
      preHandler: [requireAuth("admin"), requirePermission("settings:update")],
      schema: {
        tags: ["Admin Settings"],
        summary: "Update platform ops settings",
        security: [{ bearerAuth: [] }],
        body: updateBodySchema,
        response: {
          200: platformConfigSchema,
          400: errorResponseSchema,
          ...authedErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        return await settingsDto(await platformConfigService.update(request.body, request.auth!.id));
      } catch (err) {
        if (err instanceof Error && ERROR_STATUS[err.message]) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.post(
    "/admin/settings/workers/availability",
    {
      preHandler: [requireAuth("admin"), requirePermission("settings:update")],
      schema: {
        tags: ["Admin Settings"],
        summary: "Mark all active workers online or offline",
        description:
          "Temporary: sets isAvailable on every active worker. Remove once login-hours cron is in place.",
        security: [{ bearerAuth: [] }],
        body: z.object({ online: z.boolean() }),
        response: {
          200: z.object({ updated: z.number().int(), online: z.boolean() }),
          ...authedErrorResponses,
        },
      },
    },
    async (request) => adminProviderService.setAllAvailability(request.body.online),
  );
};

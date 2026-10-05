import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../../lib/auth/require-auth";
import { requirePermission } from "../../lib/auth/permissions";
import { authedErrorResponses } from "../../lib/auth/schemas";
import { dashboardPeriodSchema } from "../../lib/dashboard-period";
import { dashboardRepository } from "../../repositories/dashboard-repository";

const stateCountSchema = z.object({
  state: z.string(),
  count: z.number().int(),
});

const dashboardStatsSchema = z.object({
  period: dashboardPeriodSchema,
  counts: z.object({
    admins: z.number().int(),
    supervisors: z.number().int(),
    providers: z.number().int(),
    customers: z.number().int(),
    providersOnline: z.number().int(),
    providersOffline: z.number().int(),
    offlineRequestsPending: z.number().int(),
  }),
  graphs: z.object({
    supervisorsByState: z.array(stateCountSchema),
    providersByState: z.array(stateCountSchema),
    customersByState: z.array(stateCountSchema),
  }),
});

export const dashboardRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/admin/dashboard",
    {
      preHandler: [requireAuth("admin"), requirePermission("dashboard:read")],
      schema: {
        tags: ["Dashboard"],
        summary: "Dashboard stats and state-wise graphs",
        description:
          "Active-only counts for admins, supervisors, providers, and customers (excludes disabled/deleted). Period filters by createdAt. providersOnline and providersOffline are live snapshots (active + isAvailable true/false). State graphs for supervisors and providers use assigned admin address state, then creating admin state, else Unknown. Customer state uses the default address, then the oldest address, else Unknown.",
        security: [{ bearerAuth: [] }],
        querystring: z.object({ period: dashboardPeriodSchema }),
        response: { 200: dashboardStatsSchema, ...authedErrorResponses },
      },
    },
    async (request) => dashboardRepository.getDashboard(request.query.period),
  );

  app.get(
    "/admin/cities",
    {
      preHandler: [requireAuth("admin"), requirePermission("dashboard:read")],
      schema: {
        tags: ["Dashboard"],
        summary: "City-wise worker counts and captured revenue",
        description:
          "Workers are grouped by their assigned coverage-zone city. Revenue is captured payment amount attributed to those workers.",
        security: [{ bearerAuth: [] }],
        response: {
          200: z.object({
            items: z.array(
              z.object({
                city: z.string(),
                providerCount: z.number().int(),
                revenuePaise: z.number().int(),
              }),
            ),
          }),
          ...authedErrorResponses,
        },
      },
    },
    async () => dashboardRepository.getCityStats(),
  );
};

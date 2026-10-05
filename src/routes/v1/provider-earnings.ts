import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../../lib/auth/require-auth";
import { authedErrorResponses } from "../../lib/auth/schemas";
import { istDateSchema } from "../../lib/api-schemas";
import { indiaClock } from "../../lib/job-hours";
import { paginatedResponseSchema, paginationQuerySchema } from "../../lib/pagination";
import { providerEarningsService } from "../../services/provider-earnings-service";

const earningsSchema = z.object({
  jobsCompleted: z.number().int().describe("Finished (completed/paid) jobs"),
  earnedPaise: z.number().int().describe("Worker share of captured payments on those jobs, in paise"),
});

const dayEarningsSchema = earningsSchema.extend({
  date: z.string().describe("IST job day, YYYY-MM-DD"),
});

const summaryQuerySchema = z.object({
  period: z.enum(["week", "month"]).default("week"),
  date: istDateSchema
    .optional()
    .describe("Any day inside the week/month to show (YYYY-MM-DD, IST). Defaults to today; use it for previous/next."),
});

const summaryResponseSchema = z.object({
  total: earningsSchema.describe("All time"),
  period: earningsSchema.extend({
    type: z.enum(["week", "month"]),
    startDate: z.string(),
    endDate: z.string(),
  }),
  recentDays: z.array(dayEarningsSchema).describe("Latest days with finished jobs in the period (up to 3)"),
  hasMoreDays: z.boolean().describe("More days exist in the period — call /provider/earnings/daily with from/to"),
});

const dailyQuerySchema = paginationQuerySchema
  .extend({
    from: istDateSchema.optional().describe("First IST day to include (YYYY-MM-DD)"),
    to: istDateSchema.optional().describe("Last IST day to include (YYYY-MM-DD)"),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: "from must be on or before to",
    path: ["from"],
  });

const dailyResponseSchema = paginatedResponseSchema(dayEarningsSchema).extend({
  range: earningsSchema.extend({
    from: z.string().nullable(),
    to: z.string().nullable(),
  }).describe("Totals for the whole filtered range (all pages)"),
});

export const providerEarningsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/provider/earnings",
    {
      preHandler: requireAuth("provider"),
      schema: {
        tags: ["Provider Earnings"],
        summary: "Earnings summary: all-time plus the selected week or month",
        description:
          "`total` is all-time earnings and finished jobs. `period` is the Monday–Sunday week or calendar month (IST) " +
          "containing `date` (default today). `recentDays` previews the latest 3 days of the period; " +
          "for the full list call GET /provider/earnings/daily?from={period.startDate}&to={period.endDate}. " +
          "A job counts on its job day (scheduled date, or the day an instant booking was made) once it is completed. " +
          "Amounts are the worker's share, in paise.",
        security: [{ bearerAuth: [] }],
        querystring: summaryQuerySchema,
        response: { ...authedErrorResponses, 200: summaryResponseSchema },
      },
    },
    async (request) =>
      providerEarningsService.summary(
        request.auth!.id,
        request.query.period,
        request.query.date ?? indiaClock().date,
      ),
  );

  app.get(
    "/provider/earnings/daily",
    {
      preHandler: requireAuth("provider"),
      schema: {
        tags: ["Provider Earnings"],
        summary: "Day-by-day earnings, paginated",
        description:
          "One row per IST day with at least one finished job, newest first. Filter with `from` and/or `to` " +
          "(inclusive, YYYY-MM-DD); with neither, all days are returned. `range` totals the whole filtered range across pages.",
        security: [{ bearerAuth: [] }],
        querystring: dailyQuerySchema,
        response: { ...authedErrorResponses, 200: dailyResponseSchema },
      },
    },
    async (request) => {
      const { from, to, page, limit } = request.query;
      return providerEarningsService.daily(request.auth!.id, { from, to }, { page, limit });
    },
  );
};

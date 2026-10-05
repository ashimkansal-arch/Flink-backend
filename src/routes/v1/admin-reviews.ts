import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { requireAuth } from "../../lib/auth/require-auth";
import { requirePermission } from "../../lib/auth/permissions";
import { authedErrorResponses } from "../../lib/auth/schemas";
import { reviewAdminDtoSchema, reviewAdminListStatsSchema } from "../../lib/api-schemas";
import { paginatedResponseSchema, searchQuerySchema } from "../../lib/pagination";
import { adminReviewService } from "../../services/admin-review-service";

export const adminReviewRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/admin/reviews",
    {
      preHandler: [requireAuth("admin"), requirePermission("bookings:read")],
      schema: {
        tags: ["Admin Reviews"],
        summary: "List customer reviews of workers",
        description:
          "Paginated reviews with search across comment, customer, and worker. Includes overall count and average rating for the filtered set.",
        security: [{ bearerAuth: [] }],
        querystring: searchQuerySchema,
        response: {
          200: paginatedResponseSchema(reviewAdminDtoSchema).extend({
            stats: reviewAdminListStatsSchema,
          }),
          ...authedErrorResponses,
        },
      },
    },
    async (request) => adminReviewService.list(request.query),
  );
};

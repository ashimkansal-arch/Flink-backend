import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { catalogService } from "../../services/catalog-service";
import { requireAuth } from "../../lib/auth/require-auth";
import { authedErrorResponses, errorResponseSchema } from "../../lib/auth/schemas";
import {
  catalogCategorySchema,
  catalogPlansResponseSchema,
  catalogServiceSchema,
  catalogServiceSortSchema,
  recommendedPackageSchema,
} from "../../lib/api-schemas";

const serviceListQuery = z.object({
  q: z.string().max(80).optional(),
  sort: catalogServiceSortSchema.optional(),
});
const categoryIdParams = z.object({ categoryId: z.string().uuid() });
const serviceIdParams = z.object({ serviceId: z.string().uuid() });
const notFoundResponses = { ...authedErrorResponses, 404: errorResponseSchema } as const;

function mappedError(err: unknown): { status: 404; error: string } {
  if (err instanceof Error && err.message === "SERVICE_NOT_FOUND") {
    return { status: 404, error: err.message };
  }
  throw err;
}

const serviceListSchema = {
  tags: ["Customer Catalog"],
  security: [{ bearerAuth: [] }],
  querystring: serviceListQuery,
  response: { ...authedErrorResponses, 200: z.array(catalogServiceSchema) },
} as const;

export const customerCatalogRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/customer/categories",
    {
      preHandler: requireAuth("customer"),
      schema: {
        tags: ["Customer Catalog"],
        summary: "List active service categories",
        description:
          "Returns top-level categories. Use GET /customer/services for all sub-services, or GET /customer/services/:categoryId for one category.",
        security: [{ bearerAuth: [] }],
        response: { ...authedErrorResponses, 200: z.array(catalogCategorySchema) },
      },
    },
    async () => catalogService.listServices(),
  );

  app.get(
    "/customer/services",
    {
      preHandler: requireAuth("customer"),
      schema: {
        ...serviceListSchema,
        summary: "List active services",
        description:
          "Returns every active sub-service. Optional q searches name/slug. Optional sort: popular, high_to_low, low_to_high. Scope with GET /customer/services/:categoryId.",
      },
    },
    async (request) =>
      catalogService.listSubcategories(undefined, request.query.sort, request.query.q),
  );

  app.get(
    "/customer/services/:serviceId/plans",
    {
      preHandler: requireAuth("customer"),
      schema: {
        tags: ["Customer Catalog"],
        summary: "Get packages that include this service",
        description: "Returns active packages that include the given leaf service.",
        security: [{ bearerAuth: [] }],
        params: serviceIdParams,
        response: { ...notFoundResponses, 200: catalogPlansResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        return await catalogService.getServicePlans(request.params.serviceId);
      } catch (err) {
        const mapped = mappedError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.post(
    "/customer/packages/recommend",
    {
      preHandler: requireAuth("customer"),
      schema: {
        tags: ["Customer Catalog"],
        summary: "Recommend packages for selected services",
        description:
          "Returns active packages that overlap the selected leaf service IDs, ranked by overlap (most matching services first).",
        security: [{ bearerAuth: [] }],
        body: z.object({ serviceIds: z.array(z.string().uuid()).min(1) }),
        response: { ...authedErrorResponses, 200: z.array(recommendedPackageSchema) },
      },
    },
    async (request) => catalogService.recommendPackages(request.body.serviceIds),
  );

  app.get(
    "/customer/services/:categoryId",
    {
      preHandler: requireAuth("customer"),
      schema: {
        ...serviceListSchema,
        summary: "List active services for a category",
        description:
          "Active children of a top-level category. Same q and sort as GET /customer/services. Empty when there are no children (use the category id for plans).",
        params: categoryIdParams,
        response: { ...notFoundResponses, 200: z.array(catalogServiceSchema) },
      },
    },
    async (request, reply) => {
      try {
        return await catalogService.listSubcategories(
          request.params.categoryId,
          request.query.sort,
          request.query.q,
        );
      } catch (err) {
        const mapped = mappedError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );
};

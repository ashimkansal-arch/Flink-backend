import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../../lib/auth/require-auth";
import { requirePermission } from "../../lib/auth/permissions";
import { authedErrorResponses, errorResponseSchema } from "../../lib/auth/schemas";
import {
  okResponseSchema,
  servicePackageBodySchema,
  servicePackageDtoSchema,
  servicePackageListStatsSchema,
  servicePackageUpdateBodySchema,
} from "../../lib/api-schemas";
import { paginatedResponseSchema, searchQuerySchema } from "../../lib/pagination";
import { adminPackageService } from "../../services/admin-package-service";

const idParamsSchema = z.object({ id: z.string().uuid() });

const writeErrorResponses = {
  400: errorResponseSchema,
  ...authedErrorResponses,
  409: errorResponseSchema,
} as const;

const ERROR_STATUS: Record<string, 400 | 404 | 409> = {
  PACKAGE_NOT_FOUND: 404,
  SERVICE_NOT_FOUND: 404,
  SLUG_TAKEN: 409,
  PACKAGE_IN_USE: 409,
  PACKAGES_ONLY_ON_LEAF: 409,
  SERVICES_REQUIRED: 400,
  INVALID_SLUG: 400,
};

function mappedError(err: unknown): { status: 400 | 404 | 409; error: string } {
  if (!(err instanceof Error)) throw err;
  const status = ERROR_STATUS[err.message];
  if (!status) throw err;
  return { status, error: err.message };
}

function adminCan(permission: string) {
  return [requireAuth("admin"), requirePermission(permission)];
}

export const adminPackageRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/admin/packages",
    {
      preHandler: adminCan("packages:read"),
      schema: {
        tags: ["Admin Packages"],
        summary: "List recommended service packages",
        security: [{ bearerAuth: [] }],
        querystring: searchQuerySchema,
        response: {
          200: paginatedResponseSchema(servicePackageDtoSchema).extend({
            stats: servicePackageListStatsSchema,
          }),
          ...authedErrorResponses,
        },
      },
    },
    async (request) => adminPackageService.list(request.query),
  );

  app.post(
    "/admin/packages",
    {
      preHandler: adminCan("packages:create"),
      schema: {
        tags: ["Admin Packages"],
        summary: "Create a recommended service package",
        security: [{ bearerAuth: [] }],
        body: servicePackageBodySchema,
        response: { 201: servicePackageDtoSchema, ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return reply.code(201).send(await adminPackageService.create(request.body));
      } catch (err) {
        const mapped = mappedError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.get(
    "/admin/packages/:id",
    {
      preHandler: adminCan("packages:read"),
      schema: {
        tags: ["Admin Packages"],
        summary: "Get a recommended service package",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: { 200: servicePackageDtoSchema, ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return await adminPackageService.getById(request.params.id);
      } catch (err) {
        const mapped = mappedError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.patch(
    "/admin/packages/:id",
    {
      preHandler: adminCan("packages:update"),
      schema: {
        tags: ["Admin Packages"],
        summary: "Update a recommended service package",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        body: servicePackageUpdateBodySchema,
        response: { 200: servicePackageDtoSchema, ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return await adminPackageService.update(request.params.id, request.body);
      } catch (err) {
        const mapped = mappedError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.delete(
    "/admin/packages/:id",
    {
      preHandler: adminCan("packages:delete"),
      schema: {
        tags: ["Admin Packages"],
        summary: "Delete a package (blocked if it has bookings)",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: { 200: okResponseSchema, ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        await adminPackageService.remove(request.params.id);
        return reply.code(200).send({ ok: true });
      } catch (err) {
        const mapped = mappedError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );
};

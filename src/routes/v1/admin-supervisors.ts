import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { adminActorRole, requireAuth } from "../../lib/auth/require-auth";
import { requirePermission } from "../../lib/auth/permissions";
import { authedErrorResponses, errorResponseSchema } from "../../lib/auth/schemas";
import {
  supervisorDtoSchema,
  supervisorListItemSchema,
  createSupervisorBodySchema,
  updateSupervisorBodySchema,
} from "../../lib/api-schemas";
import { paginatedResponseSchema, searchQuerySchema } from "../../lib/pagination";
import { adminSupervisorService } from "../../services/admin-supervisor-service";

const idParamsSchema = z.object({ id: z.string().uuid() });
const writeErrorResponses = {
  400: errorResponseSchema,
  ...authedErrorResponses,
  409: errorResponseSchema,
} as const;

function adminCan(permission: string) {
  return [requireAuth("admin"), requirePermission(permission)];
}

const ERROR_STATUS: Record<string, 400 | 404 | 409> = {
  SUPERVISOR_NOT_FOUND: 404,
  CATEGORY_NOT_FOUND: 404,
  ASSIGNED_ADMIN_NOT_FOUND: 404,
  EMAIL_TAKEN: 409,
  PHONE_TAKEN: 409,
};

function mappedError(err: unknown): { status: 400 | 404 | 409; error: string } {
  if (!(err instanceof Error)) throw err;
  const status = ERROR_STATUS[err.message];
  if (!status) throw err;
  return { status, error: err.message };
}

export const adminSupervisorRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/admin/supervisors",
    {
      preHandler: adminCan("supervisors:read"),
      schema: {
        tags: ["Admin Supervisors"],
        summary: "List supervisors",
        description:
          "Each item includes role and teamCount (providers registered by that supervisor). Super Admin sees every supervisor; other admins see supervisors they created or that are assigned to them (including those owned by their descendant team members).",
        security: [{ bearerAuth: [] }],
        querystring: searchQuerySchema,
        response: { 200: paginatedResponseSchema(supervisorListItemSchema), ...authedErrorResponses },
      },
    },
    async (request) =>
      adminSupervisorService.list(request.query, adminActorRole(request.auth), request.auth!.id),
  );

  app.post(
    "/admin/supervisors",
    {
      preHandler: adminCan("supervisors:create"),
      schema: {
        tags: ["Admin Supervisors"],
        summary: "Create a supervisor (password is generated and emailed)",
        security: [{ bearerAuth: [] }],
        body: createSupervisorBodySchema,
        response: {
          201: z.object({ supervisor: supervisorDtoSchema, passwordResetRequired: z.literal(true) }),
          ...writeErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        return reply.code(201).send(await adminSupervisorService.create({ ...request.body, createdBy: request.auth!.id }));
      } catch (err) {
        const mapped = mappedError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.get(
    "/admin/supervisors/:id",
    {
      preHandler: adminCan("supervisors:read"),
      schema: {
        tags: ["Admin Supervisors"],
        summary: "Get a supervisor",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: { 200: supervisorDtoSchema, ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return await adminSupervisorService.getById(
          request.params.id,
          adminActorRole(request.auth),
          request.auth!.id,
        );
      } catch (err) {
        const mapped = mappedError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.patch(
    "/admin/supervisors/:id",
    {
      preHandler: adminCan("supervisors:update"),
      schema: {
        tags: ["Admin Supervisors"],
        summary: "Update a supervisor, including status (active | inactive | suspended)",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        body: updateSupervisorBodySchema,
        response: { 200: supervisorDtoSchema, ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return await adminSupervisorService.update(
          request.params.id,
          request.body,
          adminActorRole(request.auth),
          request.auth!.id,
        );
      } catch (err) {
        const mapped = mappedError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.delete(
    "/admin/supervisors/:id",
    {
      preHandler: adminCan("supervisors:delete"),
      schema: {
        tags: ["Admin Supervisors"],
        summary: "Disable a supervisor",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: { 204: z.null(), ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        await adminSupervisorService.remove(
          request.params.id,
          adminActorRole(request.auth),
          request.auth!.id,
        );
        return reply.code(204).send(null);
      } catch (err) {
        const mapped = mappedError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.post(
    "/admin/supervisors/:id/password/reset",
    {
      preHandler: adminCan("supervisors:update"),
      schema: {
        tags: ["Admin Supervisors"],
        summary: "Reset supervisor password, email a temporary password, set passwordResetRequired",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: {
          200: z.object({ passwordResetRequired: z.literal(true) }),
          ...writeErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        return await adminSupervisorService.resetPassword(
          request.params.id,
          adminActorRole(request.auth),
          request.auth!.id,
        );
      } catch (err) {
        const mapped = mappedError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );
};

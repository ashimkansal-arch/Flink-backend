import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { adminActorRole, requireAuth } from "../../lib/auth/require-auth";
import { requirePermission } from "../../lib/auth/permissions";
import { authedErrorResponses, errorResponseSchema } from "../../lib/auth/schemas";
import { adminUserService } from "../../services/admin-user-service";
import { PERMISSIONS } from "../../lib/auth/permission-catalog";
import {
  createAdminUserBodySchema,
  updateAdminUserBodySchema,
  transferTeamBodySchema,
  adminUserDtoSchema,
  adminUserListItemSchema,
  adminUserListStatsSchema,
  adminUserCreatedStatsSchema,
  providerAdminDtoSchema,
  supervisorListItemSchema,
} from "../../lib/api-schemas";
import {
  paginatedResponseSchema,
  adminUserListQuerySchema,
  adminUserCreatedQuerySchema,
  createdTeamGroupSchema,
} from "../../lib/pagination";
import { mapAdminUserError } from "../../lib/admin-user-errors";

const idParamsSchema = z.object({ id: z.string().uuid() });

export const adminUserRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/admin/permissions",
    {
      preHandler: [requireAuth("admin"), requirePermission("admins:read")],
      schema: {
        tags: ["Admin Users"],
        summary: "List selectable permissions for creating or updating an admin",
        security: [{ bearerAuth: [] }],
        response: {
          200: z.array(z.object({ key: z.string(), description: z.string() })),
          ...authedErrorResponses,
        },
      },
    },
    async () => [...PERMISSIONS],
  );

  app.get(
    "/admin/users",
    {
      preHandler: [requireAuth("admin"), requirePermission("admins:read")],
      schema: {
        tags: ["Admin Users"],
        summary: "List admin users (legacy — prefer GET /v1/teams/members)",
        description:
          "Each item includes role, manager, and teamCount (everyone below them in the org tree: CRM members they manage, field supervisors, and workers). Super Admin sees every team member; other admins see members they invited or that were assigned to them. Supervisors only count workers they registered.",
        security: [{ bearerAuth: [] }],
        querystring: adminUserListQuerySchema,
        response: {
          200: paginatedResponseSchema(adminUserListItemSchema).extend({
            stats: adminUserListStatsSchema,
          }),
          ...authedErrorResponses,
        },
      },
    },
    async (request) =>
      adminUserService.list(request.query, adminActorRole(request.auth), request.auth!.id),
  );

  app.post(
    "/admin/users",
    {
      preHandler: [requireAuth("admin"), requirePermission("admins:*")],
      schema: {
        tags: ["Admin Users"],
        summary: "Create a CRM team member. Generates a password and emails it.",
        description:
          "role is required (e.g. admin, dispatcher). Prefer GET /v1/teams/members or /v1/access/roles for valid names. Do not pass super_admin. Access comes from the assigned role's modules.",
        security: [{ bearerAuth: [] }],
        body: createAdminUserBodySchema,
        response: {
          201: z.object({ admin: adminUserDtoSchema, passwordResetRequired: z.literal(true) }),
          400: errorResponseSchema,
          ...authedErrorResponses,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await adminUserService.create({
          ...request.body,
          invitedBy: request.auth!.id,
          actorRole: adminActorRole(request.auth),
        });
        return reply.code(201).send(result);
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        const mapped = mapAdminUserError(err.message);
        if (!mapped) throw err;
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.get(
    "/admin/users/:id",
    {
      preHandler: [requireAuth("admin"), requirePermission("admins:read")],
      schema: {
        tags: ["Admin Users"],
        summary: "Get an admin user",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: { 200: adminUserDtoSchema, ...authedErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return await adminUserService.getDirectoryUser(
          request.params.id,
          adminActorRole(request.auth),
          request.auth!.id,
        );
      } catch (err) {
        if (err instanceof Error && err.message === "ADMIN_NOT_FOUND") {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.get(
    "/admin/users/:id/created",
    {
      preHandler: [requireAuth("admin"), requirePermission("admins:read")],
      schema: {
        tags: ["Admin Users"],
        summary: "List a team member’s org tree",
        description:
          "Paginated CRM members, field supervisors, or workers below this member. Supervisors only have workers. Admins see members they manage plus workers in that tree. Stats include member, supervisor, and worker totals. Use group=members|supervisors|workers.",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        querystring: adminUserCreatedQuerySchema,
        response: {
          200: paginatedResponseSchema(
            z.union([adminUserListItemSchema, supervisorListItemSchema, providerAdminDtoSchema]),
          ).extend({
            group: createdTeamGroupSchema,
            member: z.object({
              id: z.string().uuid(),
              fullName: z.string().nullable(),
              email: z.string().email(),
              role: z.string(),
            }),
            stats: adminUserCreatedStatsSchema,
          }),
          ...authedErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        return await adminUserService.listCreated(
          request.params.id,
          request.query,
          adminActorRole(request.auth),
          request.auth!.id,
        );
      } catch (err) {
        if (err instanceof Error && err.message === "ADMIN_NOT_FOUND") {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.patch(
    "/admin/users/:id",
    {
      preHandler: [requireAuth("admin"), requirePermission("admins:*")],
      schema: {
        tags: ["Admin Users"],
        summary: "Update an admin user",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        body: updateAdminUserBodySchema,
        response: { 200: adminUserDtoSchema, 400: errorResponseSchema, ...authedErrorResponses, 409: errorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        return await adminUserService.update(request.params.id, {
          ...request.body,
          actorRole: adminActorRole(request.auth),
          actorId: request.auth!.id,
        });
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        const mapped = mapAdminUserError(err.message);
        if (!mapped) throw err;
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.post(
    "/admin/users/:id/password/reset",
    {
      preHandler: [requireAuth("admin"), requirePermission("admins:*")],
      schema: {
        tags: ["Admin Users"],
        summary: "Reset team member password",
        description:
          "Emails a temporary password and sets passwordResetRequired.",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: {
          200: z.object({ passwordResetRequired: z.literal(true) }),
          400: errorResponseSchema,
          ...authedErrorResponses,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await adminUserService.resetPassword(
          request.params.id,
          adminActorRole(request.auth),
          request.auth!.id,
        );
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        const mapped = mapAdminUserError(err.message);
        if (!mapped) throw err;
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.delete(
    "/admin/users/:id",
    {
      preHandler: [requireAuth("admin"), requirePermission("admins:*")],
      schema: {
        tags: ["Admin Users"],
        summary: "Disable an admin user",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        body: transferTeamBodySchema.nullish(),
        response: { 204: z.null(), 400: errorResponseSchema, ...authedErrorResponses, 409: errorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        await adminUserService.remove(
          request.params.id,
          request.auth!.id,
          adminActorRole(request.auth),
          request.body?.transferToId,
        );
        return reply.code(204).send(null);
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        const mapped = mapAdminUserError(err.message);
        if (!mapped) throw err;
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );
};

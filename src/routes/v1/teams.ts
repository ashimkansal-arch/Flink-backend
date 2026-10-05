import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { adminActorRole, requireAuth } from "../../lib/auth/require-auth";
import { requirePermission } from "../../lib/auth/permissions";
import { authedErrorResponses, errorResponseSchema } from "../../lib/auth/schemas";
import { adminUserService } from "../../services/admin-user-service";
import { adminSupervisorService } from "../../services/admin-supervisor-service";
import { adminRoleService } from "../../services/admin-role-service";
import { replyMapped } from "../../lib/rbac-errors";
import {
  enrichRoleWithCatalog,
  listPermissionCatalog,
  listRoleCatalog,
  listScopeCatalog,
} from "../../lib/auth/access-catalog";
import { ACCESS_SCOPE_LEVELS, ROLE_CATEGORIES } from "../../lib/auth/crm-roles";
import {
  adminRoleDtoSchema,
  adminUserDtoSchema,
  adminUserListItemSchema,
  adminUserListStatsSchema,
  createAdminUserBodySchema,
  updateAdminUserBodySchema,
  transferTeamBodySchema,
  createSupervisorBodySchema,
  updateSupervisorBodySchema,
  supervisorDtoSchema,
  supervisorListItemSchema,
} from "../../lib/api-schemas";
import { paginatedResponseSchema, searchQuerySchema, optionalSearchQuerySchema, adminUserListQuerySchema } from "../../lib/pagination";
import { mapAdminUserError } from "../../lib/admin-user-errors";

const scopeLevelSchema = z.enum(ACCESS_SCOPE_LEVELS);

const roleWriteFields = {
  permissions: z.array(z.string().min(1)).optional(),
  isAdmin: z.boolean().optional(),
};

const createRoleBodySchema = z.object({
  roleName: z.string().min(1).max(60),
  description: z.string().max(200).optional(),
  ...roleWriteFields,
});

const updateRoleBodySchema = z.object({
  roleName: z.string().min(1).max(60).optional(),
  description: z.string().max(200).nullable().optional(),
  ...roleWriteFields,
});

const roleDtoSchema = adminRoleDtoSchema.extend({
  category: z.enum(ROLE_CATEGORIES).nullable(),
  defaultScope: scopeLevelSchema.nullable(),
});

const idParamsSchema = z.object({ id: z.string().uuid() });

const writeErrorResponses = {
  400: errorResponseSchema,
  ...authedErrorResponses,
  409: errorResponseSchema,
} as const;

function mapSupervisorError(message: string): { status: 400 | 404 | 409; error: string } | null {
  switch (message) {
    case "SUPERVISOR_NOT_FOUND":
    case "CATEGORY_NOT_FOUND":
    case "ASSIGNED_ADMIN_NOT_FOUND":
      return { status: 404, error: message };
    case "EMAIL_TAKEN":
    case "PHONE_TAKEN":
      return { status: 409, error: message };
    default:
      return null;
  }
}

function enrichRoleDto(role: Awaited<ReturnType<typeof adminRoleService.getById>>) {
  return enrichRoleWithCatalog(role);
}

/**
 * Super Admin team management APIs (CRM PRD).
 *
 * Naming:
 * - /teams/members  — CRM staff (AdminUser) across all roles: crm_admin, city_manager, support_agent, …
 * - /teams/admins   — alias of /teams/members (FE-friendly)
 * - /teams/supervisors — Partner/field supervisors (Supervisor entity)
 * - /teams/roles / permissions / scopes — catalog for provisioning
 */
export const teamRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── Catalog ──────────────────────────────────────────────────────────
  app.get(
    "/teams/scopes",
    {
      preHandler: [requireAuth("admin"), requirePermission("admins:read")],
      schema: {
        tags: ["Teams"],
        summary: "List CRM access scope levels",
        security: [{ bearerAuth: [] }],
        response: {
          200: z.array(
            z.object({
              key: scopeLevelSchema,
              label: z.string(),
              description: z.string(),
              example: z.string(),
            }),
          ),
          ...authedErrorResponses,
        },
      },
    },
    async () =>
      listScopeCatalog().map(({ level, label, description, example }) => ({
        key: level,
        label,
        description,
        example,
      })),
  );

  app.get(
    "/teams/permissions",
    {
      preHandler: [requireAuth("admin"), requirePermission("admins:read")],
      schema: {
        tags: ["Teams"],
        summary: "List selectable permissions for team members / roles",
        security: [{ bearerAuth: [] }],
        response: {
          200: z.array(z.object({ key: z.string(), description: z.string() })),
          ...authedErrorResponses,
        },
      },
    },
    async () => listPermissionCatalog(),
  );

  app.get(
    "/teams/role-catalog",
    {
      preHandler: [requireAuth("admin"), requirePermission("admins:read")],
      schema: {
        tags: ["Teams"],
        summary: "Recommended CRM roles by category (PRD role model)",
        security: [{ bearerAuth: [] }],
        response: {
          200: z.array(
            z.object({
              roleName: z.string(),
              category: z.enum(ROLE_CATEGORIES),
              description: z.string(),
              defaultScope: scopeLevelSchema,
              permissions: z.array(z.string()),
            }),
          ),
          ...authedErrorResponses,
        },
      },
    },
    async () => listRoleCatalog(),
  );

  // ── Roles ────────────────────────────────────────────────────────────
  app.get(
    "/teams/roles",
    {
      preHandler: [requireAuth("admin"), requirePermission("admins:read")],
      schema: {
        tags: ["Teams"],
        summary: "List assignable CRM roles (excludes super_admin)",
        security: [{ bearerAuth: [] }],
        querystring: optionalSearchQuerySchema,
        response: { 200: z.array(roleDtoSchema), ...authedErrorResponses },
      },
    },
    async (request) => {
      const roles = await adminRoleService.list(request.query);
      return roles.map(enrichRoleDto);
    },
  );

  app.post(
    "/teams/roles",
    {
      preHandler: [requireAuth("admin"), requirePermission("admins:*")],
      schema: {
        tags: ["Teams"],
        summary: "Create a CRM role",
        security: [{ bearerAuth: [] }],
        body: createRoleBodySchema,
        response: { 201: roleDtoSchema, ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        const role = await adminRoleService.create(request.body);
        return reply.code(201).send(enrichRoleDto(role));
      } catch (err) {
        return replyMapped(reply, err);
      }
    },
  );

  app.get(
    "/teams/roles/:id",
    {
      preHandler: [requireAuth("admin"), requirePermission("admins:read")],
      schema: {
        tags: ["Teams"],
        summary: "Get a CRM role",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: { 200: roleDtoSchema, ...authedErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return enrichRoleDto(await adminRoleService.getById(request.params.id));
      } catch (err) {
        return replyMapped(reply, err);
      }
    },
  );

  app.patch(
    "/teams/roles/:id",
    {
      preHandler: [requireAuth("admin"), requirePermission("admins:*")],
      schema: {
        tags: ["Teams"],
        summary: "Update a CRM role",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        body: updateRoleBodySchema,
        response: { 200: roleDtoSchema, ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return enrichRoleDto(await adminRoleService.update(request.params.id, request.body));
      } catch (err) {
        return replyMapped(reply, err);
      }
    },
  );

  app.delete(
    "/teams/roles/:id",
    {
      preHandler: [requireAuth("admin"), requirePermission("admins:*")],
      schema: {
        tags: ["Teams"],
        summary: "Delete a CRM role (blocked if users assigned)",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: { 204: z.null(), ...authedErrorResponses, 409: errorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        await adminRoleService.remove(request.params.id);
        return reply.code(204).send(null);
      } catch (err) {
        return replyMapped(reply, err);
      }
    },
  );

  // ── Members / Admins (AdminUser — all CRM staff roles) ───────────────
  const registerMemberCrud = (basePath: "/teams/members" | "/teams/admins") => {
    app.get(
      basePath,
      {
        preHandler: [requireAuth("admin"), requirePermission("admins:read")],
        schema: {
          tags: ["Teams"],
          summary: `List CRM team ${basePath.endsWith("admins") ? "admins/staff" : "members"}`,
          description:
            "Returns AdminUser records (crm_admin, city_manager, support_agent, finance_manager, …). Excludes super_admin. Includes role, scope, and directory-wide status stats. Super admins see every team member; other admins see members they invited or that were assigned to them, including descendants further down that tree.",
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
      basePath,
      {
        preHandler: [requireAuth("admin"), requirePermission("admins:*")],
        schema: {
          tags: ["Teams"],
          summary: `Create a CRM team ${basePath.endsWith("admins") ? "admin/staff" : "member"}`,
          description:
            "Pass role from GET /teams/role-catalog or /teams/roles (e.g. city_manager, support_agent). Optional scopeLevel defaults from the role model. Password is emailed.",
          security: [{ bearerAuth: [] }],
          body: createAdminUserBodySchema,
          response: {
            201: z.object({ admin: adminUserDtoSchema, passwordResetRequired: z.literal(true) }),
            ...writeErrorResponses,
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
      `${basePath}/:id`,
      {
        preHandler: [requireAuth("admin"), requirePermission("admins:read")],
        schema: {
          tags: ["Teams"],
          summary: "Get a CRM team member",
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

    app.patch(
      `${basePath}/:id`,
      {
        preHandler: [requireAuth("admin"), requirePermission("admins:*")],
        schema: {
          tags: ["Teams"],
          summary: "Update a CRM team member (role, scope, status)",
          security: [{ bearerAuth: [] }],
          params: idParamsSchema,
          body: updateAdminUserBodySchema,
          response: { 200: adminUserDtoSchema, ...writeErrorResponses },
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
      `${basePath}/:id/password/reset`,
      {
        preHandler: [requireAuth("admin"), requirePermission("admins:*")],
        schema: {
          tags: ["Teams"],
          summary: "Reset CRM team member password",
          description:
            "Emails a temporary password and sets passwordResetRequired.",
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
      `${basePath}/:id`,
      {
        preHandler: [requireAuth("admin"), requirePermission("admins:*")],
        schema: {
          tags: ["Teams"],
          summary: "Disable a CRM team member",
          security: [{ bearerAuth: [] }],
          params: idParamsSchema,
          body: transferTeamBodySchema.nullish(),
          response: { 204: z.null(), ...writeErrorResponses },
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

  registerMemberCrud("/teams/members");
  registerMemberCrud("/teams/admins");

  // ── Supervisors (Partner / expert ops field managers) ────────────────
  app.get(
    "/teams/supervisors",
    {
      preHandler: [requireAuth("admin"), requirePermission("supervisors:read")],
      schema: {
        tags: ["Teams"],
        summary: "List supervisors (partner / expert operations)",
        description:
          "Super Admin sees every supervisor; other admins see supervisors they created or that are assigned to them (including those owned by their descendant team members).",
        security: [{ bearerAuth: [] }],
        querystring: searchQuerySchema,
        response: { 200: paginatedResponseSchema(supervisorListItemSchema), ...authedErrorResponses },
      },
    },
    async (request) =>
      adminSupervisorService.list(request.query, adminActorRole(request.auth), request.auth!.id),
  );

  app.post(
    "/teams/supervisors",
    {
      preHandler: [requireAuth("admin"), requirePermission("supervisors:create")],
      schema: {
        tags: ["Teams"],
        summary: "Create a supervisor",
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
        return reply
          .code(201)
          .send(await adminSupervisorService.create({ ...request.body, createdBy: request.auth!.id }));
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        const mapped = mapSupervisorError(err.message);
        if (!mapped) throw err;
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.get(
    "/teams/supervisors/:id",
    {
      preHandler: [requireAuth("admin"), requirePermission("supervisors:read")],
      schema: {
        tags: ["Teams"],
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
        if (!(err instanceof Error)) throw err;
        const mapped = mapSupervisorError(err.message);
        if (!mapped) throw err;
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.patch(
    "/teams/supervisors/:id",
    {
      preHandler: [requireAuth("admin"), requirePermission("supervisors:update")],
      schema: {
        tags: ["Teams"],
        summary: "Update a supervisor",
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
        if (!(err instanceof Error)) throw err;
        const mapped = mapSupervisorError(err.message);
        if (!mapped) throw err;
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.delete(
    "/teams/supervisors/:id",
    {
      preHandler: [requireAuth("admin"), requirePermission("supervisors:delete")],
      schema: {
        tags: ["Teams"],
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
        if (!(err instanceof Error)) throw err;
        const mapped = mapSupervisorError(err.message);
        if (!mapped) throw err;
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );
};

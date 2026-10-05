import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../../lib/auth/require-auth";
import { requirePermission } from "../../lib/auth/permissions";
import { authedErrorResponses, errorResponseSchema } from "../../lib/auth/schemas";
import { adminRoleDtoSchema } from "../../lib/api-schemas";
import { replyMapped } from "../../lib/rbac-errors";
import { adminRoleService } from "../../services/admin-role-service";
import { optionalSearchQuerySchema } from "../../lib/pagination";

const roleWriteSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  roleName: z.string().min(1).max(60).optional(),
  permissions: z.array(z.string().min(1)).optional(),
  moduleIds: z.array(z.string().uuid()).optional(),
  isActive: z.boolean().optional(),
  isAdmin: z.boolean().optional(),
});

const createRoleBodySchema = roleWriteSchema
  .extend({ description: z.string().max(2000).optional() })
  .refine((body) => Boolean(body.name || body.roleName), {
    message: "name or roleName is required",
  });

const updateRoleBodySchema = roleWriteSchema.extend({
  description: z.string().max(2000).nullable().optional(),
});

const idParamsSchema = z.object({ id: z.string().uuid() });
const writeErrors = { 400: errorResponseSchema, ...authedErrorResponses, 409: errorResponseSchema } as const;

export const adminRoleRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/admin/roles",
    {
      preHandler: [requireAuth("admin"), requirePermission("admins:read")],
      schema: {
        tags: ["Admin Roles"],
        summary: "List assignable roles with modules (excludes super_admin)",
        security: [{ bearerAuth: [] }],
        querystring: optionalSearchQuerySchema,
        response: { 200: z.array(adminRoleDtoSchema), ...authedErrorResponses },
      },
    },
    async (request) => adminRoleService.list(request.query),
  );

  app.get(
    "/admin/roles/all",
    {
      preHandler: [requireAuth("admin"), requirePermission("admins:read")],
      schema: {
        tags: ["Admin Roles"],
        summary: "List every role including Super Admin",
        security: [{ bearerAuth: [] }],
        querystring: optionalSearchQuerySchema,
        response: { 200: z.array(adminRoleDtoSchema), ...authedErrorResponses },
      },
    },
    async (request) => adminRoleService.listAll(request.query),
  );

  app.post(
    "/admin/roles",
    {
      preHandler: [requireAuth("admin"), requirePermission("admins:*")],
      schema: {
        tags: ["Admin Roles"],
        summary: "Create a role",
        description:
          "Pass name (display) and optional slug. Roles only see the modules in moduleIds. Super Admin always has non-System modules; assign System modules on that role.",
        security: [{ bearerAuth: [] }],
        body: createRoleBodySchema,
        response: { 201: adminRoleDtoSchema, ...writeErrors },
      },
    },
    async (request, reply) => {
      try {
        return reply.code(201).send(await adminRoleService.create(request.body));
      } catch (err) {
        return replyMapped(reply, err);
      }
    },
  );

  app.get(
    "/admin/roles/:id",
    {
      preHandler: [requireAuth("admin"), requirePermission("admins:read")],
      schema: {
        tags: ["Admin Roles"],
        summary: "Get a role with modules and affected user count",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: { 200: adminRoleDtoSchema, ...authedErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return await adminRoleService.getById(request.params.id);
      } catch (err) {
        return replyMapped(reply, err);
      }
    },
  );

  app.patch(
    "/admin/roles/:id",
    {
      preHandler: [requireAuth("admin"), requirePermission("admins:*")],
      schema: {
        tags: ["Admin Roles"],
        summary: "Update a role and its assigned modules",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        body: updateRoleBodySchema,
        response: { 200: adminRoleDtoSchema, ...writeErrors },
      },
    },
    async (request, reply) => {
      try {
        return await adminRoleService.update(request.params.id, request.body);
      } catch (err) {
        return replyMapped(reply, err);
      }
    },
  );

  app.delete(
    "/admin/roles/:id",
    {
      preHandler: [requireAuth("admin"), requirePermission("admins:*")],
      schema: {
        tags: ["Admin Roles"],
        summary: "Delete a role (blocked if users are assigned)",
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
};

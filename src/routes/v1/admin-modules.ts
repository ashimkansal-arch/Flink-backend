import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../../lib/auth/require-auth";
import { requirePermission } from "../../lib/auth/permissions";
import { authedErrorResponses, errorResponseSchema } from "../../lib/auth/schemas";
import { adminModuleService } from "../../services/admin-module-service";
import { SIDEBAR_SECTION_NAMES } from "../../lib/sidebar-sections";
import { CRM_SCREEN_PATHS } from "../../lib/crm-screens";
import { MODULE_ICON_NAMES } from "../../lib/module-icons";
import { replyMapped } from "../../lib/rbac-errors";
import { optionalSearchQuerySchema } from "../../lib/pagination";

const roleRefSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
});

const moduleDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  sectionName: z.string(),
  sectionSlug: z.string(),
  path: z.string(),
  icon: z.string(),
  displayOrder: z.number().int(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  roles: z.array(roleRefSchema),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

const createModuleBodySchema = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().min(1).max(80).optional(),
  sectionName: z.enum(SIDEBAR_SECTION_NAMES).optional(),
  path: z.enum(CRM_SCREEN_PATHS),
  icon: z.enum(MODULE_ICON_NAMES).optional(),
  displayOrder: z.number().int().min(0).max(9999).optional(),
  description: z.string().max(2000).optional(),
  roleIds: z.array(z.string().uuid()).optional(),
});

const updateModuleBodySchema = z.object({
  name: z.string().min(1).max(80).optional(),
  slug: z.string().min(1).max(80).optional(),
  sectionName: z.enum(SIDEBAR_SECTION_NAMES).optional(),
  path: z.enum(CRM_SCREEN_PATHS).optional(),
  icon: z.enum(MODULE_ICON_NAMES).optional(),
  displayOrder: z.number().int().min(0).max(9999).optional(),
  description: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
  roleIds: z.array(z.string().uuid()).optional(),
});

const idParamsSchema = z.object({ id: z.string().uuid() });
const writeErrors = { 400: errorResponseSchema, ...authedErrorResponses, 409: errorResponseSchema } as const;

export const adminModuleRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/admin/modules",
    {
      preHandler: [requireAuth("admin"), requirePermission("admins:read")],
      schema: {
        tags: ["Admin Modules"],
        summary: "List CRM modules",
        security: [{ bearerAuth: [] }],
        querystring: optionalSearchQuerySchema,
        response: { 200: z.array(moduleDtoSchema), ...authedErrorResponses },
      },
    },
    async (request) => adminModuleService.list(request.query),
  );

  app.post(
    "/admin/modules",
    {
      preHandler: [requireAuth("admin"), requirePermission("admins:*")],
      schema: {
        tags: ["Admin Modules"],
        summary: "Create a CRM module and assign it to selected roles",
        description:
          "path must be a real CRM screen. sectionName is Operations, Catalog, Finance, Geo, Engagement, or System. roleIds assigns this module to other roles. System modules only appear for roles they are assigned to.",
        security: [{ bearerAuth: [] }],
        body: createModuleBodySchema,
        response: { 201: moduleDtoSchema, ...writeErrors },
      },
    },
    async (request, reply) => {
      try {
        return reply.code(201).send(await adminModuleService.create(request.body));
      } catch (err) {
        return replyMapped(reply, err);
      }
    },
  );

  app.patch(
    "/admin/modules/:id",
    {
      preHandler: [requireAuth("admin"), requirePermission("admins:*")],
      schema: {
        tags: ["Admin Modules"],
        summary: "Update a module, including active/disable and role access",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        body: updateModuleBodySchema,
        response: { 200: moduleDtoSchema, ...writeErrors },
      },
    },
    async (request, reply) => {
      try {
        return await adminModuleService.update(request.params.id, request.body);
      } catch (err) {
        return replyMapped(reply, err);
      }
    },
  );
};

import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../../lib/auth/require-auth";
import { requirePermission, requireAnyPermission, CATEGORY_PICKER_PERMISSIONS } from "../../lib/auth/permissions";
import { authedErrorResponses, errorResponseSchema } from "../../lib/auth/schemas";
import {
  okResponseSchema,
  catalogIconUploadResponseSchema,
  categoryAdminListStatsSchema,
  subcategoryAdminListStatsSchema,
} from "../../lib/api-schemas";
import { adminCategoryService } from "../../services/admin-category-service";
import { adminCategoryIconService } from "../../services/admin-category-icon-service";
import { searchQuerySchema, paginatedResponseSchema } from "../../lib/pagination";
import { readMultipartFile } from "../../lib/multipart";
import { catalogIconMultipartBodySchema, UPLOAD_FORM_FIELDS } from "../../lib/upload-form";
import { replyUploadError, sendUploadError } from "../../lib/upload-route";

const categoryFieldsSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  iconUrl: z.string().nullable(),
  iconDisplayUrl: z.string().nullable(),
  includedTasks: z.array(z.string()),
  excludedTasks: z.array(z.string()),
  isActive: z.boolean(),
  displayOrder: z.number().int(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

const subcategoryDtoSchema = categoryFieldsSchema.extend({
  categoryId: z.string().uuid(),
  pricePaise: z.number().int().nullable(),
  sessionMinutes: z.number().int().nullable(),
  bookingCount: z.number().int(),
});
const categoryDtoSchema = categoryFieldsSchema.extend({
  subcategories: z.array(subcategoryDtoSchema),
});

const categoryBodySchema = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().min(1).max(80).optional(),
  description: z.string().max(2000).nullable().optional(),
  iconUrl: z
    .string()
    .max(2000)
    .nullable()
    .optional()
    .describe("S3 object key without host (catalog/icons/…) or an external image URL"),
  includedTasks: z.array(z.string().min(1)).optional(),
  excludedTasks: z.array(z.string().min(1)).optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().min(1).max(2_147_483_647).optional(),
});

const subcategoryBodySchema = categoryBodySchema.extend({
  pricePaise: z.number().int().positive(),
  sessionMinutes: z.number().int().min(1).max(24 * 60),
});

const idParamsSchema = z.object({ id: z.string().uuid() });
const categoryIdParamsSchema = z.object({ categoryId: z.string().uuid() });
const writeErrorResponses = {
  400: errorResponseSchema,
  ...authedErrorResponses,
  409: errorResponseSchema,
} as const;

function adminCan(permission: string) {
  return [requireAuth("admin"), requirePermission(permission)];
}

function adminCanPickCategory() {
  return [requireAuth("admin"), requireAnyPermission(CATEGORY_PICKER_PERMISSIONS)];
}

const ERROR_STATUS: Record<string, 400 | 404 | 409> = {
  CATEGORY_NOT_FOUND: 404,
  SUBCATEGORY_NOT_FOUND: 404,
  SLUG_TAKEN: 409,
  CATEGORY_HAS_SUBCATEGORIES: 409,
  CATEGORY_IN_USE: 409,
  INVALID_SLUG: 400,
};

function mappedCategoryError(err: unknown): { status: 400 | 404 | 409; error: string } {
  if (!(err instanceof Error)) throw err;
  const status = ERROR_STATUS[err.message];
  if (!status) throw err;
  return { status, error: err.message };
}

export const adminCategoryRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/admin/categories",
    {
      preHandler: adminCanPickCategory(),
      schema: {
        tags: ["Admin Categories"],
        summary: "List categories with nested sub-categories",
        description:
          "Requires categories:read, or supervisor/provider read/create/update permissions (for category pickers on those forms). Includes directory-wide stats.",
        security: [{ bearerAuth: [] }],
        querystring: searchQuerySchema,
        response: {
          200: paginatedResponseSchema(categoryDtoSchema).extend({ stats: categoryAdminListStatsSchema }),
          ...authedErrorResponses,
        },
      },
    },
    async (request) => adminCategoryService.list(request.query),
  );

  app.post(
    "/admin/categories/icons",
    {
      preHandler: [requireAuth("admin"), requireAnyPermission(["categories:create", "categories:update"])],
      schema: {
        tags: ["Admin Categories"],
        summary: "Upload a catalog icon",
        description: [
          `Send multipart/form-data with field ${UPLOAD_FORM_FIELDS.file} (JPG, PNG, or WebP; max 2 MB).`,
          "The image is resized to 256px WebP for mobile. Response iconUrl is the S3 object key (no bucket host).",
          "Save that key on create/update category as iconUrl. iconDisplayUrl is a short-lived preview URL.",
        ].join(" "),
        security: [{ bearerAuth: [] }],
        consumes: ["multipart/form-data"],
        body: catalogIconMultipartBodySchema,
        response: {
          200: catalogIconUploadResponseSchema,
          400: errorResponseSchema,
          502: errorResponseSchema,
          ...authedErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const upload = await readMultipartFile(request);
        if (!upload.buffer) {
          return sendUploadError(reply, "INVALID_UPLOAD");
        }
        return await adminCategoryIconService.upload({
          filename: upload.filename,
          mimetype: upload.mimetype,
          buffer: upload.buffer,
        });
      } catch (err) {
        if (replyUploadError(reply, err)) return;
        throw err;
      }
    },
  );

  app.post(
    "/admin/categories",
    {
      preHandler: adminCan("categories:create"),
      schema: {
        tags: ["Admin Categories"],
        summary: "Create a category",
        security: [{ bearerAuth: [] }],
        body: categoryBodySchema,
        response: { 201: categoryDtoSchema, ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return reply.code(201).send(await adminCategoryService.create(request.body));
      } catch (err) {
        const mapped = mappedCategoryError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.get(
    "/admin/categories/:id",
    {
      preHandler: adminCanPickCategory(),
      schema: {
        tags: ["Admin Categories"],
        summary: "Get a category",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: { 200: categoryDtoSchema, ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return await adminCategoryService.getById(request.params.id);
      } catch (err) {
        const mapped = mappedCategoryError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.patch(
    "/admin/categories/:id",
    {
      preHandler: adminCan("categories:update"),
      schema: {
        tags: ["Admin Categories"],
        summary: "Update a category",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        body: categoryBodySchema.partial(),
        response: { 200: categoryDtoSchema, ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return await adminCategoryService.update(request.params.id, request.body);
      } catch (err) {
        const mapped = mappedCategoryError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.delete(
    "/admin/categories/:id",
    {
      preHandler: adminCan("categories:delete"),
      schema: {
        tags: ["Admin Categories"],
        summary: "Delete a category (blocked if it has sub-categories or bookings)",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: { 200: okResponseSchema, ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        await adminCategoryService.remove(request.params.id);
        return reply.code(200).send({ ok: true });
      } catch (err) {
        const mapped = mappedCategoryError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.get(
    "/admin/categories/:categoryId/subcategories",
    {
      preHandler: adminCanPickCategory(),
      schema: {
        tags: ["Admin Categories"],
        summary: "List sub-categories for a category",
        description: "Includes category-wide stats (active, inactive, most-selling booking count).",
        security: [{ bearerAuth: [] }],
        params: categoryIdParamsSchema,
        querystring: searchQuerySchema,
        response: {
          200: paginatedResponseSchema(subcategoryDtoSchema).extend({
            stats: subcategoryAdminListStatsSchema,
          }),
          ...writeErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        return await adminCategoryService.listSubcategories(request.params.categoryId, request.query);
      } catch (err) {
        const mapped = mappedCategoryError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.post(
    "/admin/categories/:categoryId/subcategories",
    {
      preHandler: adminCan("categories:create"),
      schema: {
        tags: ["Admin Categories"],
        summary: "Create a sub-category",
        security: [{ bearerAuth: [] }],
        params: categoryIdParamsSchema,
        body: subcategoryBodySchema,
        response: { 201: subcategoryDtoSchema, ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return reply.code(201).send(await adminCategoryService.createSubcategory(request.params.categoryId, request.body));
      } catch (err) {
        const mapped = mappedCategoryError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.get(
    "/admin/subcategories/:id",
    {
      preHandler: adminCanPickCategory(),
      schema: {
        tags: ["Admin Categories"],
        summary: "Get a sub-category",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: { 200: subcategoryDtoSchema, ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return await adminCategoryService.getSubcategoryById(request.params.id);
      } catch (err) {
        const mapped = mappedCategoryError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.patch(
    "/admin/subcategories/:id",
    {
      preHandler: adminCan("categories:update"),
      schema: {
        tags: ["Admin Categories"],
        summary: "Update a sub-category",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        body: subcategoryBodySchema.partial(),
        response: { 200: subcategoryDtoSchema, ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return await adminCategoryService.updateSubcategory(request.params.id, request.body);
      } catch (err) {
        const mapped = mappedCategoryError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.delete(
    "/admin/subcategories/:id",
    {
      preHandler: adminCan("categories:delete"),
      schema: {
        tags: ["Admin Categories"],
        summary: "Delete a sub-category (blocked if it has bookings)",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: { 200: okResponseSchema, ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        await adminCategoryService.removeSubcategory(request.params.id);
        return reply.code(200).send({ ok: true });
      } catch (err) {
        const mapped = mappedCategoryError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );
};

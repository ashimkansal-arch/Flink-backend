import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../../lib/auth/require-auth";
import { requirePermission } from "../../lib/auth/permissions";
import { authedErrorResponses, errorResponseSchema } from "../../lib/auth/schemas";
import { couponAdminDtoSchema, couponAdminListStatsSchema } from "../../lib/api-schemas";
import { paginatedResponseSchema, searchQuerySchema } from "../../lib/pagination";
import { adminCouponService } from "../../services/admin-coupon-service";

const idParamsSchema = z.object({ id: z.string().uuid() });
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const discountTypeSchema = z.enum(["percent", "flat"]);

const createBodySchema = z.object({
  code: z.string().min(3).max(20),
  description: z.string().min(1).max(120),
  discountType: discountTypeSchema,
  percentOff: z.number().int().min(1).max(100).nullable().optional(),
  amountOffPaise: z.number().int().min(100).nullable().optional(),
  maxUses: z.number().int().min(1).max(10_000_000),
  isActive: z.boolean().optional(),
  expiresAt: dateOnlySchema,
});

const updateBodySchema = z.object({
  code: z.string().min(3).max(20).optional(),
  description: z.string().min(1).max(120).optional(),
  discountType: discountTypeSchema.optional(),
  percentOff: z.number().int().min(1).max(100).nullable().optional(),
  amountOffPaise: z.number().int().min(100).nullable().optional(),
  maxUses: z.number().int().min(1).max(10_000_000).optional(),
  isActive: z.boolean().optional(),
  expiresAt: dateOnlySchema.optional(),
});

const writeErrorResponses = {
  400: errorResponseSchema,
  ...authedErrorResponses,
  409: errorResponseSchema,
} as const;

const ERROR_STATUS: Record<string, 400 | 404 | 409> = {
  COUPON_NOT_FOUND: 404,
  CODE_TAKEN: 409,
  INVALID_CODE: 400,
  INVALID_EXPIRY: 400,
  INVALID_PERCENT: 400,
  INVALID_AMOUNT: 400,
  INVALID_MAX_USES: 400,
};

function mappedError(err: unknown): { status: 400 | 404 | 409; error: string } {
  if (!(err instanceof Error)) throw err;
  const status = ERROR_STATUS[err.message];
  if (!status) throw err;
  return { status, error: err.message };
}

export const adminCouponRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/admin/coupons",
    {
      preHandler: [requireAuth("admin"), requirePermission("coupons:read")],
      schema: {
        tags: ["Admin Coupons"],
        summary: "List coupons",
        security: [{ bearerAuth: [] }],
        querystring: searchQuerySchema,
        response: {
          200: paginatedResponseSchema(couponAdminDtoSchema).extend({
            stats: couponAdminListStatsSchema,
          }),
          ...authedErrorResponses,
        },
      },
    },
    async (request) => adminCouponService.list(request.query),
  );

  app.get(
    "/admin/coupons/:id",
    {
      preHandler: [requireAuth("admin"), requirePermission("coupons:read")],
      schema: {
        tags: ["Admin Coupons"],
        summary: "Get a coupon",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: { 200: couponAdminDtoSchema, ...authedErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return await adminCouponService.getById(request.params.id);
      } catch (err) {
        if (err instanceof Error && err.message === "COUPON_NOT_FOUND") {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.post(
    "/admin/coupons",
    {
      preHandler: [requireAuth("admin"), requirePermission("coupons:create")],
      schema: {
        tags: ["Admin Coupons"],
        summary: "Create a coupon",
        security: [{ bearerAuth: [] }],
        body: createBodySchema,
        response: { 201: couponAdminDtoSchema, ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        const coupon = await adminCouponService.create(request.body);
        return reply.code(201).send(coupon);
      } catch (err) {
        const mapped = mappedError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.patch(
    "/admin/coupons/:id",
    {
      preHandler: [requireAuth("admin"), requirePermission("coupons:update")],
      schema: {
        tags: ["Admin Coupons"],
        summary: "Update a coupon",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        body: updateBodySchema,
        response: { 200: couponAdminDtoSchema, ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return await adminCouponService.update(request.params.id, request.body);
      } catch (err) {
        const mapped = mappedError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.delete(
    "/admin/coupons/:id",
    {
      preHandler: [requireAuth("admin"), requirePermission("coupons:delete")],
      schema: {
        tags: ["Admin Coupons"],
        summary: "Delete a coupon",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: { 204: z.null(), ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        await adminCouponService.remove(request.params.id);
        return reply.code(204).send(null);
      } catch (err) {
        const mapped = mappedError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );
};

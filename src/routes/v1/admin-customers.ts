import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../lib/auth/require-auth";
import { requirePermission, requireSuperAdmin } from "../../lib/auth/permissions";
import { authedErrorResponses } from "../../lib/auth/schemas";
import {
  customerAdminDtoSchema,
  customerAdminListStatsSchema,
  mapPointSchema,
  updateCustomerStatusBodySchema,
} from "../../lib/api-schemas";
import { customerListQuerySchema, paginatedResponseSchema } from "../../lib/pagination";
import { adminCustomerService } from "../../services/admin-customer-service";

const idParamsSchema = z.object({ id: z.string().uuid() });
const customerRead = [requireAuth("admin"), requirePermission("customers:read")];
const customerWrite = [requireAuth("admin"), requireSuperAdmin()];

async function withCustomer<T>(reply: FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Error && err.message === "CUSTOMER_NOT_FOUND") {
      return reply.code(404).send({ error: err.message });
    }
    throw err;
  }
}

export const adminCustomerRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/admin/customers",
    {
      preHandler: customerRead,
      schema: {
        tags: ["Admin Customers"],
        summary: "List app customers",
        description:
          "Returns User records with role=customer. Excludes deleted. Supports q (name/phone/email), status (active,blocked), and isPhoneVerified. Includes directory-wide stats.",
        security: [{ bearerAuth: [] }],
        querystring: customerListQuerySchema,
        response: {
          200: paginatedResponseSchema(customerAdminDtoSchema).extend({
            stats: customerAdminListStatsSchema,
            mapPoints: z.array(mapPointSchema),
          }),
          ...authedErrorResponses,
        },
      },
    },
    async (request) => adminCustomerService.list(request.query),
  );

  app.get(
    "/admin/customers/:id",
    {
      preHandler: customerRead,
      schema: {
        tags: ["Admin Customers"],
        summary: "Get a customer by id",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: {
          200: customerAdminDtoSchema,
          ...authedErrorResponses,
        },
      },
    },
    async (request, reply) =>
      withCustomer(reply, () => adminCustomerService.getById(request.params.id)),
  );

  app.patch(
    "/admin/customers/:id",
    {
      preHandler: customerWrite,
      schema: {
        tags: ["Admin Customers"],
        summary: "Disable or re-enable a customer (Super Admin)",
        description:
          "Sets status to blocked (disable) or active. Blocked customers cannot log in or refresh tokens. Super Admin only.",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        body: updateCustomerStatusBodySchema,
        response: {
          200: customerAdminDtoSchema,
          ...authedErrorResponses,
        },
      },
    },
    async (request, reply) =>
      withCustomer(reply, () =>
        adminCustomerService.updateStatus(request.params.id, request.body.status),
      ),
  );

  app.delete(
    "/admin/customers/:id",
    {
      preHandler: customerWrite,
      schema: {
        tags: ["Admin Customers"],
        summary: "Soft-delete a customer (Super Admin)",
        description:
          "Sets status to deleted and records deletedAt. Revokes refresh tokens. The row is kept because bookings and payments reference it. Super Admin only.",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: {
          204: z.null(),
          ...authedErrorResponses,
        },
      },
    },
    async (request, reply) =>
      withCustomer(reply, async () => {
        await adminCustomerService.remove(request.params.id);
        return reply.code(204).send(null);
      }),
  );
};

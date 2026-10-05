import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../../lib/auth/require-auth";
import { authedErrorResponses, errorResponseSchema } from "../../lib/auth/schemas";
import { customerCouponService } from "../../services/customer-coupon-service";

const applyBodySchema = z.object({
  code: z.string().min(3).max(20),
  pricePaise: z.number().int().positive(),
});

const applyResponseSchema = z.object({
  code: z.string(),
  description: z.string(),
  discountType: z.enum(["percent", "flat"]),
  percentOff: z.number().int().nullable(),
  amountOffPaise: z.number().int().nullable(),
  pricePaise: z.number().int(),
  discountPaise: z.number().int(),
  updatedPricePaise: z.number().int(),
});

const ERROR_STATUS: Record<string, 400 | 404> = {
  INVALID_CODE: 400,
  COUPON_NOT_FOUND: 404,
  COUPON_INACTIVE: 400,
  COUPON_EXPIRED: 400,
  COUPON_EXHAUSTED: 400,
  COUPON_NOT_APPLICABLE: 400,
};

const ERROR_MESSAGE: Record<string, string> = {
  INVALID_CODE: "Enter a valid coupon code",
  COUPON_NOT_FOUND: "This coupon code is not valid",
  COUPON_INACTIVE: "This coupon is no longer active",
  COUPON_EXPIRED: "This coupon has expired",
  COUPON_EXHAUSTED: "This coupon has reached its usage limit",
  COUPON_NOT_APPLICABLE: "This coupon cannot be applied to the given price",
};

export const customerCouponRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/customer/coupons/apply",
    {
      preHandler: requireAuth("customer"),
      schema: {
        tags: ["Customer Coupons"],
        summary: "Validate a coupon and return the discounted price",
        description:
          "Checks that the coupon exists, is active, has not expired, and still has uses left. Then applies a percent or flat discount to pricePaise. Does not consume a use.",
        security: [{ bearerAuth: [] }],
        body: applyBodySchema,
        response: {
          ...authedErrorResponses,
          200: applyResponseSchema,
          400: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await customerCouponService.apply(request.body.code, request.body.pricePaise);
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        const status = ERROR_STATUS[err.message];
        if (!status) throw err;
        return reply.code(status).send({ error: ERROR_MESSAGE[err.message] ?? err.message });
      }
    },
  );
};

import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../../lib/auth/require-auth";
import { requirePermission } from "../../lib/auth/permissions";
import { authedErrorResponses, errorResponseSchema } from "../../lib/auth/schemas";
import { legalSupportContentSchema } from "../../lib/api-schemas";
import { legalSupportService } from "../../services/legal-support-service";

const legalCopySchema = z.string().max(100_000);

const updateBodySchema = z.object({
  termsOfService: legalCopySchema,
  privacyPolicy: legalCopySchema,
  refundPolicy: legalCopySchema,
  cancellationPolicy: legalCopySchema,
  pricingAndPayment: legalCopySchema,
  contactEmail: z
    .string()
    .trim()
    .max(160)
    .nullable()
    .transform((value) => (value ? value : null))
    .refine((value) => value == null || z.string().email().safeParse(value).success, {
      message: "Invalid email",
    }),
  contactPhone: z
    .string()
    .trim()
    .max(20)
    .nullable()
    .transform((value) => (value ? value : null))
    .refine((value) => value == null || value.length >= 8, { message: "Invalid phone" }),
  faqs: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        question: z.string().trim().min(1).max(240),
        answer: z.string().trim().min(1).max(10_000),
      }),
    )
    .max(50),
});

const ERROR_STATUS: Record<string, 400> = {
  INVALID_FAQ: 400,
};

export const adminLegalSupportRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/admin/legal-support",
    {
      preHandler: [requireAuth("admin"), requirePermission("legal-support:update")],
      schema: {
        tags: ["Admin Legal & Support"],
        summary: "Get Legal & Support content",
        security: [{ bearerAuth: [] }],
        response: { 200: legalSupportContentSchema, ...authedErrorResponses },
      },
    },
    async () => legalSupportService.get(),
  );

  app.put(
    "/admin/legal-support",
    {
      preHandler: [requireAuth("admin"), requirePermission("legal-support:update")],
      schema: {
        tags: ["Admin Legal & Support"],
        summary: "Replace Terms, Privacy, Refund, Cancellation, Pricing, FAQs, and contact details",
        security: [{ bearerAuth: [] }],
        body: updateBodySchema,
        response: {
          200: legalSupportContentSchema,
          400: errorResponseSchema,
          ...authedErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        return await legalSupportService.update(request.body, request.auth!.id);
      } catch (err) {
        if (err instanceof Error && ERROR_STATUS[err.message]) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );
};

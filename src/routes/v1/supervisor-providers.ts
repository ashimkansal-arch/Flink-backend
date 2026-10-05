import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../../lib/auth/require-auth";
import { authedErrorResponses, errorResponseSchema } from "../../lib/auth/schemas";
import {
  providerKycReviewResponseSchema,
  supervisorProviderKycSchema,
} from "../../lib/api-schemas";
import { providerKycService } from "../../services/provider-kyc-service";

const providerIdParamsSchema = z.object({ providerId: z.string().uuid() });
const documentParamsSchema = z.object({
  providerId: z.string().uuid(),
  documentId: z.string().uuid(),
});

const reviewBodySchema = z.object({
  action: z.enum(["approve", "reject"]),
  rejectionReason: z.string().min(1).max(500).optional(),
});

/** Supervisor-scoped aliases. Prefer /admin/providers/:id/kyc for shared admin+supervisor clients. */
export const supervisorProviderRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/supervisor/providers/:providerId/kyc",
    {
      preHandler: requireAuth("supervisor"),
      schema: {
        tags: ["Supervisor Providers"],
        summary: "Fetch provider KYC documents",
        description: "Only providers registered by this supervisor. Returns presigned download URLs (private S3).",
        security: [{ bearerAuth: [] }],
        params: providerIdParamsSchema,
        response: { 200: supervisorProviderKycSchema, ...authedErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return await providerKycService.listForStaff(request.params.providerId, {
          registeredBySupervisorIds: [request.auth!.id],
        });
      } catch (err) {
        if (err instanceof Error && err.message === "PROVIDER_NOT_FOUND") {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.patch(
    "/supervisor/providers/:providerId/kyc/documents/:documentId",
    {
      preHandler: requireAuth("supervisor"),
      schema: {
        tags: ["Supervisor Providers"],
        summary: "Approve or reject a provider KYC document",
        security: [{ bearerAuth: [] }],
        params: documentParamsSchema,
        body: reviewBodySchema,
        response: {
          200: providerKycReviewResponseSchema,
          400: errorResponseSchema,
          ...authedErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        return await providerKycService.reviewDocument(
          request.params.providerId,
          request.params.documentId,
          request.body,
          { type: "supervisor", id: request.auth!.id },
          { registeredBySupervisorIds: [request.auth!.id] },
        );
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        if (err.message === "PROVIDER_NOT_FOUND" || err.message === "DOCUMENT_NOT_FOUND") {
          return reply.code(404).send({ error: err.message });
        }
        if (err.message === "REJECTION_REASON_REQUIRED") {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );
};

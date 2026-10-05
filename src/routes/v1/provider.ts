import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../../lib/auth/require-auth";
import { authedErrorResponses, errorResponseSchema } from "../../lib/auth/schemas";
import {
  providerKycUploadResponseSchema,
  providerKycListSchema,
  providerOfflineRequestSchema,
} from "../../lib/api-schemas";
import { readMultipartKycUpload } from "../../lib/multipart";
import { providerService } from "../../services/provider-service";
import { providerKycService } from "../../services/provider-kyc-service";
import { providerOfflineRequestService } from "../../services/provider-offline-request-service";
import { PROVIDER_KYC_DOCUMENT_TYPES } from "../../lib/provider-kyc";
import { providerKycDocumentMultipartBodySchema, UPLOAD_FORM_FIELDS } from "../../lib/upload-form";
import { replyProviderAccountError, replyUploadError, sendUploadError } from "../../lib/upload-route";

const updateStatusBodySchema = z.object({
  status: z.enum(["online", "offline"]),
  lat: z.number().gte(-90).lte(90),
  long: z.number().gte(-180).lte(180),
});

const providerStatusResponseSchema = z.object({
  status: z.enum(["online", "offline"]),
  lat: z.number(),
  long: z.number(),
  isAvailable: z.boolean(),
  locationUpdatedAt: z.coerce.date(),
});

const createOfflineRequestBodySchema = z.object({
  reason: z.string().min(1).max(500),
  lat: z.number().gte(-90).lte(90).optional(),
  long: z.number().gte(-180).lte(180).optional(),
});

const offlineRequestIdParamsSchema = z.object({ id: z.string().uuid() });

export const providerRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/provider/me/kyc",
    {
      preHandler: requireAuth("provider"),
      schema: {
        tags: ["Provider"],
        summary: "List uploaded KYC documents",
        security: [{ bearerAuth: [] }],
        response: { 200: providerKycListSchema, ...authedErrorResponses },
      },
    },
    async (request) => providerKycService.listForProvider(request.auth!.id),
  );

  app.post(
    "/provider/me/kyc/documents",
    {
      preHandler: requireAuth("provider"),
      schema: {
        tags: ["Provider"],
        summary: "Upload a KYC document (multipart/form-data)",
        description: [
          "Send multipart/form-data with:",
          `${UPLOAD_FORM_FIELDS.documentType}: id_proof or address_proof`,
          `${UPLOAD_FORM_FIELDS.file}: JPG, JPEG, PNG, or PDF (max 5 MB).`,
          "Private S3 storage under providers/kyc/.",
        ].join(" "),
        security: [{ bearerAuth: [] }],
        consumes: ["multipart/form-data"],
        body: providerKycDocumentMultipartBodySchema,
        response: {
          201: providerKycUploadResponseSchema,
          400: errorResponseSchema,
          502: errorResponseSchema,
          ...authedErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const upload = await readMultipartKycUpload(request, PROVIDER_KYC_DOCUMENT_TYPES);
        if (!upload.buffer) {
          return sendUploadError(reply, "INVALID_UPLOAD");
        }
        if (!upload.documentType) {
          return sendUploadError(reply, "INVALID_DOCUMENT_TYPE");
        }
        const result = await providerKycService.uploadDocument(request.auth!.id, upload.documentType, {
          filename: upload.filename,
          mimetype: upload.mimetype,
          buffer: upload.buffer,
        });
        return reply.code(201).send(result);
      } catch (err) {
        if (replyUploadError(reply, err)) return;
        if (err instanceof Error && err.message === "PROVIDER_NOT_FOUND") {
          return reply.code(404).send({ error: err.message });
        }
        if (replyProviderAccountError(reply, err)) return;
        throw err;
      }
    },
  );

  app.get(
    "/provider/me/offline-requests",
    {
      preHandler: requireAuth("provider"),
      schema: {
        tags: ["Provider"],
        summary: "List my offline requests",
        security: [{ bearerAuth: [] }],
        response: {
          200: z.object({ items: z.array(providerOfflineRequestSchema) }),
          ...authedErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const items = await providerOfflineRequestService.listForProvider(request.auth!.id);
        return { items };
      } catch (err) {
        if (err instanceof Error && err.message === "PROVIDER_NOT_FOUND") {
          return reply.code(404).send({ error: err.message });
        }
        if (replyProviderAccountError(reply, err)) return;
        throw err;
      }
    },
  );

  app.post(
    "/provider/me/offline-requests",
    {
      preHandler: requireAuth("provider"),
      schema: {
        tags: ["Provider"],
        summary: "Request to go offline (requires staff approval)",
        security: [{ bearerAuth: [] }],
        body: createOfflineRequestBodySchema,
        response: {
          201: providerOfflineRequestSchema,
          400: errorResponseSchema,
          409: errorResponseSchema,
          ...authedErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await providerOfflineRequestService.create(request.auth!.id, request.body);
        return reply.code(201).send(result);
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        if (err.message === "PROVIDER_NOT_FOUND") {
          return reply.code(404).send({ error: err.message });
        }
        if (err.message === "REASON_REQUIRED") {
          return reply.code(400).send({ error: err.message });
        }
        if (err.message === "ALREADY_OFFLINE" || err.message === "OFFLINE_REQUEST_PENDING") {
          return reply.code(409).send({ error: err.message });
        }
        if (replyProviderAccountError(reply, err)) return;
        throw err;
      }
    },
  );

  app.post(
    "/provider/me/offline-requests/:id/cancel",
    {
      preHandler: requireAuth("provider"),
      schema: {
        tags: ["Provider"],
        summary: "Cancel my pending offline request",
        security: [{ bearerAuth: [] }],
        params: offlineRequestIdParamsSchema,
        response: {
          200: providerOfflineRequestSchema,
          400: errorResponseSchema,
          ...authedErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        return await providerOfflineRequestService.cancel(request.auth!.id, request.params.id);
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        if (err.message === "OFFLINE_REQUEST_NOT_FOUND") {
          return reply.code(404).send({ error: err.message });
        }
        if (err.message === "OFFLINE_REQUEST_NOT_PENDING") {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.patch(
    "/provider/me/status",
    {
      preHandler: requireAuth("provider"),
      schema: {
        tags: ["Provider"],
        summary: "Set online availability (offline requires an offline request)",
        description:
          "Online updates isAvailable immediately. Offline returns 403 OFFLINE_REQUEST_REQUIRED — use POST /provider/me/offline-requests.",
        security: [{ bearerAuth: [] }],
        body: updateStatusBodySchema,
        response: {
          200: providerStatusResponseSchema,
          ...authedErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        return await providerService.updateStatus(request.auth!.id, request.body);
      } catch (err) {
        if (err instanceof Error && err.message === "PROVIDER_NOT_FOUND") {
          return reply.code(404).send({ error: err.message });
        }
        if (err instanceof Error && err.message === "OFFLINE_REQUEST_REQUIRED") {
          return reply.code(403).send({ error: err.message });
        }
        if (replyProviderAccountError(reply, err)) return;
        throw err;
      }
    },
  );
};

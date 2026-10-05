import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../../lib/auth/require-auth";
import {
  PROVIDER_ACCESS_PERMISSIONS,
  PROVIDER_KYC_REVIEW_PERMISSIONS,
  requireStaffAnyPermission,
  requireStaffPermission,
} from "../../lib/auth/permissions";
import { authedErrorResponses, errorResponseSchema } from "../../lib/auth/schemas";
import {
  providerAdminDtoSchema,
  providerAdminListStatsSchema,
  providerManagerRefSchema,
  providerKycQueueItemSchema,
  providerKycReviewResponseSchema,
  providerKycUploadResponseSchema,
  providerOfflineRequestQueueItemSchema,
  supervisorProviderKycSchema,
} from "../../lib/api-schemas";
import { paginatedResponseSchema, providerAdminListQuerySchema } from "../../lib/pagination";
import { statusListQuerySchema } from "../../lib/status-list-query";
import { adminProviderService } from "../../services/admin-provider-service";
import { providerKycService } from "../../services/provider-kyc-service";
import { providerOfflineRequestService } from "../../services/provider-offline-request-service";
import { PROVIDER_KYC_DOCUMENT_TYPES } from "../../lib/provider-kyc";
import { readMultipartKycUpload } from "../../lib/multipart";
import { providerKycDocumentMultipartBodySchema, UPLOAD_FORM_FIELDS } from "../../lib/upload-form";
import { replyUploadError, sendUploadError } from "../../lib/upload-route";
import { resolveWorkerCreateManager, workerVisibility } from "../../lib/worker-scope-modules";

const staffAuth = (permission: string) => [
  requireAuth(["admin", "supervisor"]),
  requireStaffPermission(permission),
];

const staffAnyAuth = (permissions: readonly string[]) => [
  requireAuth(["admin", "supervisor"]),
  requireStaffAnyPermission(permissions),
];

const kycQueueQuerySchema = statusListQuerySchema(["pending", "approved", "rejected"] as const);

const offlineQueueQuerySchema = statusListQuerySchema(
  ["pending", "approved", "rejected", "cancelled"] as const,
  { providerId: z.string().uuid().optional() },
);

const offlineRequestParamsSchema = z.object({ requestId: z.string().uuid() });

const createBodySchema = z.object({
  fullName: z.string().min(1).max(120),
  phoneNumber: z.string().min(8).max(15),
  email: z.string().email(),
  gender: z.enum(["male", "female", "other"]).optional(),
  serviceCategories: z.array(z.string().min(1)).optional(),
  coverageZoneId: z.string().uuid(),
  managedByAdminId: z.string().uuid().optional(),
});

const updateBodySchema = z.object({
  fullName: z.string().min(1).max(120).optional(),
  phoneNumber: z.string().min(8).max(15).optional(),
  email: z.string().email().nullable().optional(),
  gender: z.enum(["male", "female", "other"]).nullable().optional(),
  serviceCategories: z.array(z.string().min(1)).optional(),
  coverageZoneId: z.string().uuid().nullable().optional(),
  status: z.enum(["active", "inactive", "suspended"]).optional(),
  managedByAdminId: z.string().uuid().optional(),
});

const idParamsSchema = z.object({ id: z.string().uuid() });
const documentParamsSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
});
const reviewBodySchema = z.object({
  action: z.enum(["approve", "reject"]),
  rejectionReason: z.string().min(1).max(500).optional(),
});

const writeErrorResponses = {
  400: errorResponseSchema,
  ...authedErrorResponses,
  409: errorResponseSchema,
} as const;

const ERROR_STATUS: Record<string, 400 | 404 | 409> = {
  PROVIDER_NOT_FOUND: 404,
  DOCUMENT_NOT_FOUND: 404,
  ZONE_NOT_FOUND: 404,
  PHONE_TAKEN: 409,
  EMAIL_REQUIRED: 400,
  MANAGER_REQUIRED: 400,
  MANAGER_NOT_FOUND: 404,
  REJECTION_REASON_REQUIRED: 400,
};

function mappedError(err: unknown): { status: 400 | 404 | 409; error: string } {
  if (!(err instanceof Error)) throw err;
  const status = ERROR_STATUS[err.message];
  if (!status) throw err;
  return { status, error: err.message };
}

export const adminProviderRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/admin/providers",
    {
      preHandler: staffAnyAuth(PROVIDER_ACCESS_PERMISSIONS),
      schema: {
        tags: ["Admin Providers"],
        summary: "List workers (excludes deleted). Admin, super_admin, or supervisor.",
        description:
          "Admins with any providers:* action can list. Super admins see all workers. Other admins see workers they manage plus workers created by team members (and supervisors) in their tree. Supervisors only see workers they registered. Filter with availability (online/busy/offline), kyc (verified/pending/missing), city, managedBy (admin UUID), and scope (all/assigned).",
        security: [{ bearerAuth: [] }],
        querystring: providerAdminListQuerySchema,
        response: {
          200: paginatedResponseSchema(providerAdminDtoSchema).extend({
            stats: providerAdminListStatsSchema,
            cities: z.array(z.string()),
            managers: z.array(providerManagerRefSchema),
          }),
          ...authedErrorResponses,
        },
      },
    },
    async (request) =>
      adminProviderService.list(
        request.query,
        await workerVisibility(request.auth!, request.query.scope),
      ),
  );

  app.get(
    "/admin/providers/zones",
    {
      preHandler: staffAnyAuth(PROVIDER_ACCESS_PERMISSIONS),
      schema: {
        tags: ["Admin Providers"],
        summary: "List coverage zones for worker assignment",
        security: [{ bearerAuth: [] }],
        response: {
          200: z.object({
            items: z.array(
              z.object({
                id: z.string().uuid(),
                name: z.string(),
                city: z.string().nullable(),
                active: z.boolean(),
              }),
            ),
          }),
          ...authedErrorResponses,
        },
      },
    },
    async () => adminProviderService.listAssignableZones(),
  );

  app.get(
    "/admin/providers/kyc/documents",
    {
      preHandler: staffAnyAuth(PROVIDER_ACCESS_PERMISSIONS),
      schema: {
        tags: ["Admin Providers"],
        summary: "List uploaded provider KYC documents (queue)",
        description:
          "Defaults to all uploaded docs. Pass status=pending to see verification queue. Supervisors only see providers they registered.",
        security: [{ bearerAuth: [] }],
        querystring: kycQueueQuerySchema,
        response: {
          200: paginatedResponseSchema(providerKycQueueItemSchema),
          ...authedErrorResponses,
        },
      },
    },
    async (request) => {
      return providerKycService.listQueue(request.query, await workerVisibility(request.auth!));
    },
  );

  app.get(
    "/admin/providers/offline-requests",
    {
      preHandler: [
        requireAuth("admin"),
        requireStaffAnyPermission(PROVIDER_KYC_REVIEW_PERMISSIONS),
      ],
      schema: {
        tags: ["Admin Providers"],
        summary: "List provider offline requests",
        description:
          "Defaults to all statuses; pass status=pending for the approval queue.",
        security: [{ bearerAuth: [] }],
        querystring: offlineQueueQuerySchema,
        response: {
          200: paginatedResponseSchema(providerOfflineRequestQueueItemSchema),
          ...authedErrorResponses,
        },
      },
    },
    async (request) => providerOfflineRequestService.listQueue(request.query),
  );

  app.patch(
    "/admin/providers/offline-requests/:requestId",
    {
      preHandler: [
        requireAuth("admin"),
        requireStaffAnyPermission(PROVIDER_KYC_REVIEW_PERMISSIONS),
      ],
      schema: {
        tags: ["Admin Providers"],
        summary: "Approve or reject a provider offline request",
        security: [{ bearerAuth: [] }],
        params: offlineRequestParamsSchema,
        body: reviewBodySchema,
        response: {
          200: providerOfflineRequestQueueItemSchema,
          400: errorResponseSchema,
          ...authedErrorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        return await providerOfflineRequestService.review(
          request.params.requestId,
          request.body,
          request.auth!.id,
        );
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        if (
          err.message === "OFFLINE_REQUEST_NOT_FOUND" ||
          err.message === "PROVIDER_NOT_FOUND"
        ) {
          return reply.code(404).send({ error: err.message });
        }
        if (
          err.message === "REJECTION_REASON_REQUIRED" ||
          err.message === "OFFLINE_REQUEST_NOT_PENDING"
        ) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.post(
    "/admin/providers",
    {
      preHandler: staffAuth("providers:create"),
      schema: {
        tags: ["Admin Providers"],
        summary: "Create a provider. Phone must be unused. Supervisors and super_admin always allowed; admins need providers:create.",
        description:
          "When authenticated as a supervisor, that supervisor is stored as the provider registrant. Admin-created providers have supervisor null on profile. Device is not set here — the provider registers their device on first login via POST /provider/auth/login.",
        security: [{ bearerAuth: [] }],
        body: createBodySchema,
        response: { 201: providerAdminDtoSchema, ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        const manager = await resolveWorkerCreateManager(
          request.auth!,
          request.body.managedByAdminId,
        );
        return reply.code(201).send(
          await adminProviderService.create({
            ...request.body,
            registeredBySupervisorId:
              request.auth!.type === "supervisor" ? request.auth!.id : undefined,
            managedByAdminId: manager.managedByAdminId,
            requireManager: manager.requireManager,
          }),
        );
      } catch (err) {
        const mapped = mappedError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.get(
    "/admin/providers/:id",
    {
      preHandler: staffAnyAuth(PROVIDER_ACCESS_PERMISSIONS),
      schema: {
        tags: ["Admin Providers"],
        summary: "Get a provider",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: { 200: providerAdminDtoSchema, ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return await adminProviderService.getById(
          request.params.id,
          await workerVisibility(request.auth!),
        );
      } catch (err) {
        const mapped = mappedError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.get(
    "/admin/providers/:id/kyc",
    {
      preHandler: staffAnyAuth(PROVIDER_ACCESS_PERMISSIONS),
      schema: {
        tags: ["Admin Providers"],
        summary: "Fetch provider KYC documents (admin or registering supervisor)",
        description:
          "Admins with any providers access can fetch any provider KYC. Supervisors only for providers they registered. Returns private S3 presigned URLs.",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: { 200: supervisorProviderKycSchema, ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return await providerKycService.listForStaff(
          request.params.id,
          await workerVisibility(request.auth!),
        );
      } catch (err) {
        const mapped = mappedError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.post(
    "/admin/providers/:id/kyc/documents",
    {
      preHandler: staffAnyAuth(PROVIDER_KYC_REVIEW_PERMISSIONS),
      schema: {
        tags: ["Admin Providers"],
        summary: "Upload a provider KYC document (admin or registering supervisor)",
        description: [
          "For Operations / Platform staff with provider manage access.",
          "Send multipart/form-data with:",
          `${UPLOAD_FORM_FIELDS.documentType}: id_proof or address_proof`,
          `${UPLOAD_FORM_FIELDS.file}: JPG, JPEG, PNG, or PDF (max 5 MB).`,
        ].join(" "),
        security: [{ bearerAuth: [] }],
        consumes: ["multipart/form-data"],
        params: idParamsSchema,
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
        const result = await providerKycService.uploadDocumentForStaff(
          request.params.id,
          upload.documentType,
          {
            filename: upload.filename,
            mimetype: upload.mimetype,
            buffer: upload.buffer,
          },
          await workerVisibility(request.auth!),
        );
        return reply.code(201).send(result);
      } catch (err) {
        if (replyUploadError(reply, err)) return;
        if (err instanceof Error && err.message === "PROVIDER_NOT_FOUND") {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.patch(
    "/admin/providers/:id/kyc/documents/:documentId",
    {
      preHandler: staffAnyAuth(PROVIDER_KYC_REVIEW_PERMISSIONS),
      schema: {
        tags: ["Admin Providers"],
        summary: "Approve or reject a provider KYC document (admin or registering supervisor)",
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
        const auth = request.auth!;
        return await providerKycService.reviewDocument(
          request.params.id,
          request.params.documentId,
          request.body,
          { type: auth.type as "admin" | "supervisor", id: auth.id },
          await workerVisibility(auth),
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

  app.patch(
    "/admin/providers/:id",
    {
      preHandler: staffAuth("providers:update"),
      schema: {
        tags: ["Admin Providers"],
        summary: "Update a provider, including status (active | inactive | suspended) and manager",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        body: updateBodySchema,
        response: { 200: providerAdminDtoSchema, ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        const { managedByAdminId, ...body } = request.body;
        const manager =
          managedByAdminId === undefined
            ? { managedByAdminId: undefined }
            : await resolveWorkerCreateManager(request.auth!, managedByAdminId);
        return await adminProviderService.update(request.params.id, {
          ...body,
          managedByAdminId: manager.managedByAdminId,
        });
      } catch (err) {
        const mapped = mappedError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.delete(
    "/admin/providers/:id",
    {
      preHandler: staffAuth("providers:delete"),
      schema: {
        tags: ["Admin Providers"],
        summary: "Soft-delete a provider",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: { 204: z.null(), ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        await adminProviderService.remove(request.params.id);
        return reply.code(204).send(null);
      } catch (err) {
        const mapped = mappedError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );

  app.post(
    "/admin/providers/:id/device/reset",
    {
      preHandler: staffAuth("providers:update"),
      schema: {
        tags: ["Admin Providers"],
        summary: "Clear registered device info and email the provider so they can log in on a new device",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: { 200: z.object({ ok: z.literal(true) }), ...writeErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return await adminProviderService.resetDevice(request.params.id);
      } catch (err) {
        const mapped = mappedError(err);
        return reply.code(mapped.status).send({ error: mapped.error });
      }
    },
  );
};

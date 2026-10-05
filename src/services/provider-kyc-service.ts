import type { DocumentType, VerificationStatus } from "../generated/prisma/client";
import { providerKycDocumentRepository } from "../repositories/provider-kyc-document-repository";
import { serviceProviderRepository } from "../repositories/service-provider-repository";
import { supervisorRepository } from "../repositories/supervisor-repository";
import {
  PROVIDER_KYC_DOCUMENT_TYPES,
  type ProviderKycDocumentType,
  PROVIDER_KYC_UPLOAD,
  providerKycObjectKey,
} from "../lib/provider-kyc";
import { privateS3 } from "../lib/s3";
import { extensionFromFilename, validateFileUpload } from "../lib/file-upload";
import { platformConfigService } from "./platform-config-service";
import { notificationService } from "./notification-service";
import { matchesWorkerVisibility, type WorkerVisibility } from "../lib/worker-scope-modules";

export function computeKycVerified(
  documents: Array<{ documentType: DocumentType; verificationStatus: VerificationStatus }>,
) {
  return PROVIDER_KYC_DOCUMENT_TYPES.every((type) =>
    documents.some((doc) => doc.documentType === type && doc.verificationStatus === "approved"),
  );
}

type ProviderKycStatus = "approved" | "pending" | "rejected" | "not_submitted";

/**
 * One status for the worker app. `rejected` wins (the worker has to re-upload), then
 * `not_submitted` while a required document is missing, `approved` once every one is approved.
 */
export function computeKycStatus(
  documents: Array<{ documentType: DocumentType; verificationStatus: VerificationStatus; rejectionReason: string | null }>,
): { kycStatus: ProviderKycStatus; kycRejectionReason: string | null } {
  const required = PROVIDER_KYC_DOCUMENT_TYPES.map((type) => documents.find((doc) => doc.documentType === type));
  const rejected = required.find((doc) => doc?.verificationStatus === "rejected");
  if (rejected) return { kycStatus: "rejected", kycRejectionReason: rejected.rejectionReason };
  if (required.some((doc) => !doc)) return { kycStatus: "not_submitted", kycRejectionReason: null };
  if (required.every((doc) => doc?.verificationStatus === "approved")) {
    return { kycStatus: "approved", kycRejectionReason: null };
  }
  return { kycStatus: "pending", kycRejectionReason: null };
}

export function availabilityStatusFrom(isAvailable: boolean): "online" | "offline" {
  return isAvailable ? "online" : "offline";
}

async function toDocumentDto(
  doc: NonNullable<Awaited<ReturnType<typeof providerKycDocumentRepository.findById>>>,
) {
  return {
    id: doc.id,
    documentType: doc.documentType as ProviderKycDocumentType,
    verificationStatus: doc.verificationStatus,
    rejectionReason: doc.rejectionReason,
    uploadedAt: doc.uploadedAt,
    reviewedAt: doc.reviewedAt,
    downloadUrl: await privateS3.presignedGetUrl(doc.s3Key),
  };
}

async function requireActiveProvider(providerId: string) {
  const provider = await serviceProviderRepository.findById(providerId);
  if (!provider || provider.status === "deleted") throw new Error("PROVIDER_NOT_FOUND");
  if (provider.status !== "active") throw new Error("ACCOUNT_INACTIVE");
  return provider;
}

async function requireVisibleProvider(providerId: string, visibility?: WorkerVisibility) {
  const provider = await serviceProviderRepository.findById(providerId);
  if (!provider || provider.status === "deleted") throw new Error("PROVIDER_NOT_FOUND");
  if (!matchesWorkerVisibility(provider, visibility)) throw new Error("PROVIDER_NOT_FOUND");
  return provider;
}

async function listKycPayload(providerId: string) {
  const provider = await serviceProviderRepository.findProfileById(providerId);
  const documents = await providerKycDocumentRepository.listByProviderId(providerId);
  const items = await Promise.all(documents.map((doc) => toDocumentDto(doc)));

  return {
    provider: {
      id: providerId,
      fullName: provider?.fullName ?? null,
      phoneNumber: provider?.phoneNumber ?? "",
      email: provider?.email ?? null,
    },
    requiredDocumentTypes: [...PROVIDER_KYC_DOCUMENT_TYPES],
    kycVerified: computeKycVerified(documents),
    documents: items,
  };
}

export const providerKycService = {
  async listForProvider(providerId: string) {
    await requireActiveProvider(providerId);
    const documents = await providerKycDocumentRepository.listByProviderId(providerId);
    const items = await Promise.all(documents.map((doc) => toDocumentDto(doc)));
    return {
      requiredDocumentTypes: [...PROVIDER_KYC_DOCUMENT_TYPES],
      kycVerified: computeKycVerified(documents),
      documents: items,
    };
  },

  async uploadDocument(
    providerId: string,
    documentType: ProviderKycDocumentType,
    file: { filename: string; mimetype: string; buffer: Buffer },
  ) {
    if (!(await platformConfigService.isProviderKycUploadEnabled())) {
      throw new Error("PROVIDER_KYC_UPLOAD_DISABLED");
    }
    await requireActiveProvider(providerId);
    return this.persistUpload(providerId, documentType, file);
  },

  /** Staff (admin / registering supervisor) upload — provider need not be active. */
  async uploadDocumentForStaff(
    providerId: string,
    documentType: ProviderKycDocumentType,
    file: { filename: string; mimetype: string; buffer: Buffer },
    visibility?: WorkerVisibility,
  ) {
    await requireVisibleProvider(providerId, visibility);
    return this.persistUpload(providerId, documentType, file);
  },

  async persistUpload(
    providerId: string,
    documentType: ProviderKycDocumentType,
    file: { filename: string; mimetype: string; buffer: Buffer },
  ) {
    const extension = extensionFromFilename(file.filename);
    validateFileUpload(file.mimetype, extension, file.buffer.length, PROVIDER_KYC_UPLOAD);

    const existing = await providerKycDocumentRepository.findByProviderAndType(providerId, documentType);
    const fileId = privateS3.newFileId();
    const s3Key = providerKycObjectKey(providerId, documentType, fileId, extension);

    await privateS3.upload(s3Key, file.buffer, file.mimetype);
    if (existing?.s3Key && existing.s3Key !== s3Key) {
      await privateS3.delete(existing.s3Key).catch(() => undefined);
    }

    const doc = await providerKycDocumentRepository.upsertKycDocument(providerId, documentType, s3Key);
    const documents = await providerKycDocumentRepository.listByProviderId(providerId);
    return {
      document: await toDocumentDto(doc),
      kycVerified: computeKycVerified(documents),
    };
  },

  async listForStaff(providerId: string, visibility?: WorkerVisibility) {
    await requireVisibleProvider(providerId, visibility);
    return listKycPayload(providerId);
  },

  async listQueue(
    query: {
      page: number;
      limit: number;
      q?: string;
      status?: Array<"pending" | "approved" | "rejected">;
    },
    visibility?: WorkerVisibility,
  ) {
    const [rows, total] = await providerKycDocumentRepository.listQueue(
      { skip: (query.page - 1) * query.limit, take: query.limit },
      {
        status: query.status,
        q: query.q,
        visibility,
      },
    );

    const items = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        documentType: row.documentType as ProviderKycDocumentType,
        verificationStatus: row.verificationStatus,
        rejectionReason: row.rejectionReason,
        uploadedAt: row.uploadedAt,
        reviewedAt: row.reviewedAt,
        downloadUrl: await privateS3.presignedGetUrl(row.s3Key),
        provider: {
          id: row.provider.id,
          fullName: row.provider.fullName,
          phoneNumber: row.provider.phoneNumber,
          email: row.provider.email,
          status: row.provider.status,
        },
      })),
    );

    return {
      items,
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit) || 0,
    };
  },

  async reviewDocument(
    providerId: string,
    documentId: string,
    input: { action: "approve" | "reject"; rejectionReason?: string },
    reviewer: { type: "admin" | "supervisor"; id: string },
    visibility?: WorkerVisibility,
  ) {
    await requireVisibleProvider(providerId, visibility);

    if (reviewer.type === "supervisor") {
      const supervisor = await supervisorRepository.findById(reviewer.id);
      if (!supervisor || supervisor.status !== "active") throw new Error("SUPERVISOR_NOT_FOUND");
    }

    const document = await providerKycDocumentRepository.findById(documentId);
    if (!document || document.providerId !== providerId) throw new Error("DOCUMENT_NOT_FOUND");

    if (input.action === "reject" && !input.rejectionReason?.trim()) {
      throw new Error("REJECTION_REASON_REQUIRED");
    }

    const updated = await providerKycDocumentRepository.review(documentId, {
      verificationStatus: input.action === "approve" ? "approved" : "rejected",
      reviewedBySupervisorId: reviewer.type === "supervisor" ? reviewer.id : null,
      reviewedByAdminId: reviewer.type === "admin" ? reviewer.id : null,
      rejectionReason: input.action === "reject" ? input.rejectionReason?.trim() : null,
    });

    notificationService.notifyProvider(
      providerId,
      input.action === "approve" ? "provider.kyc.approved" : "provider.kyc.rejected",
      {
        documentId: updated.id,
        documentType: updated.documentType,
        ...(input.action === "reject"
          ? { rejectionReason: input.rejectionReason?.trim() }
          : {}),
      },
    );

    const documents = await providerKycDocumentRepository.listByProviderId(providerId);
    return {
      document: await toDocumentDto(updated),
      kycVerified: computeKycVerified(documents),
    };
  },
};

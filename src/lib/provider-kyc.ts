import type { DocumentType, Prisma, VerificationStatus } from "../generated/prisma/client";

/** S3 key prefixes — private bucket, one folder tree per use case. */
export const S3_PREFIX = {
  providerKyc: "providers/kyc",
} as const;

export const PROVIDER_KYC_DOCUMENT_TYPES = ["id_proof", "address_proof"] as const;
export type ProviderKycDocumentType = (typeof PROVIDER_KYC_DOCUMENT_TYPES)[number];

export const kycVerifiedWhere: Prisma.ServiceProviderWhereInput = {
  AND: PROVIDER_KYC_DOCUMENT_TYPES.map((documentType) => ({
    kycDocuments: { some: { documentType, verificationStatus: "approved" } },
  })),
};

export const PROVIDER_KYC_UPLOAD = {
  maxBytes: 5 * 1024 * 1024,
  allowedMimeTypes: new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "application/pdf",
  ]),
  allowedExtensions: new Set(["jpg", "jpeg", "png", "pdf"]),
} as const;

export function providerKycObjectKey(
  providerId: string,
  documentType: ProviderKycDocumentType,
  fileId: string,
  ext: string,
) {
  return `${S3_PREFIX.providerKyc}/${providerId}/${documentType}/${fileId}.${ext}`;
}

export type KycListStatus = "verified" | "pending" | "missing";

export function kycAdminListFlags(
  documents: Array<{ documentType: DocumentType; verificationStatus: VerificationStatus }>,
) {
  const kycDocumentsUploaded = PROVIDER_KYC_DOCUMENT_TYPES.every((type) =>
    documents.some((doc) => doc.documentType === type),
  );
  const kycVerified = PROVIDER_KYC_DOCUMENT_TYPES.every((type) =>
    documents.some((doc) => doc.documentType === type && doc.verificationStatus === "approved"),
  );
  const kycReviewPending =
    kycDocumentsUploaded && documents.some((doc) => doc.verificationStatus === "pending");
  const kycStatus: KycListStatus = kycVerified ? "verified" : kycReviewPending || kycDocumentsUploaded ? "pending" : "missing";
  return { kycDocumentsUploaded, kycReviewPending, kycVerified, kycStatus };
}

type KycSummary = { providerId: string; documentType: DocumentType; verificationStatus: VerificationStatus };

export function buildAdminKycFlagsMap(providerIds: string[], summaries: KycSummary[]) {
  const grouped = new Map<string, Array<{ documentType: DocumentType; verificationStatus: VerificationStatus }>>();
  for (const doc of summaries) {
    const list = grouped.get(doc.providerId) ?? [];
    list.push(doc);
    grouped.set(doc.providerId, list);
  }
  return new Map(providerIds.map((id) => [id, kycAdminListFlags(grouped.get(id) ?? [])]));
}

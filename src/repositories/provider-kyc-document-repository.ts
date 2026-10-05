import { db, readDb } from "../lib/prisma";
import { buildAdminKycFlagsMap } from "../lib/provider-kyc";
import { applyNameEmailPhoneSearch } from "../lib/search";
import { workerOwnerWhere, type WorkerVisibility } from "../lib/worker-scope-modules";
import type { DocumentType, Prisma, VerificationStatus } from "../generated/prisma/client";

export const providerKycDocumentRepository = {
  listByProviderId(providerId: string) {
    return readDb.providerKycDocument.findMany({
      where: { providerId },
      orderBy: { documentType: "asc" },
    });
  },

  findById(id: string) {
    return readDb.providerKycDocument.findUnique({ where: { id } });
  },

  findByProviderAndType(providerId: string, documentType: DocumentType) {
    return readDb.providerKycDocument.findUnique({
      where: { providerId_documentType: { providerId, documentType } },
    });
  },

  async listSummariesByProviderIds(providerIds: string[]) {
    if (providerIds.length === 0) return [];
    return readDb.providerKycDocument.findMany({
      where: { providerId: { in: providerIds } },
      select: { providerId: true, documentType: true, verificationStatus: true },
    });
  },

  listQueue(
    page: { skip: number; take: number },
    filters?: {
      status?: VerificationStatus[];
      q?: string;
      visibility?: WorkerVisibility;
    },
  ) {
    const searched = applyNameEmailPhoneSearch<Prisma.ServiceProviderWhereInput>(
      { status: { not: "deleted" } },
      filters?.q,
    );
    const owner = workerOwnerWhere(filters?.visibility);
    const providerWhere: Prisma.ServiceProviderWhereInput = owner ? { AND: [searched, owner] } : searched;

    const where: Prisma.ProviderKycDocumentWhereInput = {
      provider: providerWhere,
      ...(filters?.status?.length ? { verificationStatus: { in: filters.status } } : {}),
      documentType: { in: ["id_proof", "address_proof"] },
    };

    return Promise.all([
      readDb.providerKycDocument.findMany({
        where,
        include: {
          provider: {
            select: {
              id: true,
              fullName: true,
              phoneNumber: true,
              email: true,
              status: true,
            },
          },
        },
        orderBy: [{ uploadedAt: "desc" }],
        skip: page.skip,
        take: page.take,
      }),
      readDb.providerKycDocument.count({ where }),
    ]);
  },

  async adminKycFlagsByProviderIds(providerIds: string[]) {
    const summaries = await this.listSummariesByProviderIds(providerIds);
    return buildAdminKycFlagsMap(providerIds, summaries);
  },

  upsertKycDocument(
    providerId: string,
    documentType: DocumentType,
    s3Key: string,
  ) {
    return db.providerKycDocument.upsert({
      where: { providerId_documentType: { providerId, documentType } },
      create: {
        providerId,
        documentType,
        s3Key,
        verificationStatus: "pending",
      },
      update: {
        s3Key,
        verificationStatus: "pending",
        reviewedBy: null,
        reviewedBySupervisorId: null,
        reviewedAt: null,
        rejectionReason: null,
        uploadedAt: new Date(),
      },
    });
  },

  review(
    id: string,
    data: {
      verificationStatus: VerificationStatus;
      reviewedBySupervisorId?: string | null;
      reviewedByAdminId?: string | null;
      rejectionReason?: string | null;
    },
  ) {
    return db.providerKycDocument.update({
      where: { id },
      data: {
        verificationStatus: data.verificationStatus,
        reviewedBySupervisorId: data.reviewedBySupervisorId ?? null,
        reviewedBy: data.reviewedByAdminId ?? null,
        reviewedAt: new Date(),
        rejectionReason: data.rejectionReason ?? null,
      },
    });
  },
};

import { db, readDb } from "../lib/prisma";
import type { OfflineRequestStatus, Prisma } from "../generated/prisma/client";

const providerSelect = {
  id: true,
  fullName: true,
  phoneNumber: true,
  email: true,
  status: true,
  isAvailable: true,
} as const;

export const providerOfflineRequestRepository = {
  findById(id: string) {
    return readDb.providerOfflineRequest.findUnique({
      where: { id },
      include: { provider: { select: providerSelect } },
    });
  },

  findPendingByProvider(providerId: string) {
    return readDb.providerOfflineRequest.findFirst({
      where: { providerId, status: "pending" },
      orderBy: { createdAt: "desc" },
    });
  },

  listByProvider(providerId: string, take = 20) {
    return readDb.providerOfflineRequest.findMany({
      where: { providerId },
      orderBy: { createdAt: "desc" },
      take,
    });
  },

  listQueue(
    page: { skip: number; take: number },
    filters?: {
      status?: OfflineRequestStatus[];
      q?: string;
      providerId?: string;
    },
  ) {
    const providerWhere: Prisma.ServiceProviderWhereInput = {
      status: { not: "deleted" },
    };
    if (filters?.q?.trim()) {
      const term = filters.q.trim();
      providerWhere.OR = [
        { fullName: { contains: term, mode: "insensitive" } },
        { email: { contains: term, mode: "insensitive" } },
        { phoneNumber: { contains: term.replace(/\D/g, "") || term } },
      ];
    }

    const where: Prisma.ProviderOfflineRequestWhereInput = {
      provider: providerWhere,
      ...(filters?.status?.length ? { status: { in: filters.status } } : {}),
      ...(filters?.providerId ? { providerId: filters.providerId } : {}),
    };

    return Promise.all([
      readDb.providerOfflineRequest.findMany({
        where,
        include: { provider: { select: providerSelect } },
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
      }),
      readDb.providerOfflineRequest.count({ where }),
    ]);
  },

  create(data: {
    providerId: string;
    reason: string;
    requestedLat?: number | null;
    requestedLong?: number | null;
  }) {
    return db.providerOfflineRequest.create({
      data: {
        providerId: data.providerId,
        reason: data.reason,
        requestedLat: data.requestedLat ?? null,
        requestedLong: data.requestedLong ?? null,
      },
    });
  },

  updateStatus(
    id: string,
    data: {
      status: OfflineRequestStatus;
      reviewedByAdminId?: string | null;
      reviewedAt?: Date | null;
      rejectionReason?: string | null;
    },
  ) {
    return db.providerOfflineRequest.update({
      where: { id },
      data,
      include: { provider: { select: providerSelect } },
    });
  },
};

import type { OfflineRequestStatus } from "../generated/prisma/client";
import { providerOfflineRequestRepository } from "../repositories/provider-offline-request-repository";
import { paginatedResult, paginationSkip } from "../lib/pagination";
import { providerService } from "./provider-service";
import { serviceProviderRepository } from "../repositories/service-provider-repository";
import { notificationService } from "./notification-service";

type OfflineRequestRow = {
  id: string;
  providerId: string;
  reason: string;
  status: OfflineRequestStatus;
  requestedLat: number | null;
  requestedLong: number | null;
  reviewedByAdminId: string | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type OfflineRequestWithProvider = OfflineRequestRow & {
  provider: {
    id: string;
    fullName: string | null;
    phoneNumber: string;
    email: string | null;
    status: string;
    isAvailable: boolean;
  };
};

function toRequestDto(row: OfflineRequestRow) {
  return {
    id: row.id,
    providerId: row.providerId,
    reason: row.reason,
    status: row.status,
    requestedLat: row.requestedLat,
    requestedLong: row.requestedLong,
    reviewedByAdminId: row.reviewedByAdminId,
    reviewedAt: row.reviewedAt,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toQueueDto(row: OfflineRequestWithProvider) {
  return { ...toRequestDto(row), provider: row.provider };
}

async function requireActiveProvider(providerId: string) {
  const provider = await serviceProviderRepository.findById(providerId);
  if (!provider || provider.status === "deleted") throw new Error("PROVIDER_NOT_FOUND");
  if (provider.status !== "active") throw new Error("ACCOUNT_INACTIVE");
  return provider;
}

export const providerOfflineRequestService = {
  async create(
    providerId: string,
    input: { reason: string; lat?: number; long?: number },
  ) {
    const provider = await requireActiveProvider(providerId);
    if (!provider.isAvailable) throw new Error("ALREADY_OFFLINE");

    const pending = await providerOfflineRequestRepository.findPendingByProvider(providerId);
    if (pending) throw new Error("OFFLINE_REQUEST_PENDING");

    const reason = input.reason.trim();
    if (!reason) throw new Error("REASON_REQUIRED");

    return toRequestDto(
      await providerOfflineRequestRepository.create({
        providerId,
        reason,
        requestedLat: input.lat ?? provider.currentLatitude,
        requestedLong: input.long ?? provider.currentLongitude,
      }),
    );
  },

  async listForProvider(providerId: string) {
    await requireActiveProvider(providerId);
    const rows = await providerOfflineRequestRepository.listByProvider(providerId);
    return rows.map(toRequestDto);
  },

  async cancel(providerId: string, requestId: string) {
    const row = await providerOfflineRequestRepository.findById(requestId);
    if (!row || row.providerId !== providerId) throw new Error("OFFLINE_REQUEST_NOT_FOUND");
    if (row.status !== "pending") throw new Error("OFFLINE_REQUEST_NOT_PENDING");
    return toRequestDto(
      await providerOfflineRequestRepository.updateStatus(requestId, {
        status: "cancelled",
      }),
    );
  },

  async listQueue(query: {
    page: number;
    limit: number;
    q?: string;
    status?: OfflineRequestStatus[];
    providerId?: string;
  }) {
    const [rows, total] = await providerOfflineRequestRepository.listQueue(
      paginationSkip(query),
      {
        status: query.status,
        q: query.q,
        providerId: query.providerId,
      },
    );
    return paginatedResult(rows.map(toQueueDto), total, query);
  },

  async review(
    requestId: string,
    input: { action: "approve" | "reject"; rejectionReason?: string },
    adminId: string,
  ) {
    const row = await providerOfflineRequestRepository.findById(requestId);
    if (!row) throw new Error("OFFLINE_REQUEST_NOT_FOUND");
    if (row.status !== "pending") throw new Error("OFFLINE_REQUEST_NOT_PENDING");

    if (input.action === "reject") {
      const rejectionReason = input.rejectionReason?.trim();
      if (!rejectionReason) throw new Error("REJECTION_REASON_REQUIRED");
      const updated = toQueueDto(
        await providerOfflineRequestRepository.updateStatus(requestId, {
          status: "rejected",
          reviewedByAdminId: adminId,
          reviewedAt: new Date(),
          rejectionReason,
        }),
      );
      notificationService.notifyProvider(row.providerId, "provider.offline_request.rejected", {
        requestId: row.id,
        rejectionReason,
      });
      return updated;
    }

    const provider = await serviceProviderRepository.findById(row.providerId);
    if (!provider || provider.status === "deleted") throw new Error("PROVIDER_NOT_FOUND");

    const useLat = row.requestedLat ?? provider.currentLatitude ?? 0;
    const useLong = row.requestedLong ?? provider.currentLongitude ?? 0;

    // Approval auto-marks the provider offline; silent avoids a second "you are offline" push.
    await providerService.updateStatus(
      row.providerId,
      { status: "offline", lat: useLat, long: useLong },
      { allowOffline: true, silent: true },
    );

    const updated = toQueueDto(
      await providerOfflineRequestRepository.updateStatus(requestId, {
        status: "approved",
        reviewedByAdminId: adminId,
        reviewedAt: new Date(),
        rejectionReason: null,
      }),
    );
    notificationService.notifyProvider(row.providerId, "provider.offline_request.approved", {
      requestId: row.id,
    });
    return updated;
  },
};

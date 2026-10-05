import { parseProviderDeviceInfo } from "../lib/provider-device";
import { matchesWorkerVisibility, type WorkerVisibility } from "../lib/worker-scope-modules";
import { adminUserRepository } from "../repositories/admin-user-repository";
import { kycAdminListFlags } from "../lib/provider-kyc";
import {
  serviceProviderRepository,
  type ProviderListFilters,
} from "../repositories/service-provider-repository";
import { providerKycDocumentRepository } from "../repositories/provider-kyc-document-repository";
import { userRepository } from "../repositories/user-repository";
import { coverageZoneRepository } from "../repositories/coverage-zone-repository";
import {
  paginatedResult,
  paginationSkip,
  type ProviderAdminListQuery,
} from "../lib/pagination";
import { refreshTokenStore } from "../lib/auth/refresh-token-store";
import { sendProviderDeviceResetEmail } from "../lib/mailer";
import { Prisma } from "../generated/prisma/client";
import type { Gender, ProviderStatus } from "../generated/prisma/client";
import { generateReferralCode } from "../lib/referral-code";
import { paise } from "../lib/money";

type ProviderRow = NonNullable<Awaited<ReturnType<typeof serviceProviderRepository.findAdminById>>>;
type ManagerRow = NonNullable<ProviderRow["registeredByAdmin"]>;

function toManagerRef(admin: ManagerRow | null | undefined) {
  if (!admin) return null;
  return {
    id: admin.id,
    fullName: admin.fullName?.trim() || admin.email,
    role: admin.role.roleName,
  };
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function toProviderDto(
  row: ProviderRow,
  extras: {
    kycFlags?: ReturnType<typeof kycAdminListFlags>;
    availabilityStatus?: "online" | "busy" | "offline";
    todayEarningsPaise?: number;
  } = {},
) {
  const kycFlags = extras.kycFlags ?? kycAdminListFlags([]);
  const availabilityStatus =
    extras.availabilityStatus ?? (row.isAvailable ? "online" : "offline");
  return {
    id: row.id,
    phoneNumber: row.phoneNumber,
    fullName: row.fullName,
    gender: row.gender,
    email: row.email,
    profilePhotoUrl: row.profilePhotoUrl,
    bio: row.bio,
    onboardingStatus: row.onboardingStatus,
    serviceCategories: row.serviceCategories,
    status: row.status,
    device: parseProviderDeviceInfo(row.deviceInfo),
    isAvailable: row.isAvailable,
    coverageZone: row.coverageZone,
    city: row.coverageZone?.city ?? null,
    avgRating: Number(row.avgRating ?? 0),
    totalJobsCompleted: row.totalJobsCompleted ?? 0,
    todayEarningsPaise: extras.todayEarningsPaise ?? 0,
    availabilityStatus,
    kycDocumentsUploaded: kycFlags.kycDocumentsUploaded,
    kycReviewPending: kycFlags.kycReviewPending,
    kycVerified: kycFlags.kycVerified,
    kycStatus: kycFlags.kycStatus,
    managedBy: toManagerRef(row.registeredByAdmin),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function withLiveExtras(rows: ProviderRow[]) {
  const ids = rows.map((row) => row.id);
  const [kycFlags, busyRows, payouts] = await Promise.all([
    providerKycDocumentRepository.adminKycFlagsByProviderIds(ids),
    serviceProviderRepository.listBusyProviderIds(ids),
    serviceProviderRepository.listTodayPayouts(ids, startOfToday()),
  ]);
  const busyIds = new Set(busyRows.map((row) => row.providerId));
  const earnings = new Map<string, number>();
  for (const payment of payouts) {
    const providerId = payment.booking.assignments[0]?.providerId;
    if (!providerId) continue;
    earnings.set(providerId, (earnings.get(providerId) ?? 0) + paise(payment.providerPayoutPaise));
  }
  return rows.map((row) =>
    toProviderDto(row, {
      kycFlags: kycFlags.get(row.id),
      availabilityStatus: busyIds.has(row.id) ? "busy" : row.isAvailable ? "online" : "offline",
      todayEarningsPaise: earnings.get(row.id) ?? 0,
    }),
  );
}

async function requireProvider(id: string): Promise<ProviderRow> {
  const row = await serviceProviderRepository.findAdminById(id);
  if (!row || row.status === "deleted") throw new Error("PROVIDER_NOT_FOUND");
  return row;
}

async function resolveWorkerManager(managedByAdminId?: string, required?: boolean) {
  if (!managedByAdminId) {
    if (required) throw new Error("MANAGER_REQUIRED");
    return undefined;
  }
  const admin = await adminUserRepository.findById(managedByAdminId);
  if (!admin || admin.status !== "active" || admin.role.roleName === "super_admin") {
    throw new Error("MANAGER_NOT_FOUND");
  }
  return admin.id;
}

async function assertPhoneAvailable(phoneNumber: string, exceptId?: string) {
  const [provider, customer] = await Promise.all([
    serviceProviderRepository.findByPhone(phoneNumber),
    userRepository.findByPhone(phoneNumber),
  ]);
  if (customer) throw new Error("PHONE_TAKEN");
  if (provider && provider.id !== exceptId) throw new Error("PHONE_TAKEN");
}

export const adminProviderService = {
  async allWorkersOnline() {
    return serviceProviderRepository.allActiveAreOnline();
  },

  async setAllAvailability(online: boolean) {
    const { count } = await serviceProviderRepository.setAllActiveAvailability(online);
    return { updated: count, online };
  },

  async listAssignableZones() {
    const rows = await coverageZoneRepository.listAssignable();
    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.zoneName,
        city: row.city,
        active: row.isActive,
      })),
    };
  },

  async list(
    query: ProviderAdminListQuery,
    scope?: WorkerVisibility,
  ) {
    const owner: ProviderListFilters = {
      registeredByAdminIds: scope?.registeredByAdminIds,
      registeredBySupervisorIds: scope?.registeredBySupervisorIds,
    };
    const filters: ProviderListFilters = {
      ...owner,
      q: query.q,
      managedByAdminIds: query.managedBy,
      availability: query.availability,
      kyc: query.kyc,
      city: query.city,
    };
    const [[rows, total], online, busy, offline, kycPending, cityRows, managerRows] = await Promise.all([
      serviceProviderRepository.list(paginationSkip(query), filters),
      serviceProviderRepository.countWhere({ ...owner, availability: ["online"] }),
      serviceProviderRepository.countWhere({ ...owner, availability: ["busy"] }),
      serviceProviderRepository.countWhere({ ...owner, availability: ["offline"] }),
      serviceProviderRepository.countWhere({ ...owner, kyc: ["pending"] }),
      serviceProviderRepository.listCoverageCities(),
      serviceProviderRepository.listManagers(scope?.registeredByAdminIds),
    ]);
    const items = await withLiveExtras(rows);
    return {
      ...paginatedResult(items, total, query),
      stats: { online, busy, offline, kycPending },
      cities: cityRows
        .map((row) => row.city)
        .filter((city): city is string => Boolean(city)),
      managers: managerRows.map((admin) => toManagerRef(admin)!),
    };
  },

  async listStats(scope?: WorkerVisibility) {
    const owner: ProviderListFilters = {
      registeredByAdminIds: scope?.registeredByAdminIds,
      registeredBySupervisorIds: scope?.registeredBySupervisorIds,
    };
    const [online, busy, offline, kycPending] = await Promise.all([
      serviceProviderRepository.countWhere({ ...owner, availability: ["online"] }),
      serviceProviderRepository.countWhere({ ...owner, availability: ["busy"] }),
      serviceProviderRepository.countWhere({ ...owner, availability: ["offline"] }),
      serviceProviderRepository.countWhere({ ...owner, kyc: ["pending"] }),
    ]);
    return { online, busy, offline, kycPending };
  },

  async getById(id: string, scope?: WorkerVisibility) {
    const row = await requireProvider(id);
    if (!matchesWorkerVisibility(row, scope)) throw new Error("PROVIDER_NOT_FOUND");
    const [dto] = await withLiveExtras([row]);
    return dto;
  },

  async create(input: {
    fullName: string;
    phoneNumber: string;
    email: string;
    gender?: Gender;
    serviceCategories?: string[];
    coverageZoneId: string;
    registeredBySupervisorId?: string;
    managedByAdminId?: string;
    requireManager?: boolean;
  }) {
    const phoneNumber = input.phoneNumber.trim();
    await assertPhoneAvailable(phoneNumber);
    if (!(await coverageZoneRepository.exists(input.coverageZoneId))) {
      throw new Error("ZONE_NOT_FOUND");
    }
    const registeredByAdminId = await resolveWorkerManager(input.managedByAdminId, input.requireManager);

    const row = await serviceProviderRepository.create({
      phoneNumber,
      fullName: input.fullName.trim(),
      email: input.email.trim().toLowerCase(),
      gender: input.gender,
      serviceCategories: input.serviceCategories,
      coverageZoneId: input.coverageZoneId,
      referralCode: await generateReferralCode("provider"),
      status: "active",
      registeredBySupervisorId: input.registeredBySupervisorId,
      registeredByAdminId,
    });
    return toProviderDto(row);
  },

  async update(
    id: string,
    input: {
      fullName?: string;
      phoneNumber?: string;
      email?: string | null;
      gender?: Gender | null;
      serviceCategories?: string[];
      coverageZoneId?: string | null;
      status?: Extract<ProviderStatus, "active" | "inactive" | "suspended">;
      managedByAdminId?: string;
    },
  ) {
    const row = await requireProvider(id);
    if (input.phoneNumber && input.phoneNumber !== row.phoneNumber) {
      await assertPhoneAvailable(input.phoneNumber.trim(), id);
    }
    if (input.coverageZoneId && !(await coverageZoneRepository.exists(input.coverageZoneId))) {
      throw new Error("ZONE_NOT_FOUND");
    }
    const registeredByAdminId =
      input.managedByAdminId === undefined
        ? undefined
        : await resolveWorkerManager(input.managedByAdminId, true);

    const updated = await serviceProviderRepository.update(id, {
      fullName: input.fullName?.trim(),
      phoneNumber: input.phoneNumber?.trim(),
      email: input.email === undefined ? undefined : input.email?.trim().toLowerCase() ?? null,
      gender: input.gender,
      serviceCategories: input.serviceCategories,
      coverageZoneId: input.coverageZoneId,
      status: input.status,
      isAvailable: input.status && input.status !== "active" ? false : undefined,
      deletedAt: input.status === "active" ? null : undefined,
      registeredByAdminId,
    });
    if (input.status && input.status !== "active") {
      await refreshTokenStore.revoke("provider", id);
    }
    return toProviderDto(updated);
  },

  async remove(id: string) {
    await requireProvider(id);
    await serviceProviderRepository.softDelete(id);
    await refreshTokenStore.revoke("provider", id);
  },

  async resetDevice(id: string) {
    const row = await requireProvider(id);
    if (!row.email) throw new Error("EMAIL_REQUIRED");
    const previous = parseProviderDeviceInfo(row.deviceInfo);
    await serviceProviderRepository.update(id, { deviceInfo: Prisma.JsonNull });
    await sendProviderDeviceResetEmail({
      to: row.email,
      fullName: row.fullName ?? "there",
      previousDevice: previous,
    });
    return { ok: true as const };
  },
};

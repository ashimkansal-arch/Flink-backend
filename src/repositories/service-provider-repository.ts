import { db, readDb } from "../lib/prisma";
import { adminUserRefSelect, coverageZoneRefSelect, supervisorRefSelect } from "../lib/prisma-selects";
import type { Gender, Prisma, ProviderStatus } from "../generated/prisma/client";
import { applyNameEmailPhoneSearch } from "../lib/search";
import { kycVerifiedWhere, PROVIDER_KYC_DOCUMENT_TYPES, type KycListStatus } from "../lib/provider-kyc";
import { workerOwnerWhere } from "../lib/worker-scope-modules";
export type ProviderDeviceInfo = { deviceId: string; deviceName: string };

const BUSY_BOOKING_STATUSES = ["assigned", "en_route", "in_progress"] as const;

const busyProviderWhere: Prisma.ServiceProviderWhereInput = {
  assignments: {
    some: {
      status: "accepted",
      booking: { status: { in: [...BUSY_BOOKING_STATUSES] } },
    },
  },
};

export type ProviderAvailabilityFilter = "online" | "busy" | "offline";

export type ProviderListFilters = {
  q?: string;
  registeredByAdminIds?: string[];
  registeredBySupervisorIds?: string[];
  managedByAdminIds?: string[];
  availability?: ProviderAvailabilityFilter[];
  kyc?: KycListStatus[];
  city?: string[];
};

const adminProviderSelect = {
  id: true,
  phoneNumber: true,
  fullName: true,
  gender: true,
  email: true,
  profilePhotoUrl: true,
  bio: true,
  onboardingStatus: true,
  serviceCategories: true,
  status: true,
  deviceInfo: true,
  isAvailable: true,
  avgRating: true,
  totalJobsCompleted: true,
  createdAt: true,
  updatedAt: true,
  registeredBySupervisorId: true,
  registeredByAdminId: true,
  coverageZone: { select: coverageZoneRefSelect },
  registeredByAdmin: { select: adminUserRefSelect },
} as const;

const listWhere = { status: { not: "deleted" as const } };

function availabilityWhere(
  values?: ProviderAvailabilityFilter[],
): Prisma.ServiceProviderWhereInput | undefined {
  if (!values?.length) return undefined;
  const parts: Prisma.ServiceProviderWhereInput[] = [];
  if (values.includes("busy")) parts.push(busyProviderWhere);
  if (values.includes("online")) parts.push({ AND: [{ isAvailable: true }, { NOT: busyProviderWhere }] });
  if (values.includes("offline")) parts.push({ AND: [{ isAvailable: false }, { NOT: busyProviderWhere }] });
  return parts.length === 1 ? parts[0] : { OR: parts };
}

function kycWhere(values?: KycListStatus[]): Prisma.ServiceProviderWhereInput | undefined {
  if (!values?.length) return undefined;
  const parts: Prisma.ServiceProviderWhereInput[] = [];
  if (values.includes("verified")) parts.push(kycVerifiedWhere);
  if (values.includes("pending")) {
    parts.push({ kycDocuments: { some: { verificationStatus: "pending" } } });
  }
  if (values.includes("missing")) {
    parts.push({
      OR: PROVIDER_KYC_DOCUMENT_TYPES.map((documentType) => ({
        kycDocuments: { none: { documentType } },
      })),
    });
  }
  return parts.length === 1 ? parts[0] : { OR: parts };
}

function ownerWhere(filters: ProviderListFilters): Prisma.ServiceProviderWhereInput | undefined {
  const tree = workerOwnerWhere({
    registeredByAdminIds: filters.registeredByAdminIds,
    registeredBySupervisorIds: filters.registeredBySupervisorIds,
  });
  const managed = filters.managedByAdminIds?.length
    ? { registeredByAdminId: { in: filters.managedByAdminIds } }
    : undefined;
  if (tree && managed) return { AND: [tree, managed] };
  return tree ?? managed;
}

function buildListWhere(filters: ProviderListFilters = {}): Prisma.ServiceProviderWhereInput {
  const searched = applyNameEmailPhoneSearch<Prisma.ServiceProviderWhereInput>({ ...listWhere }, filters.q);
  const clauses: Prisma.ServiceProviderWhereInput[] = [searched];
  const owner = ownerWhere(filters);
  if (owner) clauses.push(owner);
  if (filters.city?.length) clauses.push({ coverageZone: { city: { in: filters.city } } });
  const availability = availabilityWhere(filters.availability);
  if (availability) clauses.push(availability);
  const kyc = kycWhere(filters.kyc);
  if (kyc) clauses.push(kyc);
  return clauses.length === 1 ? clauses[0] : { AND: clauses };
}

export const serviceProviderRepository = {
  findByPhone(phoneNumber: string) {
    return readDb.serviceProvider.findUnique({ where: { phoneNumber } });
  },

  findById(id: string) {
    return readDb.serviceProvider.findUnique({ where: { id } });
  },

  findAdminById(id: string) {
    return readDb.serviceProvider.findUnique({
      where: { id },
      select: adminProviderSelect,
    });
  },

  list(page: { skip: number; take: number }, filters: ProviderListFilters = {}) {
    const where = buildListWhere(filters);
    return Promise.all([
      readDb.serviceProvider.findMany({
        where,
        select: adminProviderSelect,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
      }),
      readDb.serviceProvider.count({ where }),
    ]);
  },

  countWhere(filters: ProviderListFilters = {}) {
    return readDb.serviceProvider.count({ where: buildListWhere(filters) });
  },

  listCoverageCities() {
    return readDb.coverageZone.findMany({
      where: { isActive: true, city: { not: null } },
      select: { city: true },
      distinct: ["city"],
      orderBy: { city: "asc" },
    });
  },

  listManagers(adminIds?: string[]) {
    if (adminIds && adminIds.length === 0) return Promise.resolve([]);
    return readDb.adminUser.findMany({
      where: {
        status: "active",
        ...(adminIds ? { id: { in: adminIds } } : {}),
        registeredProviders: { some: { status: { not: "deleted" } } },
      },
      select: adminUserRefSelect,
      orderBy: [{ fullName: "asc" }, { email: "asc" }],
    });
  },

  listBusyProviderIds(providerIds: string[]) {
    if (providerIds.length === 0) return Promise.resolve([] as Array<{ providerId: string }>);
    return readDb.assignment.findMany({
      where: {
        providerId: { in: providerIds },
        status: "accepted",
        booking: { status: { in: [...BUSY_BOOKING_STATUSES] } },
      },
      select: { providerId: true },
      distinct: ["providerId"],
    });
  },

  listTodayPayouts(providerIds: string[], startOfDay: Date) {
    if (providerIds.length === 0) return Promise.resolve([]);
    return readDb.payment.findMany({
      where: {
        status: "captured",
        capturedAt: { gte: startOfDay },
        booking: {
          assignments: { some: { status: "accepted", providerId: { in: providerIds } } },
        },
      },
      select: {
        providerPayoutPaise: true,
        booking: {
          select: {
            assignments: { where: { status: "accepted" }, select: { providerId: true }, take: 1 },
          },
        },
      },
    });
  },

  create(data: {
    phoneNumber: string;
    fullName?: string;
    gender?: Gender;
    email?: string;
    serviceCategories?: string[];
    coverageZoneId?: string;
    referralCode: string;
    status?: ProviderStatus;
    deviceInfo?: ProviderDeviceInfo;
    registeredBySupervisorId?: string;
    registeredByAdminId?: string;
  }) {
    return db.serviceProvider.create({
      data,
      select: adminProviderSelect,
    });
  },

  updateDeviceInfo(id: string, deviceInfo: ProviderDeviceInfo) {
    return db.serviceProvider.update({
      where: { id },
      data: { deviceInfo },
    });
  },

  update(
    id: string,
    data: {
      phoneNumber?: string;
      fullName?: string;
      gender?: Gender | null;
      email?: string | null;
      serviceCategories?: string[];
      coverageZoneId?: string | null;
      status?: ProviderStatus;
      isAvailable?: boolean;
      deletedAt?: Date | null;
      deviceInfo?: ProviderDeviceInfo | Prisma.NullableJsonNullValueInput;
      registeredByAdminId?: string;
    },
  ) {
    return db.serviceProvider.update({
      where: { id },
      data,
      select: adminProviderSelect,
    });
  },

  softDelete(id: string) {
    return db.serviceProvider.update({
      where: { id },
      data: {
        status: "deleted",
        deletedAt: new Date(),
        isAvailable: false,
      },
    });
  },

  updateProfilePhotoUrl(id: string, profilePhotoUrl: string) {
    return db.serviceProvider.update({
      where: { id },
      data: { profilePhotoUrl },
      select: { profilePhotoUrl: true },
    });
  },

  updateFcmToken(id: string, fcmToken: string | null) {
    return db.serviceProvider.update({
      where: { id },
      data: { fcmToken },
      select: { id: true, fcmToken: true },
    });
  },

  /** Temporary: clock every active worker in or out. Replace with login-hours cron later. */
  setAllActiveAvailability(isAvailable: boolean) {
    return db.serviceProvider.updateMany({
      where: { status: "active", deletedAt: null, isAvailable: { not: isAvailable } },
      data: { isAvailable },
    });
  },

  async allActiveAreOnline() {
    const [active, offline] = await Promise.all([
      readDb.serviceProvider.count({ where: { status: "active", deletedAt: null } }),
      readDb.serviceProvider.count({
        where: { status: "active", deletedAt: null, isAvailable: false },
      }),
    ]);
    return active > 0 && offline === 0;
  },

  updateLocationAndAvailability(
    id: string,
    latitude: number,
    longitude: number,
    isAvailable: boolean,
  ) {
    return db.serviceProvider.update({
      where: { id },
      data: {
        isAvailable,
        currentLatitude: latitude,
        currentLongitude: longitude,
        locationUpdatedAt: new Date(),
      },
      select: {
        currentLatitude: true,
        currentLongitude: true,
        locationUpdatedAt: true,
        isAvailable: true,
      },
    });
  },

  findProfileById(id: string) {
    return readDb.serviceProvider.findUnique({
      where: { id },
      select: {
        id: true,
        phoneNumber: true,
        fullName: true,
        gender: true,
        email: true,
        profilePhotoUrl: true,
        bio: true,
        onboardingStatus: true,
        rejectionReason: true,
        serviceCategories: true,
        referralCode: true,
        currentLatitude: true,
        currentLongitude: true,
        locationUpdatedAt: true,
        avgRating: true,
        totalJobsCompleted: true,
        acceptanceRate: true,
        isAvailable: true,
        bankAccountLast4: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        coverageZone: { select: coverageZoneRefSelect },
        registeredBySupervisor: { select: supervisorRefSelect },
      },
    });
  },

  /** Active, online, KYC-verified workers assigned to any of the zones (every service). */
  async listDispatchCandidates(zoneIds: string[]) {
    if (zoneIds.length === 0) {
      console.log("[availability] listDispatchCandidates skipped: no covering zoneIds");
      return [];
    }
    const rows = await readDb.serviceProvider.findMany({
      where: {
        AND: [
          {
            status: "active",
            isAvailable: true,
            deletedAt: null,
            coverageZoneId: { in: zoneIds },
          },
          kycVerifiedWhere,
        ],
      },
      select: {
        id: true,
        serviceCategories: true,
        currentLatitude: true,
        currentLongitude: true,
        availability: true,
      },
      orderBy: { createdAt: "asc" },
    });
    console.log("[availability] listDispatchCandidates", {
      zoneIds,
      count: rows.length,
      ids: rows.map((row) => row.id),
    });
    if (rows.length === 0) {
      const assigned = await readDb.serviceProvider.findMany({
        where: { deletedAt: null, coverageZoneId: { in: zoneIds } },
        select: {
          id: true,
          fullName: true,
          status: true,
          isAvailable: true,
          coverageZoneId: true,
          kycDocuments: { select: { documentType: true, verificationStatus: true } },
        },
      });
      console.log("[availability] workers assigned to these zones (before active/online/KYC filter)", assigned);
    }
    return rows;
  },

  /** Jobs the workers are committed to (accepted and not yet finished), with what's needed to place them in time. */
  listCommitments(providerIds: string[], tx: Prisma.TransactionClient | typeof readDb = readDb) {
    if (providerIds.length === 0) return Promise.resolve([]);
    return tx.assignment.findMany({
      where: {
        providerId: { in: providerIds },
        status: "accepted",
        booking: { status: { in: [...BUSY_BOOKING_STATUSES] } },
      },
      select: {
        providerId: true,
        booking: {
          select: {
            id: true,
            status: true,
            bookingType: true,
            scheduledDate: true,
            scheduledStartTime: true,
            startedAt: true,
            createdAt: true,
            sessionMinutes: true,
            plan: { select: { durationMinutes: true } },
          },
        },
      },
    });
  },

  /** Most recent job completion per worker. */
  async listLastCompletedAt(
    providerIds: string[],
    tx: Prisma.TransactionClient | typeof readDb = readDb,
  ): Promise<Map<string, Date>> {
    if (providerIds.length === 0) return new Map();
    const rows = await tx.$queryRaw<Array<{ providerId: string; completedAt: Date }>>`
      SELECT a.provider_id::text AS "providerId", MAX(b.completed_at) AS "completedAt"
      FROM assignments a
      JOIN bookings b ON b.booking_id = a.booking_id
      WHERE a.provider_id = ANY(${providerIds}::uuid[])
        AND a.status IN ('accepted', 'completed')
        AND b.completed_at IS NOT NULL
      GROUP BY a.provider_id`;
    return new Map(rows.map((row) => [row.providerId, new Date(row.completedAt)]));
  },

  /**
   * Row-locks the worker for the rest of the transaction so two bookings can't claim the same slot.
   * Returns false when another booking is holding the lock right now (SKIP LOCKED — never waits).
   */
  async lockForDispatch(providerId: string, tx: Prisma.TransactionClient) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT provider_id::text AS id FROM service_providers
      WHERE provider_id = ${providerId}::uuid AND status = 'active' AND is_available = true AND deleted_at IS NULL
      FOR UPDATE SKIP LOCKED`;
    return rows.length > 0;
  },

  listActiveIds() {
    return readDb.serviceProvider.findMany({
      where: { status: "active" },
      select: { id: true },
    });
  },
};

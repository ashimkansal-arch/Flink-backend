import { zoneContainsPoint } from "../lib/coverage-zone";
import { kycVerifiedWhere } from "../lib/provider-kyc";
import { db, readDb } from "../lib/prisma";
import { Prisma } from "../generated/prisma/client";

const providerNotDeleted = { status: { not: "deleted" as const } };

const adminZoneSelect = {
  id: true,
  zoneName: true,
  zoneType: true,
  boundaryMode: true,
  city: true,
  state: true,
  address: true,
  centerLat: true,
  centerLng: true,
  radiusKm: true,
  radiusMeters: true,
  polygonGeojson: true,
  isActive: true,
  launchedAt: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: { providers: { where: providerNotDeleted } },
  },
} satisfies Prisma.CoverageZoneSelect;

export type AdminCoverageZoneRow = Prisma.CoverageZoneGetPayload<{ select: typeof adminZoneSelect }>;

export type CoverageZoneWriteData = {
  zoneName: string;
  zoneType: string;
  boundaryMode: string;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  centerLat?: number | null;
  centerLng?: number | null;
  radiusKm?: number | null;
  radiusMeters?: number | null;
  polygonGeojson?: Prisma.InputJsonValue | null;
  isActive?: boolean;
};

export const coverageZoneRepository = {
  listTypes() {
    return readDb.coverageZoneType.findMany({ orderBy: { name: "asc" } });
  },

  findTypeByName(name: string) {
    return readDb.coverageZoneType.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
    });
  },

  async createType(name: string) {
    const existing = await this.findTypeByName(name);
    if (existing) throw new Error("TYPE_TAKEN");
    try {
      return await db.coverageZoneType.create({ data: { name } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new Error("TYPE_TAKEN");
      }
      throw err;
    }
  },

  async ensureType(name: string) {
    try {
      return await this.createType(name);
    } catch (err) {
      if (err instanceof Error && err.message === "TYPE_TAKEN") {
        const existing = await this.findTypeByName(name);
        if (existing) return existing;
      }
      throw err;
    }
  },

  /** Active zones whose boundary contains the point. */
  async findCoveringZoneIds(latitude: number, longitude: number): Promise<string[]> {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      console.log("[availability] covering zones skipped: invalid lat/lng", { latitude, longitude });
      return [];
    }
    const zones = await readDb.coverageZone.findMany({
      where: { isActive: true },
      select: {
        id: true,
        zoneName: true,
        boundaryMode: true,
        centerLat: true,
        centerLng: true,
        radiusKm: true,
        radiusMeters: true,
        polygonGeojson: true,
      },
    });
    const checked = zones.map((zone) => ({
      id: zone.id,
      zoneName: zone.zoneName,
      boundaryMode: zone.boundaryMode,
      contains: zoneContainsPoint(zone, latitude, longitude),
    }));
    const coveringIds = checked.filter((zone) => zone.contains).map((zone) => zone.id);
    console.log("[availability] covering zones", {
      latitude,
      longitude,
      activeZoneCount: zones.length,
      coveringIds,
      zones: checked,
    });
    return coveringIds;
  },

  async isLocationServiceable(latitude: number, longitude: number): Promise<boolean> {
    const coveringZoneIds = await this.findCoveringZoneIds(latitude, longitude);
    if (coveringZoneIds.length === 0) return false;

    const worker = await readDb.serviceProvider.findFirst({
      where: {
        deletedAt: null,
        status: "active",
        coverageZoneId: { in: coveringZoneIds },
        ...kycVerifiedWhere,
      },
      select: { id: true },
    });
    return worker !== null;
  },

  listAssignable() {
    return readDb.coverageZone.findMany({
      select: { id: true, zoneName: true, city: true, isActive: true },
      orderBy: { zoneName: "asc" },
    });
  },

  listAdmin() {
    return readDb.coverageZone.findMany({
      select: adminZoneSelect,
      orderBy: { createdAt: "desc" },
    });
  },

  findAdminById(id: string) {
    return readDb.coverageZone.findUnique({ where: { id }, select: adminZoneSelect });
  },

  exists(id: string) {
    return readDb.coverageZone.findUnique({ where: { id }, select: { id: true } });
  },

  create(data: CoverageZoneWriteData) {
    return db.coverageZone.create({
      data: {
        zoneName: data.zoneName,
        zoneType: data.zoneType,
        boundaryMode: data.boundaryMode,
        city: data.city,
        state: data.state,
        address: data.address,
        centerLat: data.centerLat,
        centerLng: data.centerLng,
        radiusKm: data.radiusKm,
        radiusMeters: data.radiusMeters,
        polygonGeojson: data.polygonGeojson ?? undefined,
        isActive: data.isActive ?? true,
        launchedAt: data.isActive === false ? null : new Date(),
      },
      select: adminZoneSelect,
    });
  },

  update(id: string, data: CoverageZoneWriteData) {
    return db.coverageZone.update({
      where: { id },
      data: {
        zoneName: data.zoneName,
        zoneType: data.zoneType,
        boundaryMode: data.boundaryMode,
        city: data.city,
        state: data.state,
        address: data.address,
        centerLat: data.centerLat,
        centerLng: data.centerLng,
        radiusKm: data.radiusKm,
        radiusMeters: data.radiusMeters,
        polygonGeojson: data.polygonGeojson === null ? Prisma.DbNull : data.polygonGeojson,
        isActive: data.isActive,
        launchedAt: data.isActive === false ? null : undefined,
      },
      select: adminZoneSelect,
    });
  },

  updateActive(id: string, isActive: boolean) {
    return db.coverageZone.update({
      where: { id },
      data: {
        isActive,
        launchedAt: isActive ? new Date() : null,
      },
      select: adminZoneSelect,
    });
  },

  async remove(id: string, reassignToZoneId: string | null) {
    await db.$transaction(async (tx) => {
      await tx.serviceProvider.updateMany({
        where: { coverageZoneId: id },
        data: { coverageZoneId: reassignToZoneId },
      });
      await tx.coverageZone.delete({ where: { id } });
    });
  },
};

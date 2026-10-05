import { isLatLng, parsePolygonPoints, type LatLng } from "../lib/coverage-zone";
import { coverageZoneRepository, type AdminCoverageZoneRow } from "../repositories/coverage-zone-repository";

type BoundaryMode = "radius" | "polygon";

export type GeofenceWriteInput = {
  name: string;
  type: string;
  boundaryMode: BoundaryMode;
  city: string;
  state: string;
  address: string;
  center: LatLng;
  radiusKm?: number;
  radiusMeters?: number;
  polygon?: LatLng[];
  active?: boolean;
};

type StoredPolygon = { points: LatLng[] };

function requireCenter(center: LatLng | undefined): LatLng {
  if (!center || !isLatLng(center)) throw new Error("INVALID_CENTER");
  if (center.lat < -90 || center.lat > 90 || center.lng < -180 || center.lng > 180) {
    throw new Error("INVALID_CENTER");
  }
  return center;
}

function toDto(row: AdminCoverageZoneRow) {
  const polygon = parsePolygonPoints(row.polygonGeojson);
  const boundaryMode: BoundaryMode = row.boundaryMode === "polygon" ? "polygon" : "radius";
  return {
    id: row.id,
    name: row.zoneName,
    type: row.zoneType,
    boundaryMode,
    city: row.city,
    state: row.state,
    address: row.address,
    center:
      row.centerLat != null && row.centerLng != null
        ? { lat: row.centerLat, lng: row.centerLng }
        : null,
    radiusKm: row.radiusKm,
    radiusMeters: row.radiusMeters,
    polygon,
    pointsCount: polygon?.length ?? 0,
    active: row.isActive,
    workerCount: row._count.providers,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function writeData(input: GeofenceWriteInput) {
  const name = input.name.trim();
  if (!name) throw new Error("INVALID_NAME");
  const city = input.city.trim();
  const state = input.state.trim();
  const address = input.address.trim();
  if (!city || !state || !address) throw new Error("INVALID_ADDRESS");

  const center = requireCenter(input.center);
  const isRadius = input.boundaryMode === "radius";
  let radiusKm: number | null = null;
  let radiusMeters: number | null = null;
  let polygonGeojson: StoredPolygon | null = null;

  if (isRadius) {
    radiusKm = Number(input.radiusKm);
    if (!Number.isFinite(radiusKm) || radiusKm <= 0) throw new Error("INVALID_RADIUS");
    radiusMeters = input.radiusMeters ?? Math.round(radiusKm * 1000);
  } else {
    const polygon = (input.polygon ?? []).filter(isLatLng);
    if (polygon.length < 3) throw new Error("INVALID_POLYGON");
    polygonGeojson = { points: polygon };
  }

  const zoneType = input.type.trim().slice(0, 80);
  if (!zoneType) throw new Error("INVALID_TYPE");

  return {
    zoneName: name.slice(0, 80),
    zoneType,
    boundaryMode: isRadius ? ("radius" as const) : ("polygon" as const),
    city,
    state,
    address: address.slice(0, 500),
    centerLat: center.lat,
    centerLng: center.lng,
    radiusKm,
    radiusMeters,
    polygonGeojson,
    isActive: input.active ?? true,
  };
}

export const adminGeofenceService = {
  async list() {
    const rows = await coverageZoneRepository.listAdmin();
    return {
      items: rows.map(toDto),
      stats: {
        total: rows.length,
        active: rows.filter((row) => row.isActive).length,
      },
    };
  },

  async listTypes() {
    const items = await coverageZoneRepository.listTypes();
    return { items };
  },

  async createType(name: string) {
    const trimmed = name.trim().slice(0, 80);
    if (!trimmed) throw new Error("INVALID_TYPE");
    return coverageZoneRepository.createType(trimmed);
  },

  async create(input: GeofenceWriteInput) {
    const data = writeData(input);
    await coverageZoneRepository.ensureType(data.zoneType);
    return toDto(await coverageZoneRepository.create(data));
  },

  async update(id: string, input: GeofenceWriteInput) {
    const existing = await coverageZoneRepository.findAdminById(id);
    if (!existing) throw new Error("ZONE_NOT_FOUND");
    const data = writeData({ ...input, active: input.active ?? existing.isActive });
    await coverageZoneRepository.ensureType(data.zoneType);
    return toDto(await coverageZoneRepository.update(id, data));
  },

  async setActive(id: string, active: boolean) {
    const existing = await coverageZoneRepository.findAdminById(id);
    if (!existing) throw new Error("ZONE_NOT_FOUND");
    return toDto(await coverageZoneRepository.updateActive(id, active));
  },

  async remove(id: string, reassignToZoneId?: string | null) {
    const existing = await coverageZoneRepository.findAdminById(id);
    if (!existing) throw new Error("ZONE_NOT_FOUND");
    if (reassignToZoneId) {
      if (reassignToZoneId === id) throw new Error("CANNOT_REASSIGN_TO_SELF");
      const target = await coverageZoneRepository.exists(reassignToZoneId);
      if (!target) throw new Error("TARGET_ZONE_NOT_FOUND");
    }
    await coverageZoneRepository.remove(id, reassignToZoneId ?? null);
  },
};

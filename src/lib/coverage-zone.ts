import { haversineKm } from "./geo";

export type LatLng = { lat: number; lng: number };

export type CoverageBoundary = {
  boundaryMode: string;
  centerLat: number | null;
  centerLng: number | null;
  radiusKm: number | null;
  radiusMeters: number | null;
  polygonGeojson: unknown;
};

export function isLatLng(value: unknown): value is LatLng {
  if (!value || typeof value !== "object") return false;
  const point = value as { lat?: unknown; lng?: unknown };
  return (
    typeof point.lat === "number" &&
    Number.isFinite(point.lat) &&
    typeof point.lng === "number" &&
    Number.isFinite(point.lng)
  );
}

/** Accepts `{ points: [{ lat, lng }] }` stored on coverage zones. */
export function parsePolygonPoints(value: unknown): LatLng[] | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { points?: unknown };
  if (!Array.isArray(raw.points)) return null;
  const points = raw.points.filter(isLatLng);
  return points.length >= 3 ? points : null;
}

/** ~1 cm in degrees — a point this close to an edge is on it. */
const EDGE_EPSILON = 1e-7;

function pointOnSegment(lat: number, lng: number, a: LatLng, b: LatLng) {
  const cross = (b.lng - a.lng) * (lat - a.lat) - (b.lat - a.lat) * (lng - a.lng);
  const length = Math.hypot(b.lng - a.lng, b.lat - a.lat);
  if (Math.abs(cross) > EDGE_EPSILON * Math.max(length, EDGE_EPSILON)) return false;
  return (
    Math.min(a.lat, b.lat) - EDGE_EPSILON <= lat &&
    lat <= Math.max(a.lat, b.lat) + EDGE_EPSILON &&
    Math.min(a.lng, b.lng) - EDGE_EPSILON <= lng &&
    lng <= Math.max(a.lng, b.lng) + EDGE_EPSILON
  );
}

/** Ray casting (works for concave shapes); a point on an edge or corner counts as inside. */
function pointInPolygon(lat: number, lng: number, polygon: LatLng[]) {
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    if (pointOnSegment(lat, lng, polygon[j], polygon[i])) return true;
  }
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const yi = polygon[i].lat;
    const xi = polygon[i].lng;
    const yj = polygon[j].lat;
    const xj = polygon[j].lng;
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Whether a point lies in a zone. Radius zones: within `radiusKm` (else `radiusMeters`) of the
 * centre, great-circle distance, boundary included. Polygon zones: inside the drawn points.
 */
export function zoneContainsPoint(zone: CoverageBoundary, lat: number, lng: number) {
  if (zone.boundaryMode === "polygon") {
    const points = parsePolygonPoints(zone.polygonGeojson);
    return points ? pointInPolygon(lat, lng, points) : false;
  }

  if (zone.centerLat == null || zone.centerLng == null) return false;
  const radiusKm =
    zone.radiusKm != null && Number.isFinite(zone.radiusKm) && zone.radiusKm > 0
      ? zone.radiusKm
      : zone.radiusMeters != null && zone.radiusMeters > 0
        ? zone.radiusMeters / 1000
        : null;
  if (radiusKm == null) return false;
  return haversineKm(lat, lng, zone.centerLat, zone.centerLng) <= radiusKm;
}

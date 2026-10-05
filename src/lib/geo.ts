import { queueRedis } from "./redis-queue-client";
import { geoKey, GEO_TTL_SECONDS } from "./redis-keys";

// Redis TTLs apply per-key, not per-member, so each write refreshes the whole set's expiry —
// appropriate for something like live courier locations, where the whole index goes stale
// together rather than member-by-member.
export const geo = {
  async add(name: string, member: string, longitude: number, latitude: number): Promise<void> {
    const key = geoKey(name);
    await queueRedis.geoadd(key, longitude, latitude, member);
    await queueRedis.expire(key, GEO_TTL_SECONDS);
  },

  async nearby(name: string, longitude: number, latitude: number, radiusKm: number): Promise<string[]> {
    const members = await queueRedis.geosearch(
      geoKey(name),
      "FROMLONLAT",
      longitude,
      latitude,
      "BYRADIUS",
      radiusKm,
      "km",
    );
    return members as string[];
  },

  async remove(name: string, member: string): Promise<void> {
    await queueRedis.zrem(geoKey(name), member);
  },
};

const EARTH_KM = 6371;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

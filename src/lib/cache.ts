import { cacheRedis } from "./redis-cache-client";
import { cacheKey, CACHE_TTL_SECONDS } from "./redis-keys";

export const cache = {
  async get<T>(name: string): Promise<T | null> {
    try {
      const raw = await cacheRedis.get(cacheKey(name));
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
      return null;
    }
  },

  async set(name: string, value: unknown, ttlSeconds: number = CACHE_TTL_SECONDS.default): Promise<void> {
    try {
      await cacheRedis.set(cacheKey(name), JSON.stringify(value), "EX", ttlSeconds);
    } catch {
      // Cache is optional — miss on next read.
    }
  },

  async del(name: string): Promise<void> {
    try {
      await cacheRedis.del(cacheKey(name));
    } catch {
      // Cache is optional.
    }
  },
};

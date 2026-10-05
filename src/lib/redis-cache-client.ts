import { createRedisClient } from "./redis-client";

// Pure cache (redis-cache, allkeys-lru) — evictable, so nothing here should be a source of
// truth. Kept in its own module so processes that don't touch the cache (e.g. the BullMQ
// worker) never open a connection to this instance. Server.ts guarantees process.env is fully
// populated before this module is imported.
export const cacheRedis = createRedisClient(process.env.REDIS_CACHE_URL as string, "cache", {
  maxRetriesPerRequest: 3,
});

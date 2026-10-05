import { createRedisClient } from "./redis-client";

// Session, geo, and BullMQ queue data (redis-queue, noeviction) — must never be evicted.
// maxRetriesPerRequest: null is required by BullMQ for any connection it manages; it's fine
// for the session/geo modules sharing this connection too. Kept in its own module (separate
// from redis-cache-client.ts) so processes that only need this instance — like the worker —
// don't also open a connection to redis-cache.
export const queueRedis = createRedisClient(process.env.REDIS_QUEUE_URL as string, "queue", {
  maxRetriesPerRequest: null,
});

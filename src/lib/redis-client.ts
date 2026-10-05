import Redis, { type RedisOptions } from "ioredis";

const ERROR_LOG_INTERVAL_MS = 10_000;

function attachRedisErrorLogging(client: Redis, name: string) {
  let lastLoggedAt = 0;

  client.on("error", (err) => {
    const now = Date.now();
    if (now - lastLoggedAt < ERROR_LOG_INTERVAL_MS) return;
    lastLoggedAt = now;
    console.warn(
      `[redis:${name}] ${err.message} — start Redis with: docker compose up -d redis-cache redis-queue`,
    );
  });
}

export function createRedisClient(url: string, name: string, options: RedisOptions = {}) {
  const client = new Redis(url, {
    ...options,
    // Keep retrying forever so a late `docker compose up` recovers without a server restart.
    retryStrategy(times) {
      return Math.min(times * 200, 2000);
    },
    maxRetriesPerRequest: options.maxRetriesPerRequest === undefined ? 3 : options.maxRetriesPerRequest,
  });
  attachRedisErrorLogging(client, name);
  return client;
}

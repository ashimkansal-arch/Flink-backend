# Redis

## Logical separation

Four uses, two Redis instances:

| Use | Instance | Key prefix | Why here |
| --- | --- | --- | --- |
| Cache | `redis-cache` | `cache:` | Safe to lose — a cache miss just recomputes. |
| Session | `redis-queue` | `session:` | Losing a session logs a user out unexpectedly. Not cache-grade data. |
| Geo (live locations) | `redis-queue` | `geo:` | Same — an evicted geo index silently breaks a feature, not just slows it down. |
| BullMQ queue | `redis-queue` | (BullMQ's own `bull:` namespace) | A job is work someone is waiting on; losing it is a correctness bug, not a performance blip. |

**Why two instances instead of four, or one:** the thing that actually matters is eviction
policy, and there are only two policies in play — `allkeys-lru` for cache, `noeviction` for
everything else. Eviction policy is set per Redis *process* (`maxmemory-policy`), not per key
prefix or per logical DB index — so cache and non-cache data cannot safely share an instance no
matter how you namespace the keys. Splitting session/geo/queue further (three more instances)
would buy nothing, since none of them can tolerate eviction anyway; a shared "critical data"
instance with key prefixes is enough to keep them debuggable and avoid key collisions.

This is set up in [docker-compose.yml](docker-compose.yml) as `redis-cache` and `redis-queue`, and
in code as two separate `ioredis` client modules — [src/lib/redis-cache-client.ts](src/lib/redis-cache-client.ts)
(`cacheRedis`) and [src/lib/redis-queue-client.ts](src/lib/redis-queue-client.ts) (`queueRedis`) — kept
apart so a process that only needs one (e.g. the worker) never opens a connection to the other.
They're consumed by [src/lib/cache.ts](src/lib/cache.ts), [src/lib/session.ts](src/lib/session.ts),
[src/lib/geo.ts](src/lib/geo.ts), and [src/queues/example-queue.ts](src/queues/example-queue.ts)
respectively. In staging/production, point `REDIS_CACHE_URL` and `REDIS_QUEUE_URL` at two
genuinely separate managed Redis instances — don't collapse them back into one URL.

## Eviction policy

- `redis-cache`: `allkeys-lru`, `maxmemory 256mb` (local; size for real workload in staging/prod).
  Set via `command:` in docker-compose.yml. Managed providers (Upstash, Elasticache, Redis Cloud)
  expose this as a dashboard/API setting — set it explicitly, don't rely on the provider default.
- `redis-queue`: `noeviction`. If this instance fills up, writes fail loudly instead of silently
  dropping a session, a geo entry, or a queued job. That's the correct failure mode here — it's
  also exactly what [BullMQ requires](https://docs.bullmq.io/guide/going-to-production) of any
  Redis instance it's given: it manages its own job lifecycle (see `removeOnComplete` /
  `removeOnFail` — cleanup is BullMQ's job, not Redis eviction's).

## TTLs per key type

Decided up front in [src/lib/redis-keys.ts](src/lib/redis-keys.ts), not per-callsite:

| Key type | TTL | Rationale |
| --- | --- | --- |
| `cache:*` (short) | 60s | Hot, cheap-to-recompute data — rate-limit counters, live counts. |
| `cache:*` (default) | 5 min | Typical API response cache. |
| `cache:*` (long) | 1 hour | Rarely-changing data, e.g. catalog listings. |
| `session:*` | 7 days | Standard session lifetime. |
| `geo:*` | 30 min | Stale location data (e.g. a courier's last-known position) isn't useful past this. |
| BullMQ jobs | n/a — no raw TTL | BullMQ manages job retention itself (`removeOnComplete`/`removeOnFail`), not via Redis key expiry. |

`cache.set()` defaults to the "default" TTL if none is passed; callers pass `CACHE_TTL_SECONDS.short`
/ `.long` explicitly when the default doesn't fit. Every write into `redis-cache` goes through
`cache.set()` — there's no path that writes a key without a TTL, which is what makes `allkeys-lru`
safe to pair with it (keys expire on their own; LRU eviction is a backstop, not the only cleanup
mechanism).

## BullMQ runs as its own process

[src/queues/worker.ts](src/queues/worker.ts) is a separate entrypoint from
[src/server.ts](src/server.ts) — `npm run worker` locally, its own `worker` container in
docker-compose.yml, built from the same image as `app` but with a different command. A slow or
stuck job can't starve the API server's event loop this way. The queue dashboard
(`docker compose --profile tools up bull-board`, http://localhost:3001) points at `redis-queue`.

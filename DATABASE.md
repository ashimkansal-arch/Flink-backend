# Database

See [ENVIRONMENTS.md](ENVIRONMENTS.md) for how this fits into the overall local → staging → production flow.

## Postgres per environment

| Env | Where | How it's reached |
| --- | --- | --- |
| local | `postgres:16-alpine` in [docker-compose.yml](docker-compose.yml) | `DATABASE_URL` in `.env` → `localhost:5432` (or `postgres:5432` from inside the compose network) |
| staging | Supabase project (staging) | pooled connection string, set as `DATABASE_URL` on the staging host/secret store |
| production | Supabase project (production) | pooled connection string, set as `DATABASE_URL` on the production host/secret store |

Supabase gives you two connection strings per project — keep them straight, they're not interchangeable:

- **Direct/session** (port `5432`) — required for `prisma migrate deploy`. Migrations use session-level
  features (advisory locks, `SET` statements) that don't work reliably through a transaction pooler.
- **Pooled/transaction** (port `6543`, PgBouncer-based) — what the running app should use for
  `DATABASE_URL` at request time. This is what makes many short-lived container instances viable
  against Supabase's connection limit (see pooling below).

So: the app's runtime `DATABASE_URL` = pooled string. The `DATABASE_URL` secret used by the
[migrate.yml](.github/workflows/migrate.yml) CI job = direct/session string. These are two separate
secrets that happen to share an env var name in different contexts — set them accordingly in GitHub
Environment secrets (CI) vs wherever the app itself is deployed (not yet decided).

## ORM

Prisma, with the `@prisma/adapter-pg` driver adapter (Prisma 7 requires an explicit adapter — no
bundled Rust query engine binary, queries go straight through `pg`). Schema: [prisma/schema.prisma](prisma/schema.prisma).
Migrations: [prisma/migrations](prisma/migrations).

## Migration workflow

Decided: **fully automatic in every environment, no manual approval gate.**

- **Local**: `npm run db:migrate:dev` — interactive, generates a new migration file from schema
  changes and applies it to your local Postgres.
- **Staging**: `prisma migrate deploy` runs automatically in CI on every push to `staging`
  ([.github/workflows/migrate.yml](.github/workflows/migrate.yml)).
- **Production**: same — `prisma migrate deploy` runs automatically on every push to `main`. No
  human approval step. This is faster but means a bad migration can land in prod unattended;
  mitigate by keeping migrations backward-compatible (additive first, remove/rename in a follow-up
  deploy) and by relying on the backup/PITR policy below as the safety net rather than a manual gate.

`prisma migrate deploy` never generates migrations, only applies ones already committed — so a
migration is always reviewed as code (PR) before it's *possible* for CI to run it, even without a
runtime approval gate.

## Seed data

Split into two, by whether it's safe to run in staging/production:

- **[prisma/reference-data.ts](prisma/reference-data.ts)** — idempotent (`upsert`-based): RBAC
  roles/permissions (`admin_roles`/`admin_permissions`/`role_permissions`) and the service catalog
  (`service_categories`/`service_plans`/`service_addons`/`coverage_zones`). Safe, and required, to
  run anywhere — admin login has nothing to authorize against on a fresh migration without it.
  Run with `npm run db:seed:reference`; wired into
  [.github/workflows/migrate.yml](.github/workflows/migrate.yml) right after `prisma migrate
  deploy`, for both staging and production. The initial `super_admin` user is inserted by
  migration `20260816123000_seed_super_admin`.
- **[prisma/seed.ts](prisma/seed.ts)** — disposable: calls `seedReferenceData()` first, then wipes
  and re-creates fake `User`/`ServiceProvider` rows via `@faker-js/faker`. Local dev only, **not**
  wired into CI. Run with `npm run db:seed`.

## Connection pooling

Two layers, matching the two connection strings above:

1. **App-level pool** (`pg.Pool`, via the Prisma driver adapter) — sized by `DATABASE_POOL_MAX`
   (see [.env.example](.env.example), default `10`), wired in [src/lib/prisma.ts](src/lib/prisma.ts).
   Rule of thumb: `DATABASE_POOL_MAX × (number of running app instances)` should stay comfortably
   under the pooler's own connection budget, not the raw Postgres `max_connections` — the pooler is
   what absorbs per-instance fan-out.
2. **Supabase's built-in pooler** (PgBouncer, transaction mode, port `6543`) in front of the actual
   Postgres instance for staging/production. This is why the app talks to the *pooled* URL, not the
   database directly — it's what lets many short-lived container instances each hold a small
   `pg.Pool` without exhausting Postgres's real connection limit. Nothing to self-host or configure
   beyond using the right connection string.

Locally there's a single Postgres container and a single app instance, so pooling is a non-issue —
`DATABASE_POOL_MAX=10` there is just headroom, not a real constraint.

## Backup policy

Decided (Supabase):

- **Automated daily backups**, retained per the project's plan tier.
- **Point-in-time recovery (PITR)** enabled for both staging and production once on a plan that
  supports it — lets us restore to any point within the retention window, not just a daily
  snapshot boundary. This needs to be turned on in the Supabase dashboard per-project; it isn't
  something this repo configures in code.
- Local dev has no backup policy — the docker-compose `postgres-data` volume is disposable; `npm
  run db:seed` is how you get a database back into a known state.

## Read replica plan

Not provisioning one yet, but the seam is already in place so adding one later is a config change,
not a rewrite:

- [src/lib/prisma.ts](src/lib/prisma.ts) exports two clients: `db` (writes) and `readDb` (reads).
  `readDb` defaults to the same instance as `db` until `DATABASE_READ_URL` is set.
- All DB access goes through a repository (see [src/repositories](src/repositories)), which calls
  `readDb` for reads and `db` for writes. Route handlers never import the Prisma client directly.
- When a read replica exists: set `DATABASE_READ_URL` to its (pooled) connection string. No route,
  repository, or application code needs to change.

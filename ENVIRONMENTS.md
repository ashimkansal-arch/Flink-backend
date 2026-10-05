# Environments

Three environments, no separate QA tier — QA happens against staging.

| | local | staging | production |
| --- | --- | --- | --- |
| Branch | (your working branch, uncommitted) | `staging` | `main` |
| Postgres | `postgres` container in [docker-compose.yml](docker-compose.yml) | Supabase project (staging) | Supabase project (production) |
| Redis (cache + queue) | `redis-cache` / `redis-queue` containers | separate managed instances — **not provisioned yet** | separate managed instances — **not provisioned yet** |
| Migrations | manual — `npm run db:migrate:dev` | automatic — `prisma migrate deploy` in CI on push to `staging` | automatic — `prisma migrate deploy` in CI on push to `main` |
| Who tests here | you, while building | QA | real users |
| `NODE_ENV` | `local` | `staging` | `production` |

## The flow

1. Develop against the local stack (`docker compose up -d`, `npm run dev`), migrating with
   `npm run db:migrate:dev` as the schema changes. Local Postgres — nothing else is touched.
2. Push/merge to `staging`. [.github/workflows/migrate.yml](.github/workflows/migrate.yml) runs
   `prisma migrate deploy` against the **staging** Supabase project automatically — no approval
   step, per your earlier call to keep this fully automatic. QA tests against staging from here.
3. Once QA signs off, merge/push `staging` → `main`. The same workflow runs `prisma migrate
   deploy` against the **production** Supabase project, automatically, on that push.

Each environment has its own `DATABASE_URL` (and once provisioned, its own Redis URLs) — nothing
is shared across environments. That separation is enforced structurally: `DATABASE_URL` for CI is
a GitHub Environment secret scoped to `staging` or `production` respectively (Settings →
Environments in this repo), not a value that lives in code or a shared `.env`.

## What's real vs. what's still a placeholder

- **Local**: fully working today — verified end to end (app, worker, Postgres, both Redis
  instances, migrations, seed data).
- **Staging / production databases**: the workflow above is wired and will run automatically the
  moment the secrets exist — but no Supabase project has actually been created for either yet, and
  no `DATABASE_URL` secret has been set in GitHub. Until that's done, `migrate.yml` will fail on
  its first real push to `staging`/`main` (nothing to connect to).
- **Staging / production Redis**: not provisioned anywhere yet. [REDIS.md](REDIS.md)'s two-instance
  design (cache vs. queue, different eviction policy) needs a managed Redis provider decision for
  each environment the same way Postgres needed Supabase — this hasn't been made.
- **App hosting itself**: migrations running automatically doesn't mean the *app* is deployed
  anywhere yet — no hosting platform has been chosen for staging or production. That's a separate,
  still-open decision.

## Checklist: provisioning staging + production Postgres

For each environment (do this twice — once for staging, once for production):

1. **Create the Supabase project.** [supabase.com/dashboard](https://supabase.com/dashboard) →
   New project. Name it clearly, e.g. `flink-backend-staging` / `flink-backend-production`. Pick a
   strong database password — you'll only need it to build the connection strings below.
2. **Grab both connection strings** from Project Settings → Database → Connection string:
   - **Session/direct** (port `5432`) — this is what CI needs for migrations, since `prisma
     migrate deploy` uses session-level features a transaction pooler doesn't support.
   - **Transaction pooler** (port `6543`) — this is what the *running app* should use once it's
     deployed. Not needed for the migration workflow itself; save it for when hosting is decided.
3. **Create the GitHub Environment** (if it doesn't exist): this repo's Settings → Environments →
   New environment → name it exactly `staging` or `production` (must match the `environment:` key
   in [.github/workflows/migrate.yml](.github/workflows/migrate.yml)).
4. **Add the secret**: inside that environment, Environment secrets → New secret → name
   `DATABASE_URL` → paste the **session/direct** (port `5432`) connection string from step 2.
5. **(Optional, recommended) Enable PITR** on the project — Database → Backups. Needs a paid plan;
   see [DATABASE.md](DATABASE.md#backup-policy) for why this matters.

Once both environments' `DATABASE_URL` secrets exist, pushing to `staging` or `main` will run
`prisma migrate deploy` against the real database automatically — no other change needed, the
workflow is already in place.

**Not covered by this checklist**: the transaction-pooler connection string (step 2's second URL)
and the rest of the app's required env vars (`JWT_*`, `STRIPE_*`, `AWS_*`, `ALLOWED_ORIGINS`,
`REDIS_CACHE_URL`, `REDIS_QUEUE_URL`) still need to be set *wherever the app itself runs* once
hosting is chosen — that's separate from these GitHub Environment secrets, which only feed the
migration job.

-- CRM teams / scope model (PRD v2)
CREATE TYPE "AccessScopeLevel" AS ENUM (
  'global',
  'business_unit',
  'city',
  'zone',
  'team',
  'assigned',
  'self'
);

ALTER TABLE "admin_roles" ALTER COLUMN "role_name" TYPE VARCHAR(60);

ALTER TABLE "admin_users"
  ADD COLUMN "scope_level" "AccessScopeLevel" NOT NULL DEFAULT 'global',
  ADD COLUMN "scope_business_unit" VARCHAR(80),
  ADD COLUMN "scope_city_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "scope_zone_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "idx_admin_users_scope_level" ON "admin_users"("scope_level");

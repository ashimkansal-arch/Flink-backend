-- Named multi-service packages replace per-category Basic/Standard/Premium tiers.

ALTER TABLE "service_plans"
  ADD COLUMN "name" VARCHAR(80),
  ADD COLUMN "slug" VARCHAR(80),
  ADD COLUMN "description" TEXT,
  ADD COLUMN "included_tasks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "excluded_tasks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

UPDATE "service_plans" p
SET
  "name" = INITCAP(p."tier_name"::text),
  "slug" = c."slug" || '-' || p."tier_name"::text,
  "included_tasks" = c."included_tasks",
  "excluded_tasks" = c."excluded_tasks"
FROM "service_categories" c
WHERE c."category_id" = p."category_id";

UPDATE "service_plans"
SET
  "name" = COALESCE("name", 'Package'),
  "slug" = COALESCE("slug", "plan_id"::text);

CREATE TABLE "service_plan_services" (
  "plan_id" UUID NOT NULL,
  "category_id" UUID NOT NULL,
  CONSTRAINT "service_plan_services_pkey" PRIMARY KEY ("plan_id", "category_id")
);

INSERT INTO "service_plan_services" ("plan_id", "category_id")
SELECT "plan_id", "category_id" FROM "service_plans";

ALTER TABLE "service_plan_services"
  ADD CONSTRAINT "service_plan_services_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "service_plans"("plan_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "service_plan_services"
  ADD CONSTRAINT "service_plan_services_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "service_categories"("category_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "idx_service_plan_services_category" ON "service_plan_services"("category_id");

ALTER TABLE "service_plans" DROP CONSTRAINT IF EXISTS "service_plans_category_id_fkey";
DROP INDEX IF EXISTS "service_plans_category_tier_key";
DROP INDEX IF EXISTS "idx_service_plans_category";

ALTER TABLE "service_plans"
  DROP COLUMN "category_id",
  DROP COLUMN "tier_name",
  DROP COLUMN "is_default";

ALTER TABLE "service_plans"
  ALTER COLUMN "name" SET NOT NULL,
  ALTER COLUMN "slug" SET NOT NULL;

CREATE UNIQUE INDEX "service_plans_slug_key" ON "service_plans"("slug");

DROP TYPE IF EXISTS "ServicePlanTier";

INSERT INTO "admin_permissions" ("permission_id", "permission_key", "description")
SELECT gen_random_uuid(), v.key, v.description
FROM (VALUES
  ('packages:read', 'Can list and view recommended service packages'),
  ('packages:create', 'Can create recommended service packages'),
  ('packages:update', 'Can update recommended service packages'),
  ('packages:delete', 'Can delete recommended service packages'),
  ('packages:*', 'Full recommended service package management')
) AS v(key, description)
WHERE NOT EXISTS (
  SELECT 1 FROM "admin_permissions" p WHERE p."permission_key" = v.key
);

INSERT INTO "admin_modules" (
  "module_id",
  "name",
  "slug",
  "section_name",
  "section_slug",
  "path",
  "icon",
  "description",
  "is_active",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  'Packages',
  'packages',
  'System',
  'system',
  '/packages',
  'Package',
  'Recommended multi-service packages shown to customers.',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1
  FROM "admin_modules" m
  WHERE m."slug" = 'packages' OR m."path" = '/packages'
);

INSERT INTO "role_modules" ("role_id", "module_id")
SELECT r."role_id", m."module_id"
FROM "admin_roles" r
CROSS JOIN "admin_modules" m
WHERE r."role_name" = 'super_admin'
  AND m."slug" = 'packages'
  AND m."is_active" = true
  AND NOT EXISTS (
    SELECT 1
    FROM "role_modules" rm
    WHERE rm."role_id" = r."role_id"
      AND rm."module_id" = m."module_id"
  );

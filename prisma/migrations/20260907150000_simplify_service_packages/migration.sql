-- Packages stay on service_plans as Basic/Standard/Premium + price/duration.
-- Name, slug, description, and included tasks already live on the sub-service (category).

DROP INDEX IF EXISTS "service_plans_category_slug_key";

UPDATE "service_plans"
SET "tier_name" = 'basic'
WHERE "tier_name" IS NULL;

ALTER TABLE "service_plans"
  ALTER COLUMN "tier_name" SET NOT NULL;

ALTER TABLE "service_plans"
  DROP COLUMN IF EXISTS "name",
  DROP COLUMN IF EXISTS "slug",
  DROP COLUMN IF EXISTS "description",
  DROP COLUMN IF EXISTS "pricing_mode",
  DROP COLUMN IF EXISTS "included_features",
  DROP COLUMN IF EXISTS "is_popular",
  DROP COLUMN IF EXISTS "is_active",
  DROP COLUMN IF EXISTS "created_at",
  DROP COLUMN IF EXISTS "updated_at";

DROP TYPE IF EXISTS "ServicePlanPricingMode";

CREATE UNIQUE INDEX IF NOT EXISTS "service_plans_category_tier_key"
  ON "service_plans"("category_id", "tier_name");

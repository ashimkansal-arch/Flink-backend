-- Named packages per sub-service: display name, slug, features, and pricing mode.
-- Existing rows are backfilled from tier_name (basic / standard / premium).

CREATE TYPE "ServicePlanPricingMode" AS ENUM ('fixed', 'from');

ALTER TABLE "service_plans"
  ADD COLUMN IF NOT EXISTS "name" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "slug" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "pricing_mode" "ServicePlanPricingMode" NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS "included_features" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "is_popular" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "service_plans"
SET
  "name" = CASE "tier_name"
    WHEN 'basic' THEN 'Basic'
    WHEN 'standard' THEN 'Standard'
    WHEN 'premium' THEN 'Premium'
    ELSE INITCAP(REPLACE("tier_name"::text, '_', ' '))
  END,
  "slug" = "tier_name"::text
WHERE "name" IS NULL OR "slug" IS NULL;

ALTER TABLE "service_plans"
  ALTER COLUMN "name" SET NOT NULL,
  ALTER COLUMN "slug" SET NOT NULL,
  ALTER COLUMN "tier_name" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "service_plans_category_slug_key"
  ON "service_plans"("category_id", "slug");

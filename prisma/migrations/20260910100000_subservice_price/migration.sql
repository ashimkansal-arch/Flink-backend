-- Base price on catalog nodes. Used for sub-services in CRM and customer APIs.
-- Parent services stay NULL. Existing children are backfilled from the cheapest package.

ALTER TABLE "service_categories"
  ADD COLUMN "price_paise" BIGINT;

UPDATE "service_categories" sc
SET "price_paise" = (
  SELECT MIN(sp."price_paise")
  FROM "service_plans" sp
  WHERE sp."category_id" = sc."category_id"
)
WHERE sc."parent_id" IS NOT NULL
  AND sc."price_paise" IS NULL;

ALTER TABLE "service_categories"
  ADD CONSTRAINT "service_categories_price_paise_check"
  CHECK ("price_paise" IS NULL OR "price_paise" > 0);

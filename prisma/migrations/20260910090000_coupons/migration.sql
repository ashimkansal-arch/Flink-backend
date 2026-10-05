-- Promo coupons for CRM (percent or flat). Usage count is incremented
-- when a booking redemption path exists; staff can still set the cap.

CREATE TYPE "CouponDiscountType" AS ENUM ('percent', 'flat');

CREATE TABLE "coupons" (
  "coupon_id" UUID NOT NULL,
  "code" VARCHAR(20) NOT NULL,
  "description" VARCHAR(120) NOT NULL,
  "discount_type" "CouponDiscountType" NOT NULL,
  "percent_off" INTEGER,
  "amount_off_paise" BIGINT,
  "max_uses" INTEGER NOT NULL,
  "used_count" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "expires_at" DATE NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "coupons_pkey" PRIMARY KEY ("coupon_id")
);

CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");
CREATE INDEX "idx_coupons_active" ON "coupons"("is_active");

ALTER TABLE "coupons"
  ADD CONSTRAINT "coupons_percent_off_check"
  CHECK ("percent_off" IS NULL OR ("percent_off" >= 1 AND "percent_off" <= 100));

ALTER TABLE "coupons"
  ADD CONSTRAINT "coupons_max_uses_check"
  CHECK ("max_uses" >= 1);

ALTER TABLE "coupons"
  ADD CONSTRAINT "coupons_used_count_check"
  CHECK ("used_count" >= 0);

INSERT INTO "admin_permissions" ("permission_id", "permission_key", "description")
SELECT gen_random_uuid(), v.key, v.description
FROM (VALUES
  ('coupons:read', 'Can list and view coupons'),
  ('coupons:create', 'Can create coupons'),
  ('coupons:update', 'Can update coupons and toggle active'),
  ('coupons:delete', 'Can delete coupons'),
  ('coupons:*', 'Full coupon management')
) AS v(key, description)
WHERE NOT EXISTS (
  SELECT 1 FROM "admin_permissions" p WHERE p."permission_key" = v.key
);

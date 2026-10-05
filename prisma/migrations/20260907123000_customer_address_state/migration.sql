-- Places payload fields for customer location confirmation (street/locality stay on line1/line2).

ALTER TABLE "addresses"
  ADD COLUMN IF NOT EXISTS "state" VARCHAR(80);

ALTER TABLE "addresses"
  ADD COLUMN IF NOT EXISTS "formatted_address" TEXT;

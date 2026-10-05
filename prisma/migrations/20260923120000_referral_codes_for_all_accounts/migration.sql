-- Referral codes for every customer and worker, generated when the account is created:
-- customers FLK-C-002, FLK-C-003…; workers FLK-W-002, FLK-W-003… (numbered from 2, at least 3 digits).
-- Each account type draws numbers from its own sequence (see src/lib/referral-code.ts).

CREATE SEQUENCE "customer_referral_code_seq" START WITH 2;
CREATE SEQUENCE "worker_referral_code_seq" START WITH 2;

-- Room for the prefix plus large numbers.
ALTER TABLE "users"
  ALTER COLUMN "referral_code" TYPE VARCHAR(20),
  ALTER COLUMN "referred_by_code" TYPE VARCHAR(20);
ALTER TABLE "referrals" ALTER COLUMN "referral_code" TYPE VARCHAR(20);
ALTER TABLE "service_providers" ADD COLUMN "referral_code" VARCHAR(20);

-- Existing customers switch to the new format in sign-up order. Codes already used to refer
-- someone are rewritten first, so existing referral links keep pointing at the right person.
-- (Each statement derives the same old → new mapping; the ordering doesn't change in between.)
WITH "numbered" AS (
  SELECT "referral_code" AS "old_code",
         row_number() OVER (ORDER BY "created_at", "user_id") + 1 AS "n"
  FROM "users"
), "code_map" AS (
  SELECT "old_code", 'FLK-C-' || lpad("n"::text, greatest(3, length("n"::text)), '0') AS "new_code"
  FROM "numbered" WHERE "old_code" IS NOT NULL
)
UPDATE "users" u SET "referred_by_code" = m."new_code"
FROM "code_map" m WHERE u."referred_by_code" = m."old_code";

WITH "numbered" AS (
  SELECT "referral_code" AS "old_code",
         row_number() OVER (ORDER BY "created_at", "user_id") + 1 AS "n"
  FROM "users"
), "code_map" AS (
  SELECT "old_code", 'FLK-C-' || lpad("n"::text, greatest(3, length("n"::text)), '0') AS "new_code"
  FROM "numbered" WHERE "old_code" IS NOT NULL
)
UPDATE "referrals" r SET "referral_code" = m."new_code"
FROM "code_map" m WHERE r."referral_code" = m."old_code";

UPDATE "users" u
SET "referral_code" = 'FLK-C-' || lpad(c."n"::text, greatest(3, length(c."n"::text)), '0')
FROM (
  SELECT "user_id", row_number() OVER (ORDER BY "created_at", "user_id") + 1 AS "n"
  FROM "users"
) c
WHERE u."user_id" = c."user_id";

-- Existing workers get codes in the order they were added.
UPDATE "service_providers" p
SET "referral_code" = 'FLK-W-' || lpad(w."n"::text, greatest(3, length(w."n"::text)), '0')
FROM (
  SELECT "provider_id", row_number() OVER (ORDER BY "created_at", "provider_id") + 1 AS "n"
  FROM "service_providers"
) w
WHERE p."provider_id" = w."provider_id";

-- Continue numbering after the backfilled codes.
SELECT setval('customer_referral_code_seq', (SELECT count(*) + 2 FROM "users"), false);
SELECT setval('worker_referral_code_seq', (SELECT count(*) + 2 FROM "service_providers"), false);

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "referral_code" SET NOT NULL;

-- AlterTable
ALTER TABLE "service_providers" ALTER COLUMN "referral_code" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "service_providers_referral_code_key" ON "service_providers"("referral_code");

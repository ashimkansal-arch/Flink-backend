-- Worker ratings can include an optional photo. Jobs-completed is backfilled
-- from finished bookings. Providers in the CRM are Workers (including KYC).

ALTER TABLE "reviews_ratings"
  ADD COLUMN IF NOT EXISTS "image_url" TEXT;

UPDATE "service_providers" sp
SET "total_jobs_completed" = sub.cnt
FROM (
  SELECT a."provider_id" AS provider_id, COUNT(*)::int AS cnt
  FROM "assignments" a
  INNER JOIN "bookings" b ON b."booking_id" = a."booking_id"
  WHERE a."status" IN ('accepted', 'completed')
    AND b."status" IN ('completed', 'paid')
  GROUP BY a."provider_id"
) sub
WHERE sp."provider_id" = sub.provider_id;

UPDATE "admin_modules"
SET
  "name" = 'Workers',
  "icon" = 'Users',
  "section_name" = 'Operations',
  "section_slug" = 'operations'
WHERE "path" = '/workers' OR "slug" = 'workers';

UPDATE "admin_modules"
SET
  "name" = 'Workers KYC',
  "icon" = 'ClipboardCheck',
  "section_name" = 'Operations',
  "section_slug" = 'operations'
WHERE "path" = '/workers/kyc' OR "slug" = 'workers-kyc';

DELETE FROM "admin_modules"
WHERE "path" IN ('/providers', '/providers/kyc')
   OR "slug" IN ('providers', 'providers-kyc', 'provider-kyc');

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
  'Workers KYC',
  'workers-kyc',
  'Operations',
  'operations',
  '/workers/kyc',
  'ClipboardCheck',
  NULL,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "admin_modules" m
  WHERE m."slug" = 'workers-kyc' OR m."path" = '/workers/kyc'
);

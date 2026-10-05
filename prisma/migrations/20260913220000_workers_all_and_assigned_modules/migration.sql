UPDATE "admin_modules"
SET "name" = 'Workers · All'
WHERE "path" = '/workers';

INSERT INTO "admin_modules" (
  "module_id",
  "name",
  "slug",
  "section_name",
  "section_slug",
  "path",
  "icon",
  "display_order",
  "description",
  "is_active",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  'Workers · Assigned',
  'workers-assigned',
  m."section_name",
  m."section_slug",
  '/workers/assigned',
  m."icon",
  m."display_order" + 1,
  'Workers assigned to the signed-in team member',
  true,
  NOW(),
  NOW()
FROM "admin_modules" m
WHERE m."path" = '/workers'
  AND NOT EXISTS (
    SELECT 1 FROM "admin_modules" existing WHERE existing."path" = '/workers/assigned'
  );

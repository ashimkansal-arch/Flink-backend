-- Sidebar section for each CRM module. Existing rows land under System.

ALTER TABLE "admin_modules"
  ADD COLUMN IF NOT EXISTS "section_name" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "section_slug" VARCHAR(80);

UPDATE "admin_modules"
SET
  "section_name" = 'System',
  "section_slug" = 'system'
WHERE "section_name" IS NULL OR "section_slug" IS NULL;

ALTER TABLE "admin_modules"
  ALTER COLUMN "section_name" SET NOT NULL,
  ALTER COLUMN "section_slug" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_admin_modules_section" ON "admin_modules"("section_slug");

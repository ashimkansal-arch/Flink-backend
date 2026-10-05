-- Display name + active flag on roles. Modules are first-class CRM screens
-- that Super Admin assigns to roles.

ALTER TABLE "admin_roles"
  ADD COLUMN IF NOT EXISTS "name" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true;

UPDATE "admin_roles"
SET "name" = INITCAP(REPLACE("role_name", '_', ' '))
WHERE "name" IS NULL OR "name" = '';

ALTER TABLE "admin_roles"
  ALTER COLUMN "name" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "admin_modules" (
  "module_id" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "slug" VARCHAR(80) NOT NULL,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_modules_pkey" PRIMARY KEY ("module_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "admin_modules_slug_key" ON "admin_modules"("slug");

CREATE TABLE IF NOT EXISTS "role_modules" (
  "role_id" UUID NOT NULL,
  "module_id" UUID NOT NULL,
  CONSTRAINT "role_modules_pkey" PRIMARY KEY ("role_id", "module_id")
);

ALTER TABLE "role_modules"
  DROP CONSTRAINT IF EXISTS "role_modules_role_id_fkey",
  DROP CONSTRAINT IF EXISTS "role_modules_module_id_fkey";

ALTER TABLE "role_modules"
  ADD CONSTRAINT "role_modules_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "admin_roles"("role_id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "role_modules_module_id_fkey"
    FOREIGN KEY ("module_id") REFERENCES "admin_modules"("module_id") ON DELETE CASCADE ON UPDATE CASCADE;

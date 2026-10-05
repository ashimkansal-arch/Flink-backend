-- Move supervisors off service_providers onto their own table.

ALTER TABLE "service_providers" DROP CONSTRAINT IF EXISTS "service_providers_created_by_fkey";
ALTER TABLE "service_providers" DROP CONSTRAINT IF EXISTS "service_providers_category_id_fkey";
DROP INDEX IF EXISTS "idx_providers_category";
DROP INDEX IF EXISTS "service_providers_email_key";

ALTER TABLE "service_providers"
DROP COLUMN IF EXISTS "first_name",
DROP COLUMN IF EXISTS "last_name",
DROP COLUMN IF EXISTS "password_hash",
DROP COLUMN IF EXISTS "password_reset_required",
DROP COLUMN IF EXISTS "category_id",
DROP COLUMN IF EXISTS "created_by";

CREATE TYPE "SupervisorStatus" AS ENUM ('active', 'disabled');

CREATE TABLE "supervisors" (
    "supervisor_id" UUID NOT NULL,
    "first_name" VARCHAR(60) NOT NULL,
    "last_name" VARCHAR(60) NOT NULL,
    "email" VARCHAR(160) NOT NULL,
    "phone_number" VARCHAR(15) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "password_reset_required" BOOLEAN NOT NULL DEFAULT true,
    "category_id" UUID NOT NULL,
    "status" "SupervisorStatus" NOT NULL DEFAULT 'active',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supervisors_pkey" PRIMARY KEY ("supervisor_id")
);

CREATE UNIQUE INDEX "supervisors_email_key" ON "supervisors"("email");
CREATE UNIQUE INDEX "supervisors_phone_number_key" ON "supervisors"("phone_number");
CREATE INDEX "idx_supervisors_category" ON "supervisors"("category_id");
CREATE INDEX "idx_supervisors_created_by" ON "supervisors"("created_by");

ALTER TABLE "supervisors" ADD CONSTRAINT "supervisors_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("category_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supervisors" ADD CONSTRAINT "supervisors_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admin_users"("admin_id") ON DELETE RESTRICT ON UPDATE CASCADE;

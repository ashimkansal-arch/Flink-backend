ALTER TABLE "coverage_zones"
  ALTER COLUMN "zone_type" TYPE VARCHAR(80);

CREATE TABLE IF NOT EXISTS "coverage_zone_types" (
  "zone_type_id" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "coverage_zone_types_pkey" PRIMARY KEY ("zone_type_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "coverage_zone_types_name_key" ON "coverage_zone_types"("name");

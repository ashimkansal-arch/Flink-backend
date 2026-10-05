ALTER TABLE "bookings" ADD COLUMN "service_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE "bookings" SET "service_ids" = ARRAY[category_id::text];
ALTER TABLE "bookings" ALTER COLUMN "plan_id" DROP NOT NULL;


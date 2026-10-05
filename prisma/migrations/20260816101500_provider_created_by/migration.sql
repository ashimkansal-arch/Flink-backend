-- AlterTable
ALTER TABLE "service_providers" ADD COLUMN "created_by" UUID;

-- AddForeignKey
ALTER TABLE "service_providers" ADD CONSTRAINT "service_providers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admin_users"("admin_id") ON DELETE SET NULL ON UPDATE CASCADE;

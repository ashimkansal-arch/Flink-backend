-- AlterEnum
ALTER TYPE "ProviderStatus" ADD VALUE IF NOT EXISTS 'disabled';

-- AlterTable
ALTER TABLE "service_providers" ADD COLUMN "device_info" JSONB;

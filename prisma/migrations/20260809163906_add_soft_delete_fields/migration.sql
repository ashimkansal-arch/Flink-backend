-- AlterEnum
ALTER TYPE "ProviderStatus" ADD VALUE 'deleted';

-- AlterTable
ALTER TABLE "service_providers" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "service_providers"
ADD COLUMN "first_name" VARCHAR(60),
ADD COLUMN "last_name" VARCHAR(60),
ADD COLUMN "password_hash" VARCHAR(255),
ADD COLUMN "password_reset_required" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "category_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "service_providers_email_key" ON "service_providers"("email");

-- CreateIndex
CREATE INDEX "idx_providers_category" ON "service_providers"("category_id");

-- AddForeignKey
ALTER TABLE "service_providers" ADD CONSTRAINT "service_providers_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("category_id") ON DELETE SET NULL ON UPDATE CASCADE;

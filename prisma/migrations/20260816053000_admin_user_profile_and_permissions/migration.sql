-- AlterTable
ALTER TABLE "admin_roles" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "admin_users"
ADD COLUMN "first_name" VARCHAR(60),
ADD COLUMN "last_name" VARCHAR(60),
ADD COLUMN "phone_number" VARCHAR(15),
ADD COLUMN "password_reset_required" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "status" SET DEFAULT 'active';

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_phone_number_key" ON "admin_users"("phone_number");

-- CreateTable
CREATE TABLE "admin_user_permissions" (
    "admin_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "admin_user_permissions_pkey" PRIMARY KEY ("admin_id","permission_id")
);

-- AddForeignKey
ALTER TABLE "admin_user_permissions" ADD CONSTRAINT "admin_user_permissions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("admin_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_user_permissions" ADD CONSTRAINT "admin_user_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "admin_permissions"("permission_id") ON DELETE CASCADE ON UPDATE CASCADE;

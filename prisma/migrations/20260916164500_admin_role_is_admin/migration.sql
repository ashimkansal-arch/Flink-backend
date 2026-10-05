ALTER TABLE "admin_roles" ADD COLUMN "is_admin" BOOLEAN NOT NULL DEFAULT false;
UPDATE "admin_roles" SET "is_admin" = true WHERE "role_name" = 'super_admin';

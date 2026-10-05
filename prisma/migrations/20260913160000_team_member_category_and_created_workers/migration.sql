ALTER TABLE "admin_users"
  ADD COLUMN "category_id" UUID,
  ADD COLUMN "assigned_to" UUID;

ALTER TABLE "service_providers"
  ADD COLUMN "registered_by_admin_id" UUID;

CREATE INDEX "idx_admin_users_category" ON "admin_users"("category_id");
CREATE INDEX "idx_admin_users_assigned_to" ON "admin_users"("assigned_to");
CREATE INDEX "idx_providers_registered_by_admin" ON "service_providers"("registered_by_admin_id");

ALTER TABLE "admin_users"
  ADD CONSTRAINT "admin_users_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "service_categories"("category_id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "admin_users"
  ADD CONSTRAINT "admin_users_assigned_to_fkey"
  FOREIGN KEY ("assigned_to") REFERENCES "admin_users"("admin_id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "service_providers"
  ADD CONSTRAINT "service_providers_registered_by_admin_id_fkey"
  FOREIGN KEY ("registered_by_admin_id") REFERENCES "admin_users"("admin_id")
  ON DELETE SET NULL ON UPDATE CASCADE;

DELETE FROM "admin_modules" WHERE "path" = '/admin-supervisors' OR "slug" = 'admin-supervisors';

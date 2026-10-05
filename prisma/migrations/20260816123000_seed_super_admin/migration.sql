INSERT INTO "admin_permissions" ("permission_id", "permission_key", "description")
SELECT gen_random_uuid(), '*', 'All permissions (super admin)'
WHERE NOT EXISTS (SELECT 1 FROM "admin_permissions" WHERE "permission_key" = '*');

INSERT INTO "admin_roles" ("role_id", "role_name", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), 'super_admin', 'Full platform control', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "admin_roles" WHERE "role_name" = 'super_admin');

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."role_id", p."permission_id"
FROM "admin_roles" r
CROSS JOIN "admin_permissions" p
WHERE r."role_name" = 'super_admin'
  AND p."permission_key" = '*'
ON CONFLICT DO NOTHING;

INSERT INTO "admin_users" (
  "admin_id",
  "email",
  "full_name",
  "password_hash",
  "role_id",
  "status",
  "password_reset_required",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  'super-admin@theflink.in',
  'Super Admin',
  '$2b$10$KTrQ6d/supVxCQWq/LwFbu6V/7xUDi4ZapbMG29WQ2gmSs2yw9AYG',
  r."role_id",
  'active',
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "admin_roles" r
WHERE r."role_name" = 'super_admin'
ON CONFLICT ("email") DO UPDATE SET
  "password_hash" = EXCLUDED."password_hash",
  "role_id" = EXCLUDED."role_id",
  "status" = 'active',
  "password_reset_required" = false,
  "full_name" = COALESCE("admin_users"."full_name", EXCLUDED."full_name"),
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "admin_user_permissions" ("admin_id", "permission_id")
SELECT u."admin_id", p."permission_id"
FROM "admin_users" u
CROSS JOIN "admin_permissions" p
WHERE u."email" = 'super-admin@theflink.in'
  AND p."permission_key" = '*'
ON CONFLICT DO NOTHING;

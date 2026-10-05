INSERT INTO "admin_roles" ("role_id", "role_name", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), 'admin', 'Day-to-day platform admin', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "admin_roles" WHERE "role_name" = 'admin');

INSERT INTO "admin_roles" ("role_id", "role_name", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), 'supervisor', 'Supervises operations', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "admin_roles" WHERE "role_name" = 'supervisor');

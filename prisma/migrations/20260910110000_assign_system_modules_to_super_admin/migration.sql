-- Super Admin System screens are assignment-based. Seed every active System
-- module onto the reserved role so existing Super Admin sessions keep Settings,
-- Roles, Modules, Audit Logs, Reports, and SEO until they are unassigned.

INSERT INTO "role_modules" ("role_id", "module_id")
SELECT r."role_id", m."module_id"
FROM "admin_roles" r
CROSS JOIN "admin_modules" m
WHERE r."role_name" = 'super_admin'
  AND m."is_active" = true
  AND m."section_slug" = 'system'
  AND NOT EXISTS (
    SELECT 1
    FROM "role_modules" rm
    WHERE rm."role_id" = r."role_id"
      AND rm."module_id" = m."module_id"
  );

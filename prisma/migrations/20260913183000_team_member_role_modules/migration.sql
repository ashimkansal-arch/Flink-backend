-- Capability modules: Operations · Manage team members · {role}
INSERT INTO "admin_modules" (
  "module_id",
  "name",
  "slug",
  "section_name",
  "section_slug",
  "path",
  "icon",
  "display_order",
  "description",
  "is_active",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  LEFT('Manage team members · ' || r."name", 80),
  LEFT('manage-team-members-' || r."role_name", 80),
  p."section_name",
  p."section_slug",
  LEFT('/manage-team-members/role/' || r."role_name", 120),
  p."icon",
  p."display_order" + 1,
  'See and create ' || r."name" || ' team members',
  true,
  NOW(),
  NOW()
FROM "admin_roles" r
INNER JOIN "admin_modules" p ON p."path" = '/manage-team-members'
WHERE r."role_name" <> 'super_admin'
  AND NOT EXISTS (
    SELECT 1
    FROM "admin_modules" m
    WHERE m."path" = '/manage-team-members/role/' || r."role_name"
  );

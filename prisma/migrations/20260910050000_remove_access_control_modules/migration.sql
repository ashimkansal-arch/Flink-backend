-- Remove Access Control screens from the module catalog. Those pages stay
-- in the CRM; they are not assignable sidebar modules.
-- Idempotent: no-op if the rows were never seeded.

DELETE FROM "admin_modules"
WHERE "path" IN (
  '/access/roles',
  '/access/permissions',
  '/access/teams',
  '/access/scopes',
  '/access/visibility',
  '/access/approval-policies',
  '/access/sla-policies',
  '/access/workflow-policies'
)
OR "slug" IN (
  'access-roles',
  'access-permissions',
  'access-teams',
  'access-scopes',
  'access-visibility',
  'access-approval-policies',
  'access-sla-policies',
  'access-workflow-policies'
);

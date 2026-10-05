-- Workers KYC stays as a CRM page linked from Workers. It is not a
-- sidebar module. Idempotent: no-op if the row was never seeded.

DELETE FROM "admin_modules"
WHERE "path" = '/workers/kyc' OR "slug" = 'workers-kyc';

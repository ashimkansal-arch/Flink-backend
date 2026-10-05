-- Sidebar display order: lower numbers appear first. Sections follow the
-- lowest display_order of their modules (Operations before Catalog, etc.).

ALTER TABLE "admin_modules"
  ADD COLUMN IF NOT EXISTS "display_order" INTEGER NOT NULL DEFAULT 0;

UPDATE "admin_modules" m
SET "display_order" = v.display_order
FROM (VALUES
  ('/', 0),
  ('/manage-team-members', 10),
  ('/admin-users', 10),
  ('/admin-supervisors', 20),
  ('/customers', 30),
  ('/bookings', 40),
  ('/live-orders', 50),
  ('/workers', 60),
  ('/providers', 60),
  ('/providers/offline-requests', 70),
  ('/services', 100),
  ('/sub-services', 110),
  ('/payments', 200),
  ('/revenue', 210),
  ('/wallet', 220),
  ('/geofencing', 300),
  ('/regions', 310),
  ('/cities', 320),
  ('/complaints', 400),
  ('/support', 410),
  ('/reviews', 420),
  ('/coupons', 430),
  ('/notifications', 440),
  ('/settings', 500),
  ('/reports', 510),
  ('/seo', 520),
  ('/admin-roles', 530),
  ('/admin-modules', 540),
  ('/audit-logs', 550),
  ('/legal-support', 560)
) AS v(path, display_order)
WHERE m."path" = v.path;

UPDATE "admin_modules"
SET "display_order" = 1000
WHERE "display_order" = 0
  AND "path" <> '/';

CREATE INDEX IF NOT EXISTS "idx_admin_modules_order"
  ON "admin_modules" ("section_slug", "display_order");

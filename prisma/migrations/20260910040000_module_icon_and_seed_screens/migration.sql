-- Lucide icon name on each module, then seed canonical CRM screens.
-- Idempotent: skips rows that already exist by slug or path, and does not
-- overwrite custom names, sections, or role assignments.

ALTER TABLE "admin_modules"
  ADD COLUMN IF NOT EXISTS "icon" VARCHAR(80);

UPDATE "admin_modules" m
SET "icon" = v.icon
FROM (VALUES
  ('/', 'LayoutDashboard'),
  ('/manage-team-members', 'UserCog'),
  ('/admin-users', 'UserCog'),
  ('/admin-supervisors', 'ClipboardCheck'),
  ('/customers', 'ContactRound'),
  ('/bookings', 'CalendarDays'),
  ('/services', 'Layers'),
  ('/sub-services', 'ListTree'),
  ('/workers', 'Users'),
  ('/workers/kyc', 'ClipboardCheck'),
  ('/providers/offline-requests', 'Clock'),
  ('/settings', 'Settings'),
  ('/live-orders', 'Activity'),
  ('/payments', 'CreditCard'),
  ('/revenue', 'TrendingUp'),
  ('/wallet', 'Wallet'),
  ('/geofencing', 'Map'),
  ('/regions', 'Globe'),
  ('/cities', 'Building2'),
  ('/complaints', 'AlertOctagon'),
  ('/support', 'LifeBuoy'),
  ('/reviews', 'Star'),
  ('/coupons', 'TicketPercent'),
  ('/notifications', 'Bell'),
  ('/reports', 'FileBarChart'),
  ('/seo', 'Search'),
  ('/admin-roles', 'Shield'),
  ('/admin-modules', 'Layers'),
  ('/audit-logs', 'ScrollText')
) AS v(path, icon)
WHERE m."path" = v.path
  AND (m."icon" IS NULL OR m."icon" = '');

UPDATE "admin_modules"
SET "icon" = 'Layers'
WHERE "icon" IS NULL OR "icon" = '';

ALTER TABLE "admin_modules"
  ALTER COLUMN "icon" SET DEFAULT 'Layers',
  ALTER COLUMN "icon" SET NOT NULL;

INSERT INTO "admin_modules" (
  "module_id",
  "name",
  "slug",
  "section_name",
  "section_slug",
  "path",
  "icon",
  "description",
  "is_active",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  v.name,
  v.slug,
  v.section_name,
  v.section_slug,
  v.path,
  v.icon,
  NULL,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (VALUES
  ('Dashboard', 'dashboard', '', '', '/', 'LayoutDashboard'),
  ('Manage team members', 'manage-team-members', 'Operations', 'operations', '/manage-team-members', 'UserCog'),
  ('Supervisors', 'admin-supervisors', 'Operations', 'operations', '/admin-supervisors', 'ClipboardCheck'),
  ('Customers', 'customers', 'Operations', 'operations', '/customers', 'ContactRound'),
  ('Bookings', 'bookings', 'Operations', 'operations', '/bookings', 'CalendarDays'),
  ('Live Orders', 'live-orders', 'Operations', 'operations', '/live-orders', 'Activity'),
  ('Workers', 'workers', 'Operations', 'operations', '/workers', 'Users'),
  ('Workers KYC', 'workers-kyc', 'Operations', 'operations', '/workers/kyc', 'ClipboardCheck'),
  ('Offline requests', 'providers-offline-requests', 'Operations', 'operations', '/providers/offline-requests', 'Clock'),
  ('Services', 'services', 'Catalog', 'catalog', '/services', 'Layers'),
  ('Sub services', 'sub-services', 'Catalog', 'catalog', '/sub-services', 'ListTree'),
  ('Payments', 'payments', 'Finance', 'finance', '/payments', 'CreditCard'),
  ('Revenue', 'revenue', 'Finance', 'finance', '/revenue', 'TrendingUp'),
  ('Wallet', 'wallet', 'Finance', 'finance', '/wallet', 'Wallet'),
  ('GeoFencing', 'geofencing', 'Geo', 'geo', '/geofencing', 'Map'),
  ('Regions', 'regions', 'Geo', 'geo', '/regions', 'Globe'),
  ('Cities', 'cities', 'Geo', 'geo', '/cities', 'Building2'),
  ('Complaints', 'complaints', 'Engagement', 'engagement', '/complaints', 'AlertOctagon'),
  ('Support Tickets', 'support', 'Engagement', 'engagement', '/support', 'LifeBuoy'),
  ('Reviews', 'reviews', 'Engagement', 'engagement', '/reviews', 'Star'),
  ('Coupons', 'coupons', 'Engagement', 'engagement', '/coupons', 'TicketPercent'),
  ('Notifications', 'notifications', 'Engagement', 'engagement', '/notifications', 'Bell'),
  ('Settings', 'settings', 'System', 'system', '/settings', 'Settings'),
  ('Reports', 'reports', 'System', 'system', '/reports', 'FileBarChart'),
  ('SEO & Keywords', 'seo', 'System', 'system', '/seo', 'Search'),
  ('Admin Roles', 'admin-roles', 'System', 'system', '/admin-roles', 'Shield'),
  ('Modules', 'admin-modules', 'System', 'system', '/admin-modules', 'Layers'),
  ('Audit Logs', 'audit-logs', 'System', 'system', '/audit-logs', 'ScrollText')
) AS v(name, slug, section_name, section_slug, path, icon)
WHERE NOT EXISTS (
  SELECT 1
  FROM "admin_modules" m
  WHERE m."slug" = v.slug OR m."path" = v.path
);

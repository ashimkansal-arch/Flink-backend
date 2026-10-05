-- Store the real CRM route on each module so the sidebar never invents URLs.

ALTER TABLE "admin_modules"
  ADD COLUMN IF NOT EXISTS "path" VARCHAR(120);

UPDATE "admin_modules"
SET "path" = CASE "slug"
  WHEN 'dashboard' THEN '/'
  WHEN 'admin-users' THEN '/manage-team-members'
  WHEN 'manage-team' THEN '/manage-team-members'
  WHEN 'manage-team-members' THEN '/manage-team-members'
  WHEN 'team-members' THEN '/manage-team-members'
  WHEN 'admin-supervisors' THEN '/admin-supervisors'
  WHEN 'supervisors' THEN '/admin-supervisors'
  WHEN 'customers' THEN '/customers'
  WHEN 'bookings' THEN '/bookings'
  WHEN 'services' THEN '/services'
  WHEN 'providers' THEN '/providers'
  WHEN 'provider-kyc' THEN '/providers/kyc'
  WHEN 'providers-kyc' THEN '/providers/kyc'
  WHEN 'offline-requests' THEN '/providers/offline-requests'
  WHEN 'providers-offline-requests' THEN '/providers/offline-requests'
  WHEN 'settings' THEN '/settings'
  WHEN 'live-orders' THEN '/live-orders'
  WHEN 'workers' THEN '/workers'
  WHEN 'inventory' THEN '/inventory'
  WHEN 'products' THEN '/products'
  WHEN 'payments' THEN '/payments'
  WHEN 'revenue' THEN '/revenue'
  WHEN 'wallet' THEN '/wallet'
  WHEN 'geofencing' THEN '/geofencing'
  WHEN 'regions' THEN '/regions'
  WHEN 'cities' THEN '/cities'
  WHEN 'complaints' THEN '/complaints'
  WHEN 'support' THEN '/support'
  WHEN 'support-tickets' THEN '/support'
  WHEN 'reviews' THEN '/reviews'
  WHEN 'coupons' THEN '/coupons'
  WHEN 'notifications' THEN '/notifications'
  WHEN 'reports' THEN '/reports'
  WHEN 'seo' THEN '/seo'
  WHEN 'seo-keywords' THEN '/seo'
  WHEN 'admin-roles' THEN '/admin-roles'
  WHEN 'admin-modules' THEN '/admin-modules'
  WHEN 'modules' THEN '/admin-modules'
  WHEN 'audit-logs' THEN '/audit-logs'
  ELSE '/' || "slug"
END
WHERE "path" IS NULL OR "path" = '';

UPDATE "admin_modules" m
SET "path" = m."path" || '-' || replace(m."module_id"::text, '-', '')
WHERE m."module_id" IN (
  SELECT "module_id"
  FROM (
    SELECT "module_id", ROW_NUMBER() OVER (PARTITION BY "path" ORDER BY "created_at") AS rn
    FROM "admin_modules"
  ) d
  WHERE rn > 1
);

ALTER TABLE "admin_modules"
  ALTER COLUMN "path" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "admin_modules_path_key" ON "admin_modules"("path");

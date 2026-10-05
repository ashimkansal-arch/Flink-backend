-- Catalog should only contain Services and Sub services.
-- Fixes misspelled section names (Catalogue / Catalouge / Cataloug),
-- removes Inventory and Products, and seeds Sub services.
-- Idempotent for production.

UPDATE "admin_modules"
SET
  "section_name" = 'Catalog',
  "section_slug" = 'catalog'
WHERE lower("section_name") IN ('catalogue', 'catalouge', 'cataloug', 'catalog')
   OR "path" IN ('/services', '/sub-services')
   OR "slug" IN ('services', 'sub-services');

DELETE FROM "admin_modules"
WHERE "path" IN ('/inventory', '/products')
   OR "slug" IN ('inventory', 'products');

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
  'Sub services',
  'sub-services',
  'Catalog',
  'catalog',
  '/sub-services',
  'ListTree',
  NULL,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1
  FROM "admin_modules" m
  WHERE m."slug" = 'sub-services' OR m."path" = '/sub-services'
);

UPDATE "admin_modules"
SET
  "name" = 'Services',
  "section_name" = 'Catalog',
  "section_slug" = 'catalog'
WHERE "path" = '/services' OR "slug" = 'services';

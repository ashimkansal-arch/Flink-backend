ALTER TABLE "coverage_zones"
  ALTER COLUMN "zone_type" DROP DEFAULT;

DELETE FROM "coverage_zone_types"
WHERE "name" IN ('Service Zone', 'Surge', 'No-Service');

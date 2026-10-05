ALTER TABLE "supervisors" ADD COLUMN "full_name" VARCHAR(120);

UPDATE "supervisors" SET "full_name" = TRIM(BOTH FROM ("first_name" || ' ' || "last_name"))
WHERE "full_name" IS NULL;

ALTER TABLE "supervisors" ALTER COLUMN "full_name" SET NOT NULL;

ALTER TABLE "supervisors" DROP COLUMN "first_name";
ALTER TABLE "supervisors" DROP COLUMN "last_name";

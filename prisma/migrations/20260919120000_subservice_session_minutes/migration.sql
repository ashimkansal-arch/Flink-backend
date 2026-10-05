-- Session length in minutes for sub-services. Parent services stay NULL.

ALTER TABLE "service_categories"
  ADD COLUMN "session_minutes" INTEGER;

ALTER TABLE "service_categories"
  ADD CONSTRAINT "service_categories_session_minutes_check"
  CHECK ("session_minutes" IS NULL OR ("session_minutes" > 0 AND "session_minutes" <= 1440));

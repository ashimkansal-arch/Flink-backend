-- Snapshot job duration and persist the included-task checklist when a session starts.
-- Remaining time is never stored; it is derived from started_at + session_minutes on each read.

ALTER TABLE "bookings"
  ADD COLUMN "session_minutes" INTEGER,
  ADD COLUMN "session_checklist" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_session_minutes_check"
  CHECK ("session_minutes" IS NULL OR ("session_minutes" > 0 AND "session_minutes" <= 1440));

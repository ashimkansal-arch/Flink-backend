-- Customer can mark the session complete or end it early; reviews can store "what went well" tags.

CREATE TYPE "SessionCompletionOutcome" AS ENUM ('completed', 'ended_early');

ALTER TABLE "bookings"
  ADD COLUMN "customer_completed_at" TIMESTAMP(3),
  ADD COLUMN "customer_completion_outcome" "SessionCompletionOutcome",
  ADD COLUMN "completed_by" "ActorType";

ALTER TABLE "reviews_ratings"
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

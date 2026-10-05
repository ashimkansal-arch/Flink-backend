-- Worker completion selfie (required) and optional service photo stored as S3 keys.

ALTER TABLE "bookings"
  ADD COLUMN "completion_selfie_url" TEXT,
  ADD COLUMN "completion_photo_url" TEXT;

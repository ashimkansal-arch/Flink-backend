-- Provider offline requests (approval required before going offline).

CREATE TYPE "OfflineRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

CREATE TABLE "provider_offline_requests" (
  "offline_request_id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider_id" UUID NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "status" "OfflineRequestStatus" NOT NULL DEFAULT 'pending',
  "requested_lat" DOUBLE PRECISION,
  "requested_long" DOUBLE PRECISION,
  "reviewed_by_admin_id" UUID,
  "reviewed_at" TIMESTAMP(3),
  "rejection_reason" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_offline_requests_provider_id_fkey"
    FOREIGN KEY ("provider_id") REFERENCES "service_providers"("provider_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "provider_offline_requests_reviewed_by_admin_id_fkey"
    FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "admin_users"("admin_id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "idx_provider_offline_requests_status"
  ON "provider_offline_requests" ("status", "created_at" DESC);

CREATE INDEX "idx_provider_offline_requests_provider"
  ON "provider_offline_requests" ("provider_id", "status");

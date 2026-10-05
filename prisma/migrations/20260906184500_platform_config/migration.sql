-- Platform ops config (singleton). Defaults: KYC self-upload on, jobs 09:00–20:00.

CREATE TABLE IF NOT EXISTS "platform_config" (
  "id" VARCHAR(32) PRIMARY KEY DEFAULT 'default',
  "provider_kyc_upload_enabled" BOOLEAN NOT NULL DEFAULT true,
  "job_hours_start" VARCHAR(5) NOT NULL DEFAULT '09:00',
  "job_hours_end" VARCHAR(5) NOT NULL DEFAULT '20:00',
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_admin_id" UUID
);

INSERT INTO "platform_config" ("id", "provider_kyc_upload_enabled", "job_hours_start", "job_hours_end", "updated_at")
VALUES ('default', true, '09:00', '20:00', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

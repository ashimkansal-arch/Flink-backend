-- FCM push tokens for customer (users) and provider apps.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "fcm_token" VARCHAR(512);

ALTER TABLE "service_providers"
  ADD COLUMN IF NOT EXISTS "fcm_token" VARCHAR(512);

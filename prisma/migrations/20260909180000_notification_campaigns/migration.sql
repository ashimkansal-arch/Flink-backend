CREATE TABLE IF NOT EXISTS "notification_campaigns" (
  "campaign_id" UUID NOT NULL,
  "title" VARCHAR(80) NOT NULL,
  "body" VARCHAR(240) NOT NULL,
  "category" VARCHAR(20) NOT NULL,
  "tone" VARCHAR(20) NOT NULL,
  "audience" VARCHAR(20) NOT NULL,
  "recipient_count" INTEGER NOT NULL DEFAULT 0,
  "created_by_admin_id" UUID NOT NULL,
  "read_at" TIMESTAMP(3),
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_campaigns_pkey" PRIMARY KEY ("campaign_id")
);

CREATE INDEX IF NOT EXISTS "idx_notification_campaigns_created"
  ON "notification_campaigns"("created_at" DESC);

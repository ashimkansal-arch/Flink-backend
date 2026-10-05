-- Access Control: org teams + policies (Super Admin)

CREATE TYPE "VisibilityLevel" AS ENUM (
  'global',
  'city',
  'team',
  'team_and_children',
  'scope',
  'assigned',
  'custom'
);

CREATE TYPE "PolicyStatus" AS ENUM ('active', 'inactive', 'draft');

CREATE TYPE "OrgTeamStatus" AS ENUM ('active', 'inactive');

CREATE TABLE "org_teams" (
  "team_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "code" VARCHAR(40) NOT NULL,
  "parent_team_id" UUID,
  "city_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "zone_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" "OrgTeamStatus" NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "org_teams_pkey" PRIMARY KEY ("team_id")
);

CREATE UNIQUE INDEX "org_teams_code_key" ON "org_teams"("code");
CREATE INDEX "idx_org_teams_parent" ON "org_teams"("parent_team_id");
CREATE INDEX "idx_org_teams_status" ON "org_teams"("status");

ALTER TABLE "org_teams"
  ADD CONSTRAINT "org_teams_parent_team_id_fkey"
  FOREIGN KEY ("parent_team_id") REFERENCES "org_teams"("team_id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "team_members" (
  "team_member_id" UUID NOT NULL,
  "team_id" UUID NOT NULL,
  "admin_user_id" UUID NOT NULL,
  "is_primary" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "team_members_pkey" PRIMARY KEY ("team_member_id")
);

CREATE UNIQUE INDEX "team_members_team_id_admin_user_id_key" ON "team_members"("team_id", "admin_user_id");
CREATE INDEX "idx_team_members_admin" ON "team_members"("admin_user_id");

ALTER TABLE "team_members"
  ADD CONSTRAINT "team_members_team_id_fkey"
  FOREIGN KEY ("team_id") REFERENCES "org_teams"("team_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "team_members"
  ADD CONSTRAINT "team_members_admin_user_id_fkey"
  FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("admin_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "visibility_policies" (
  "visibility_policy_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "level" "VisibilityLevel" NOT NULL,
  "config" JSONB,
  "status" "PolicyStatus" NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "visibility_policies_pkey" PRIMARY KEY ("visibility_policy_id")
);

CREATE UNIQUE INDEX "visibility_policies_name_key" ON "visibility_policies"("name");
CREATE INDEX "idx_visibility_policies_status" ON "visibility_policies"("status");

CREATE TABLE "approval_policies" (
  "approval_policy_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "action_key" VARCHAR(80) NOT NULL,
  "threshold_paise" BIGINT,
  "approver_role_names" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "escalation_role_names" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "config" JSONB,
  "status" "PolicyStatus" NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "approval_policies_pkey" PRIMARY KEY ("approval_policy_id")
);

CREATE UNIQUE INDEX "approval_policies_name_key" ON "approval_policies"("name");
CREATE INDEX "idx_approval_policies_action" ON "approval_policies"("action_key");
CREATE INDEX "idx_approval_policies_status" ON "approval_policies"("status");

CREATE TABLE "workflow_policies" (
  "workflow_policy_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "steps" JSONB NOT NULL DEFAULT '[]',
  "transitions" JSONB NOT NULL DEFAULT '[]',
  "status" "PolicyStatus" NOT NULL DEFAULT 'draft',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "workflow_policies_pkey" PRIMARY KEY ("workflow_policy_id")
);

CREATE UNIQUE INDEX "workflow_policies_name_key" ON "workflow_policies"("name");
CREATE INDEX "idx_workflow_policies_status" ON "workflow_policies"("status");

CREATE TABLE "sla_policies" (
  "sla_policy_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "metric_key" VARCHAR(80) NOT NULL,
  "target_minutes" INTEGER NOT NULL,
  "escalate_after_minutes" INTEGER,
  "escalation_role_names" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "config" JSONB,
  "status" "PolicyStatus" NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "sla_policies_pkey" PRIMARY KEY ("sla_policy_id")
);

CREATE UNIQUE INDEX "sla_policies_name_key" ON "sla_policies"("name");
CREATE INDEX "idx_sla_policies_metric" ON "sla_policies"("metric_key");
CREATE INDEX "idx_sla_policies_status" ON "sla_policies"("status");

CREATE TABLE "team_policies" (
  "team_policy_id" UUID NOT NULL,
  "team_id" UUID NOT NULL,
  "visibility_policy_id" UUID,
  "approval_policy_id" UUID,
  "workflow_policy_id" UUID,
  "sla_policy_id" UUID,
  "overrides" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "team_policies_pkey" PRIMARY KEY ("team_policy_id")
);

CREATE UNIQUE INDEX "team_policies_team_id_key" ON "team_policies"("team_id");

ALTER TABLE "team_policies"
  ADD CONSTRAINT "team_policies_team_id_fkey"
  FOREIGN KEY ("team_id") REFERENCES "org_teams"("team_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "team_policies"
  ADD CONSTRAINT "team_policies_visibility_policy_id_fkey"
  FOREIGN KEY ("visibility_policy_id") REFERENCES "visibility_policies"("visibility_policy_id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "team_policies"
  ADD CONSTRAINT "team_policies_approval_policy_id_fkey"
  FOREIGN KEY ("approval_policy_id") REFERENCES "approval_policies"("approval_policy_id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "team_policies"
  ADD CONSTRAINT "team_policies_workflow_policy_id_fkey"
  FOREIGN KEY ("workflow_policy_id") REFERENCES "workflow_policies"("workflow_policy_id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "team_policies"
  ADD CONSTRAINT "team_policies_sla_policy_id_fkey"
  FOREIGN KEY ("sla_policy_id") REFERENCES "sla_policies"("sla_policy_id")
  ON DELETE SET NULL ON UPDATE CASCADE;

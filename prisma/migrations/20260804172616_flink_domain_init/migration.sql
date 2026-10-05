-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'blocked', 'deleted');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('customer');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female', 'other');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('login', 'signup', 'provider_login');

-- CreateEnum
CREATE TYPE "HomeType" AS ENUM ('apartment', 'independent_house', 'villa', 'studio');

-- CreateEnum
CREATE TYPE "HomeSize" AS ENUM ('1bhk', '2bhk', '3bhk', '4bhk_plus');

-- CreateEnum
CREATE TYPE "PetType" AS ENUM ('dog', 'cat', 'bird', 'fish', 'other');

-- CreateEnum
CREATE TYPE "ProviderOnboardingStatus" AS ENUM ('registered', 'profile_complete', 'docs_submitted', 'background_check', 'training', 'active', 'rejected', 'suspended');

-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('active', 'inactive', 'suspended');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('id_proof', 'address_proof', 'certification', 'bank_proof');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "ServicePlanTier" AS ENUM ('basic', 'standard', 'premium');

-- CreateEnum
CREATE TYPE "BookingType" AS ENUM ('instant', 'scheduled');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('draft', 'confirmed', 'searching', 'assigned', 'no_provider', 'en_route', 'in_progress', 'completed', 'disputed', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('customer', 'provider', 'admin', 'system');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('offered', 'accepted', 'declined', 'expired', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('card', 'upi', 'wallet', 'netbanking');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'captured', 'failed', 'refunded', 'partially_refunded');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('pending', 'processed', 'rejected');

-- CreateEnum
CREATE TYPE "WalletTxnType" AS ENUM ('credit', 'debit');

-- CreateEnum
CREATE TYPE "WalletTxnSource" AS ENUM ('referral', 'refund', 'support_credit', 'booking_payment', 'topup');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('pending', 'credited', 'expired');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('pending', 'processed', 'failed');

-- CreateEnum
CREATE TYPE "PayoutBatchStatus" AS ENUM ('draft', 'approved', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "AdminUserStatus" AS ENUM ('pending', 'active', 'disabled');

-- CreateEnum
CREATE TYPE "RecipientType" AS ENUM ('customer', 'provider', 'admin');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('push', 'sms', 'email', 'in_app');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('queued', 'sent', 'failed', 'read');

-- CreateTable
CREATE TABLE "users" (
    "user_id" UUID NOT NULL,
    "phone_number" VARCHAR(15) NOT NULL,
    "full_name" VARCHAR(120),
    "gender" "Gender",
    "email" VARCHAR(160),
    "role" "UserRole" NOT NULL DEFAULT 'customer',
    "is_phone_verified" BOOLEAN NOT NULL DEFAULT false,
    "profile_image_url" TEXT,
    "referral_code" VARCHAR(12),
    "referred_by_code" VARCHAR(12),
    "wallet_balance_paise" BIGINT NOT NULL DEFAULT 0,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "otp_verifications" (
    "otp_id" UUID NOT NULL,
    "phone_number" VARCHAR(15) NOT NULL,
    "otp_code_hash" VARCHAR(255) NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "is_used" BOOLEAN NOT NULL DEFAULT false,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_verifications_pkey" PRIMARY KEY ("otp_id")
);

-- CreateTable
CREATE TABLE "home_profiles" (
    "home_profile_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "home_type" "HomeType",
    "home_size" "HomeSize",
    "floor_number" INTEGER,
    "adults_count" INTEGER NOT NULL DEFAULT 0,
    "children_count" INTEGER NOT NULL DEFAULT 0,
    "seniors_count" INTEGER NOT NULL DEFAULT 0,
    "has_female_member" BOOLEAN NOT NULL DEFAULT true,
    "live_selfie_url" TEXT,
    "has_pets" BOOLEAN NOT NULL DEFAULT false,
    "pet_type" "PetType",
    "pet_count" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "home_profiles_pkey" PRIMARY KEY ("home_profile_id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "address_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "label" VARCHAR(30) DEFAULT 'Home',
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" VARCHAR(80),
    "pincode" VARCHAR(10),
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_serviceable" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("address_id")
);

-- CreateTable
CREATE TABLE "service_providers" (
    "provider_id" UUID NOT NULL,
    "phone_number" VARCHAR(15) NOT NULL,
    "full_name" VARCHAR(120) NOT NULL,
    "gender" "Gender",
    "email" VARCHAR(160),
    "profile_photo_url" TEXT,
    "bio" TEXT,
    "onboarding_status" "ProviderOnboardingStatus" NOT NULL DEFAULT 'registered',
    "rejection_reason" TEXT,
    "service_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "coverage_zone_id" UUID,
    "current_latitude" DOUBLE PRECISION,
    "current_longitude" DOUBLE PRECISION,
    "location_updated_at" TIMESTAMP(3),
    "avg_rating" DECIMAL(3,2) NOT NULL DEFAULT 5.00,
    "total_jobs_completed" INTEGER NOT NULL DEFAULT 0,
    "acceptance_rate" DECIMAL(5,2) NOT NULL DEFAULT 100.00,
    "is_available" BOOLEAN NOT NULL DEFAULT false,
    "stripe_connect_account_id" VARCHAR(120),
    "bank_account_last4" VARCHAR(4),
    "status" "ProviderStatus" NOT NULL DEFAULT 'inactive',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_providers_pkey" PRIMARY KEY ("provider_id")
);

-- CreateTable
CREATE TABLE "provider_documents" (
    "document_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "s3_key" TEXT NOT NULL,
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_documents_pkey" PRIMARY KEY ("document_id")
);

-- CreateTable
CREATE TABLE "provider_availability" (
    "availability_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_time" TIME NOT NULL,
    "end_time" TIME NOT NULL,
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "blocked_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_availability_pkey" PRIMARY KEY ("availability_id"),
    -- Hand-edited: no Prisma schema DSL for numeric CHECK constraints.
    CONSTRAINT "provider_availability_day_of_week_check" CHECK ("day_of_week" BETWEEN 0 AND 6)
);

-- CreateTable
CREATE TABLE "provider_training_modules" (
    "module_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "module_name" VARCHAR(80) NOT NULL,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "provider_training_modules_pkey" PRIMARY KEY ("module_id")
);

-- CreateTable
CREATE TABLE "coverage_zones" (
    "zone_id" UUID NOT NULL,
    "zone_name" VARCHAR(80) NOT NULL,
    "city" VARCHAR(80),
    "polygon_geojson" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "launched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coverage_zones_pkey" PRIMARY KEY ("zone_id")
);

-- CreateTable
CREATE TABLE "service_categories" (
    "category_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "icon_url" TEXT,
    "included_tasks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excluded_tasks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("category_id")
);

-- CreateTable
CREATE TABLE "service_plans" (
    "plan_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "tier_name" "ServicePlanTier" NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "price_paise" BIGINT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "service_plans_pkey" PRIMARY KEY ("plan_id")
);

-- CreateTable
CREATE TABLE "service_addons" (
    "addon_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "price_paise" BIGINT NOT NULL,
    "requires_text_input" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "service_addons_pkey" PRIMARY KEY ("addon_id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "booking_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "address_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "addon_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "addon_notes" TEXT,
    "booking_type" "BookingType" NOT NULL,
    "scheduled_date" DATE,
    "scheduled_start_time" TIME,
    "status" "BookingStatus" NOT NULL DEFAULT 'draft',
    "session_otp_hash" VARCHAR(255),
    "base_price_paise" BIGINT NOT NULL,
    "addon_price_paise" BIGINT NOT NULL DEFAULT 0,
    "overtime_rate_paise" INTEGER NOT NULL DEFAULT 200,
    "overtime_minutes" INTEGER NOT NULL DEFAULT 0,
    "total_price_paise" BIGINT NOT NULL,
    "cancellation_fee_paise" BIGINT DEFAULT 0,
    "cancelled_by" "ActorType",
    "cancellation_reason" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "sla_deadline_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("booking_id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "assignment_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "offer_sequence" INTEGER NOT NULL DEFAULT 1,
    "offer_score" DECIMAL(6,2),
    "status" "AssignmentStatus" NOT NULL DEFAULT 'offered',
    "offered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("assignment_id")
);

-- CreateTable
CREATE TABLE "booking_tracking_events" (
    "event_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "provider_id" UUID,
    "event_type" VARCHAR(24) NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_tracking_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "reviews_ratings" (
    "review_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_ratings_pkey" PRIMARY KEY ("review_id"),
    -- Hand-edited: no Prisma schema DSL for numeric CHECK constraints.
    CONSTRAINT "reviews_ratings_rating_check" CHECK ("rating" BETWEEN 1 AND 5)
);

-- CreateTable
CREATE TABLE "payments" (
    "payment_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "stripe_payment_intent_id" VARCHAR(120),
    "amount_paise" BIGINT NOT NULL,
    "platform_fee_paise" BIGINT NOT NULL,
    "provider_payout_paise" BIGINT NOT NULL,
    "payment_method" "PaymentMethod",
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "captured_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("payment_id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "refund_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "reason" TEXT,
    "approved_by" UUID,
    "status" "RefundStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("refund_id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "wallet_txn_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "WalletTxnType" NOT NULL,
    "source" "WalletTxnSource" NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "balance_after_paise" BIGINT NOT NULL,
    "reference_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("wallet_txn_id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "referral_id" UUID NOT NULL,
    "referrer_user_id" UUID NOT NULL,
    "referred_user_id" UUID,
    "referral_code" VARCHAR(12) NOT NULL,
    "bonus_paise" BIGINT NOT NULL DEFAULT 15000,
    "status" "ReferralStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("referral_id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "payout_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "stripe_transfer_id" VARCHAR(120),
    "amount_paise" BIGINT NOT NULL,
    "batch_id" UUID,
    "status" "PayoutStatus" NOT NULL DEFAULT 'pending',
    "period_start" DATE,
    "period_end" DATE,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("payout_id")
);

-- CreateTable
CREATE TABLE "payout_batches" (
    "batch_id" UUID NOT NULL,
    "scheduled_for" DATE NOT NULL,
    "total_amount_paise" BIGINT NOT NULL DEFAULT 0,
    "provider_count" INTEGER NOT NULL DEFAULT 0,
    "status" "PayoutBatchStatus" NOT NULL DEFAULT 'draft',
    "approved_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_batches_pkey" PRIMARY KEY ("batch_id")
);

-- CreateTable
CREATE TABLE "admin_roles" (
    "role_id" UUID NOT NULL,
    "role_name" VARCHAR(40) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_roles_pkey" PRIMARY KEY ("role_id")
);

-- CreateTable
CREATE TABLE "admin_permissions" (
    "permission_id" UUID NOT NULL,
    "permission_key" VARCHAR(60) NOT NULL,
    "description" TEXT,

    CONSTRAINT "admin_permissions_pkey" PRIMARY KEY ("permission_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "admin_id" UUID NOT NULL,
    "email" VARCHAR(160) NOT NULL,
    "full_name" VARCHAR(120),
    "password_hash" VARCHAR(255),
    "role_id" UUID NOT NULL,
    "status" "AdminUserStatus" NOT NULL DEFAULT 'pending',
    "invited_by" UUID,
    "invite_token_hash" VARCHAR(255),
    "invite_expires_at" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("admin_id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "audit_id" UUID NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(80) NOT NULL,
    "entity_type" VARCHAR(40),
    "entity_id" UUID,
    "metadata" JSONB,
    "ip_address" VARCHAR(45),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("audit_id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "notification_id" UUID NOT NULL,
    "recipient_type" "RecipientType" NOT NULL,
    "recipient_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "template_key" VARCHAR(60) NOT NULL,
    "payload" JSONB,
    "status" "NotificationStatus" NOT NULL DEFAULT 'queued',
    "sent_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("notification_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_number_key" ON "users"("phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");

-- CreateIndex
CREATE INDEX "idx_otp_phone_purpose" ON "otp_verifications"("phone_number", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "home_profiles_user_id_key" ON "home_profiles"("user_id");

-- CreateIndex
CREATE INDEX "idx_addresses_user" ON "addresses"("user_id");

-- CreateIndex
CREATE INDEX "idx_addresses_geo" ON "addresses"("latitude", "longitude");

-- CreateIndex
CREATE UNIQUE INDEX "service_providers_phone_number_key" ON "service_providers"("phone_number");

-- CreateIndex
CREATE INDEX "idx_providers_status" ON "service_providers"("onboarding_status", "status");

-- CreateIndex
CREATE INDEX "idx_providers_geo" ON "service_providers"("current_latitude", "current_longitude");

-- CreateIndex
CREATE INDEX "idx_providers_zone" ON "service_providers"("coverage_zone_id");

-- CreateIndex
CREATE INDEX "idx_provider_docs_provider" ON "provider_documents"("provider_id");

-- CreateIndex
CREATE INDEX "idx_provider_availability_provider" ON "provider_availability"("provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_categories_slug_key" ON "service_categories"("slug");

-- CreateIndex
CREATE INDEX "idx_service_plans_category" ON "service_plans"("category_id");

-- CreateIndex
CREATE INDEX "idx_bookings_customer" ON "bookings"("customer_id");

-- CreateIndex
CREATE INDEX "idx_bookings_status" ON "bookings"("status");

-- CreateIndex
CREATE INDEX "idx_bookings_sla" ON "bookings"("sla_deadline_at");

-- CreateIndex
CREATE INDEX "idx_assignments_booking" ON "assignments"("booking_id");

-- CreateIndex
CREATE INDEX "idx_assignments_provider" ON "assignments"("provider_id");

-- Hand-edited (not expressible in schema.prisma): only one 'accepted' assignment per booking,
-- but multiple non-accepted ones are allowed (offer-fallback flow). A plain @@unique([bookingId])
-- would incorrectly forbid the fallback offers.
CREATE UNIQUE INDEX "idx_assignments_active" ON "assignments"("booking_id") WHERE "status" = 'accepted';

-- CreateIndex
CREATE INDEX "idx_tracking_booking" ON "booking_tracking_events"("booking_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_ratings_booking_id_key" ON "reviews_ratings"("booking_id");

-- CreateIndex
CREATE INDEX "idx_reviews_provider" ON "reviews_ratings"("provider_id");

-- CreateIndex
CREATE INDEX "idx_payments_booking" ON "payments"("booking_id");

-- CreateIndex
CREATE INDEX "idx_payments_customer" ON "payments"("customer_id");

-- CreateIndex
CREATE INDEX "idx_wallet_txn_user" ON "wallet_transactions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_payouts_provider" ON "payouts"("provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_roles_role_name_key" ON "admin_roles"("role_name");

-- CreateIndex
CREATE UNIQUE INDEX "admin_permissions_permission_key_key" ON "admin_permissions"("permission_key");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "idx_admin_users_role" ON "admin_users"("role_id");

-- CreateIndex
CREATE INDEX "idx_audit_entity" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idx_audit_actor" ON "audit_logs"("actor_type", "actor_id");

-- CreateIndex
CREATE INDEX "idx_notifications_recipient" ON "notifications"("recipient_type", "recipient_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "home_profiles" ADD CONSTRAINT "home_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_providers" ADD CONSTRAINT "service_providers_coverage_zone_id_fkey" FOREIGN KEY ("coverage_zone_id") REFERENCES "coverage_zones"("zone_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_documents" ADD CONSTRAINT "provider_documents_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "service_providers"("provider_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_documents" ADD CONSTRAINT "provider_documents_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "admin_users"("admin_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_availability" ADD CONSTRAINT "provider_availability_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "service_providers"("provider_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_training_modules" ADD CONSTRAINT "provider_training_modules_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "service_providers"("provider_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_plans" ADD CONSTRAINT "service_plans_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("category_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_addons" ADD CONSTRAINT "service_addons_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("category_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "addresses"("address_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("category_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "service_plans"("plan_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("booking_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "service_providers"("provider_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_tracking_events" ADD CONSTRAINT "booking_tracking_events_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("booking_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_tracking_events" ADD CONSTRAINT "booking_tracking_events_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "service_providers"("provider_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews_ratings" ADD CONSTRAINT "reviews_ratings_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("booking_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews_ratings" ADD CONSTRAINT "reviews_ratings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews_ratings" ADD CONSTRAINT "reviews_ratings_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "service_providers"("provider_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("booking_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("payment_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "admin_users"("admin_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_user_id_fkey" FOREIGN KEY ("referrer_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_user_id_fkey" FOREIGN KEY ("referred_user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "service_providers"("provider_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "payout_batches"("batch_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "admin_users"("admin_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "admin_roles"("role_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "admin_permissions"("permission_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "admin_roles"("role_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "admin_users"("admin_id") ON DELETE SET NULL ON UPDATE CASCADE;

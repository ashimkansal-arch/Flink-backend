-- AlterTable
ALTER TABLE "bookings" ADD COLUMN "session_otp" VARCHAR(4);
ALTER TABLE "bookings" ADD COLUMN "coupon_code" VARCHAR(20);
ALTER TABLE "bookings" ADD COLUMN "discount_paise" BIGINT NOT NULL DEFAULT 0;

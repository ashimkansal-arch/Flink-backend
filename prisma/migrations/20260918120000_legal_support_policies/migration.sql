-- Legal & Support: refund, cancellation, and pricing copy.
ALTER TABLE "legal_support_content"
  ADD COLUMN "refund_policy" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "cancellation_policy" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "pricing_and_payment" TEXT NOT NULL DEFAULT '';

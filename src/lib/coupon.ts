export function normalizeCouponCode(code: string) {
  const normalized = code.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9]{3,20}$/.test(normalized)) throw new Error("INVALID_CODE");
  return normalized;
}

function startOfUtcDay(value: Date) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

export function couponRejection(coupon: {
  isActive: boolean;
  expiresAt: Date;
  maxUses: number;
  usedCount: number;
}): "COUPON_INACTIVE" | "COUPON_EXPIRED" | "COUPON_EXHAUSTED" | null {
  if (!coupon.isActive) return "COUPON_INACTIVE";
  if (startOfUtcDay(coupon.expiresAt) < startOfUtcDay(new Date())) return "COUPON_EXPIRED";
  if (coupon.usedCount >= coupon.maxUses) return "COUPON_EXHAUSTED";
  return null;
}

export function couponDiscountPaise(
  coupon: {
    discountType: "percent" | "flat";
    percentOff: number | null;
    amountOffPaise: bigint | null;
  },
  pricePaise: number,
) {
  if (coupon.discountType === "percent") {
    const percent = coupon.percentOff ?? 0;
    return Math.min(pricePaise, Math.floor((pricePaise * percent) / 100));
  }
  const amount = coupon.amountOffPaise == null ? 0 : Number(coupon.amountOffPaise);
  return Math.min(pricePaise, amount);
}

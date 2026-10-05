import { couponRepository } from "../repositories/coupon-repository";
import { couponDiscountPaise, couponRejection, normalizeCouponCode } from "../lib/coupon";
import { paise } from "../lib/money";

async function quote(code: string, pricePaise: number) {
  const coupon = await couponRepository.findByCode(normalizeCouponCode(code));
  if (!coupon) throw new Error("COUPON_NOT_FOUND");
  const rejection = couponRejection(coupon);
  if (rejection) throw new Error(rejection);
  const discountPaise = couponDiscountPaise(coupon, pricePaise);
  if (discountPaise < 1) throw new Error("COUPON_NOT_APPLICABLE");
  return { coupon, discountPaise };
}

export const customerCouponService = {
  async apply(code: string, pricePaise: number) {
    const { coupon, discountPaise } = await quote(code, pricePaise);
    return {
      code: coupon.code,
      description: coupon.description,
      discountType: coupon.discountType,
      percentOff: coupon.percentOff,
      amountOffPaise: coupon.amountOffPaise == null ? null : paise(coupon.amountOffPaise),
      pricePaise,
      discountPaise,
      updatedPricePaise: pricePaise - discountPaise,
    };
  },

  quote,
};

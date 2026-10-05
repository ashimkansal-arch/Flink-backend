import { db, readDb } from "../lib/prisma";
import type { Prisma } from "../generated/prisma/client";
import type { CouponDiscountType } from "../generated/prisma/enums";
import { searchTerm } from "../lib/search";

const couponSelect = {
  id: true,
  code: true,
  description: true,
  discountType: true,
  percentOff: true,
  amountOffPaise: true,
  maxUses: true,
  usedCount: true,
  isActive: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

function listWhere(q?: string): Prisma.CouponWhereInput {
  const term = searchTerm(q);
  if (!term) return {};
  return {
    OR: [
      { code: { contains: term, mode: "insensitive" } },
      { description: { contains: term, mode: "insensitive" } },
    ],
  };
}

export const couponRepository = {
  list(page: { skip: number; take: number }, q?: string) {
    const where = listWhere(q);
    return Promise.all([
      readDb.coupon.findMany({
        where,
        select: couponSelect,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
      }),
      readDb.coupon.count({ where }),
      readDb.coupon.count(),
      readDb.coupon.count({ where: { isActive: true } }),
    ]);
  },

  findById(id: string) {
    return readDb.coupon.findUnique({ where: { id }, select: couponSelect });
  },

  findByCode(code: string) {
    return readDb.coupon.findUnique({ where: { code }, select: couponSelect });
  },

  create(data: {
    code: string;
    description: string;
    discountType: CouponDiscountType;
    percentOff?: number | null;
    amountOffPaise?: bigint | null;
    maxUses: number;
    isActive: boolean;
    expiresAt: Date;
  }) {
    return db.coupon.create({ data, select: couponSelect });
  },

  update(
    id: string,
    data: {
      code?: string;
      description?: string;
      discountType?: CouponDiscountType;
      percentOff?: number | null;
      amountOffPaise?: bigint | null;
      maxUses?: number;
      isActive?: boolean;
      expiresAt?: Date;
    },
  ) {
    return db.coupon.update({ where: { id }, data, select: couponSelect });
  },

  delete(id: string) {
    return db.coupon.delete({ where: { id } });
  },

  consumeUse(id: string, maxUses: number, tx: Prisma.TransactionClient = db) {
    return tx.coupon.updateMany({
      where: { id, isActive: true, usedCount: { lt: maxUses } },
      data: { usedCount: { increment: 1 } },
    });
  },
};

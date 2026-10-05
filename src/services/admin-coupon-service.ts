import { couponRepository } from "../repositories/coupon-repository";
import { paginatedResult, paginationSkip, type SearchQuery } from "../lib/pagination";
import { paise } from "../lib/money";
import { normalizeCouponCode } from "../lib/coupon";
import type { CouponDiscountType } from "../generated/prisma/enums";

type CouponRow = NonNullable<Awaited<ReturnType<typeof couponRepository.findById>>>;

function toCouponDto(row: CouponRow) {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    discountType: row.discountType,
    percentOff: row.percentOff,
    amountOffPaise: row.amountOffPaise == null ? null : paise(row.amountOffPaise),
    maxUses: row.maxUses,
    usedCount: row.usedCount,
    isActive: row.isActive,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseExpiresAt(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("INVALID_EXPIRY");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("INVALID_EXPIRY");
  return date;
}

function discountFields(input: {
  discountType: CouponDiscountType;
  percentOff?: number | null;
  amountOffPaise?: number | null;
}) {
  if (input.discountType === "percent") {
    const percentOff = input.percentOff ?? 0;
    if (!Number.isInteger(percentOff) || percentOff < 1 || percentOff > 100) {
      throw new Error("INVALID_PERCENT");
    }
    return { discountType: "percent" as const, percentOff, amountOffPaise: null };
  }
  const amountOffPaise = input.amountOffPaise ?? 0;
  if (!Number.isInteger(amountOffPaise) || amountOffPaise < 100) {
    throw new Error("INVALID_AMOUNT");
  }
  return { discountType: "flat" as const, percentOff: null, amountOffPaise: BigInt(amountOffPaise) };
}

async function requireCoupon(id: string) {
  const row = await couponRepository.findById(id);
  if (!row) throw new Error("COUPON_NOT_FOUND");
  return row;
}

async function assertCodeAvailable(code: string, exceptId?: string) {
  const existing = await couponRepository.findByCode(code);
  if (existing && existing.id !== exceptId) throw new Error("CODE_TAKEN");
}

export type CouponWriteInput = {
  code?: string;
  description?: string;
  discountType?: CouponDiscountType;
  percentOff?: number | null;
  amountOffPaise?: number | null;
  maxUses?: number;
  isActive?: boolean;
  expiresAt?: string;
};

export const adminCouponService = {
  async list(query: SearchQuery) {
    const [rows, filteredTotal, total, active] = await couponRepository.list(
      paginationSkip(query),
      query.q,
    );
    return {
      ...paginatedResult(rows.map(toCouponDto), filteredTotal, query),
      stats: { active, total },
    };
  },

  async getById(id: string) {
    return toCouponDto(await requireCoupon(id));
  },

  async create(input: {
    code: string;
    description: string;
    discountType: CouponDiscountType;
    percentOff?: number | null;
    amountOffPaise?: number | null;
    maxUses: number;
    isActive?: boolean;
    expiresAt: string;
  }) {
    const code = normalizeCouponCode(input.code);
    await assertCodeAvailable(code);
    if (input.maxUses < 1) throw new Error("INVALID_MAX_USES");
    const discount = discountFields(input);
    const row = await couponRepository.create({
      code,
      description: input.description.trim(),
      ...discount,
      maxUses: input.maxUses,
      isActive: input.isActive ?? true,
      expiresAt: parseExpiresAt(input.expiresAt),
    });
    return toCouponDto(row);
  },

  async update(id: string, input: CouponWriteInput) {
    const current = await requireCoupon(id);
    const code = input.code === undefined ? undefined : normalizeCouponCode(input.code);
    if (code) await assertCodeAvailable(code, id);
    if (input.maxUses !== undefined && input.maxUses < 1) throw new Error("INVALID_MAX_USES");
    const nextType = input.discountType ?? current.discountType;
    const discount =
      input.discountType !== undefined ||
      input.percentOff !== undefined ||
      input.amountOffPaise !== undefined
        ? discountFields({
            discountType: nextType,
            percentOff: input.percentOff ?? current.percentOff,
            amountOffPaise:
              input.amountOffPaise ??
              (current.amountOffPaise == null ? null : Number(current.amountOffPaise)),
          })
        : undefined;
    const row = await couponRepository.update(id, {
      code,
      description: input.description?.trim(),
      ...discount,
      maxUses: input.maxUses,
      isActive: input.isActive,
      expiresAt: input.expiresAt ? parseExpiresAt(input.expiresAt) : undefined,
    });
    return toCouponDto(row);
  },

  async remove(id: string) {
    await requireCoupon(id);
    await couponRepository.delete(id);
  },
};

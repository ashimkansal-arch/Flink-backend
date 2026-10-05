import { db, readDb } from "../lib/prisma";
import type { Prisma } from "../generated/prisma/client";

export const customerAddressSelect = {
  id: true,
  label: true,
  line1: true,
  line2: true,
  city: true,
  state: true,
  pincode: true,
  formattedAddress: true,
  latitude: true,
  longitude: true,
  isDefault: true,
  isServiceable: true,
  createdAt: true,
} as const;

export const defaultAddressOrder = [
  { isDefault: "desc" as const },
  { createdAt: "asc" as const },
] satisfies Prisma.AddressOrderByWithRelationInput[];

export interface CustomerAddressFields {
  label: string;
  line1: string;
  line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  formattedAddress?: string;
  latitude: number;
  longitude: number;
  isServiceable: boolean;
}

export const addressRepository = {
  findOwned(id: string, userId: string) {
    return readDb.address.findFirst({
      where: { id, userId },
      select: customerAddressSelect,
    });
  },

  findByUser(userId: string) {
    return readDb.address.findMany({
      where: { userId },
      orderBy: defaultAddressOrder,
      select: customerAddressSelect,
    });
  },

  async createForUser(userId: string, data: CustomerAddressFields) {
    const isFirst = (await readDb.address.count({ where: { userId } })) === 0;
    return db.address.create({
      data: { userId, ...data, isDefault: isFirst },
      select: customerAddressSelect,
    });
  },

  async updateOwned(id: string, userId: string, data: CustomerAddressFields) {
    const existing = await this.findOwned(id, userId);
    if (!existing) return null;
    return db.address.update({
      where: { id },
      data,
      select: customerAddressSelect,
    });
  },

  setDefault(userId: string, addressId: string) {
    return db.$transaction(async (tx) => {
      const address = await tx.address.findFirst({
        where: { id: addressId, userId },
        select: { id: true },
      });
      if (!address) return null;
      await tx.address.updateMany({
        where: { userId, NOT: { id: addressId } },
        data: { isDefault: false },
      });
      return tx.address.update({
        where: { id: addressId },
        data: { isDefault: true },
        select: customerAddressSelect,
      });
    });
  },
};

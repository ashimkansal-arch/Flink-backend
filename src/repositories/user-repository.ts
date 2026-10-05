import { db, readDb } from "../lib/prisma";
import type { Prisma, UserStatus } from "../generated/prisma/client";
import { applyNameEmailPhoneSearch } from "../lib/search";
import { customerAddressSelect, defaultAddressOrder } from "./address-repository";

const adminCustomerSelect = {
  id: true,
  phoneNumber: true,
  fullName: true,
  email: true,
  gender: true,
  isPhoneVerified: true,
  walletBalancePaise: true,
  status: true,
  referralCode: true,
  createdAt: true,
  updatedAt: true,
  addresses: {
    orderBy: defaultAddressOrder,
    take: 1,
    select: { city: true, label: true },
  },
  _count: { select: { bookings: true } },
} satisfies Prisma.UserSelect;

export type AdminCustomerRow = Prisma.UserGetPayload<{ select: typeof adminCustomerSelect }>;

export const userRepository = {
  findByPhone(phoneNumber: string) {
    return readDb.user.findUnique({ where: { phoneNumber } });
  },

  findById(id: string) {
    return readDb.user.findUnique({ where: { id } });
  },

  customerListWhere(filters?: { q?: string; status?: UserStatus[]; isPhoneVerified?: boolean }) {
    const baseWhere: Prisma.UserWhereInput = {
      role: "customer",
      status: { not: "deleted" },
    };
    const where = applyNameEmailPhoneSearch<Prisma.UserWhereInput>(baseWhere, filters?.q);
    if (filters?.status?.length) {
      where.status = { in: filters.status };
    }
    if (filters?.isPhoneVerified !== undefined) {
      where.isPhoneVerified = filters.isPhoneVerified;
    }
    return where;
  },

  listCustomers(
    page: { skip: number; take: number },
    filters?: { q?: string; status?: UserStatus[]; isPhoneVerified?: boolean },
  ) {
    const where = this.customerListWhere(filters);

    return Promise.all([
      readDb.user.findMany({
        where,
        select: adminCustomerSelect,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
      }),
      readDb.user.count({ where }),
    ]);
  },

  async countCustomerStats() {
    const baseWhere: Prisma.UserWhereInput = {
      role: "customer",
      status: { not: "deleted" },
    };
    const [byStatus, verified] = await Promise.all([
      readDb.user.groupBy({
        by: ["status"],
        where: baseWhere,
        _count: { _all: true },
      }),
      readDb.user.count({ where: { ...baseWhere, isPhoneVerified: true } }),
    ]);
    const countFor = (status: UserStatus) =>
      byStatus.find((row) => row.status === status)?._count._all ?? 0;
    const active = countFor("active");
    const blocked = countFor("blocked");
    return { total: active + blocked, active, blocked, verified };
  },

  listCustomerMapPoints(filters?: { q?: string; status?: UserStatus[]; isPhoneVerified?: boolean }) {
    return readDb.user.findMany({
      where: this.customerListWhere(filters),
      select: {
        id: true,
        fullName: true,
        phoneNumber: true,
        status: true,
        addresses: {
          orderBy: defaultAddressOrder,
          take: 1,
          select: { latitude: true, longitude: true },
        },
      },
      take: 1000,
    });
  },

  findCustomerById(id: string) {
    return readDb.user.findFirst({
      where: { id, role: "customer", status: { not: "deleted" } },
      select: adminCustomerSelect,
    });
  },

  create(data: { phoneNumber: string; referralCode: string; referredByCode?: string }) {
    return db.user.create({
      data: {
        phoneNumber: data.phoneNumber,
        referralCode: data.referralCode,
        referredByCode: data.referredByCode,
        isPhoneVerified: true,
      },
    });
  },

  updateStatus(id: string, status: Extract<UserStatus, "active" | "blocked">) {
    return db.user.update({
      where: { id },
      data: { status },
      select: adminCustomerSelect,
    });
  },

  softDelete(id: string) {
    return db.user.update({
      where: { id },
      data: {
        status: "deleted",
        deletedAt: new Date(),
      },
    });
  },

  updateProfileImageUrl(id: string, profileImageUrl: string) {
    return db.user.update({
      where: { id },
      data: { profileImageUrl },
      select: { profileImageUrl: true },
    });
  },

  updateProfileDetails(
    id: string,
    data: { fullName: string; email: string; gender: "male" | "female" | "other" },
  ) {
    return db.user.update({
      where: { id },
      data: {
        fullName: data.fullName,
        email: data.email,
        gender: data.gender,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        gender: true,
        phoneNumber: true,
        updatedAt: true,
      },
    });
  },

  updateFcmToken(id: string, fcmToken: string | null) {
    return db.user.update({
      where: { id },
      data: { fcmToken },
      select: { id: true, fcmToken: true },
    });
  },

  findProfileById(id: string) {
    return readDb.user.findUnique({
      where: { id },
      select: {
        id: true,
        phoneNumber: true,
        fullName: true,
        gender: true,
        email: true,
        isPhoneVerified: true,
        profileImageUrl: true,
        referralCode: true,
        walletBalancePaise: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        homeProfile: {
          select: {
            id: true,
            homeType: true,
            homeSize: true,
            floorNumber: true,
            adultsCount: true,
            childrenCount: true,
            seniorsCount: true,
            hasFemaleMember: true,
            liveSelfieUrl: true,
            hasPets: true,
            petType: true,
            petCount: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        addresses: {
          orderBy: defaultAddressOrder,
          take: 1,
          select: customerAddressSelect,
        },
        _count: { select: { bookings: true } },
      },
    });
  },

  listActiveCustomerIds() {
    return readDb.user.findMany({
      where: { role: "customer", status: "active" },
      select: { id: true },
    });
  },
};

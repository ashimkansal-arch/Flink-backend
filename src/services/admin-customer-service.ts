import { userRepository, type AdminCustomerRow } from "../repositories/user-repository";
import {
  paginatedResult,
  paginationSkip,
  type CustomerListQuery,
} from "../lib/pagination";
import { paise } from "../lib/money";
import { refreshTokenStore } from "../lib/auth/refresh-token-store";
import type { UserStatus } from "../generated/prisma/client";

function toCustomerAdminDto(row: AdminCustomerRow) {
  const address = row.addresses[0];
  return {
    id: row.id,
    fullName: row.fullName,
    phoneNumber: row.phoneNumber,
    email: row.email,
    gender: row.gender,
    status: row.status as "active" | "blocked",
    isPhoneVerified: row.isPhoneVerified,
    walletBalancePaise: paise(row.walletBalancePaise),
    referralCode: row.referralCode,
    city: address?.city ?? null,
    bookingCount: row._count.bookings,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function requireCustomer(id: string) {
  const row = await userRepository.findCustomerById(id);
  if (!row) throw new Error("CUSTOMER_NOT_FOUND");
  return row;
}

export const adminCustomerService = {
  async list(query: CustomerListQuery) {
    const filters = {
      q: query.q,
      status: query.status as UserStatus[] | undefined,
      isPhoneVerified: query.isPhoneVerified,
    };
    const [[rows, total], stats, mapRows] = await Promise.all([
      userRepository.listCustomers(paginationSkip(query), filters),
      userRepository.countCustomerStats(),
      userRepository.listCustomerMapPoints(filters),
    ]);
    return {
      ...paginatedResult(rows.map(toCustomerAdminDto), total, query),
      stats,
      mapPoints: mapRows.flatMap((row) => {
        const address = row.addresses[0];
        if (!address || !Number.isFinite(address.latitude) || !Number.isFinite(address.longitude)) {
          return [];
        }
        return [{
          id: row.id,
          lat: address.latitude,
          lng: address.longitude,
          status: row.status,
          label: row.fullName?.trim() || row.phoneNumber,
        }];
      }),
    };
  },

  async getById(id: string) {
    return toCustomerAdminDto(await requireCustomer(id));
  },

  async updateStatus(id: string, status: "active" | "blocked") {
    await requireCustomer(id);
    const updated = await userRepository.updateStatus(id, status);
    if (status === "blocked") await refreshTokenStore.revoke("customer", id);
    return toCustomerAdminDto(updated);
  },

  async remove(id: string) {
    await requireCustomer(id);
    await userRepository.softDelete(id);
    await refreshTokenStore.revoke("customer", id);
  },
};

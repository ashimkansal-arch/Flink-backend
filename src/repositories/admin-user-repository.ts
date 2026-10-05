import { db, readDb } from "../lib/prisma";
import type { AccessScopeLevel, AdminUserStatus, Prisma } from "../generated/prisma/client";
import { applyNameEmailPhoneSearch } from "../lib/search";
import type { AdminAddressInput } from "../lib/api-schemas";

const adminUserInclude = {
  role: true,
  permissions: { include: { permission: true } },
  address: true,
  category: { select: { id: true, name: true, slug: true } },
  assignedTo: { select: { id: true, fullName: true, email: true } },
  invitedByAdmin: { select: { id: true, fullName: true, email: true } },
} as const;

type DirectoryFilters = {
  q?: string;
  role?: string[];
  status?: Array<"pending" | "active" | "disabled">;
  state?: string[];
  city?: string[];
  ownedByAdminIds?: string[];
};

function directoryWhere(filters?: DirectoryFilters): Prisma.AdminUserWhereInput {
  const where = applyNameEmailPhoneSearch<Prisma.AdminUserWhereInput>(
    { role: { roleName: { not: "super_admin" } } },
    filters?.q,
  );

  if (filters?.role?.length) {
    const roles = filters.role.filter((r) => r !== "super_admin");
    if (roles.length) where.role = { roleName: { in: roles } };
  }
  if (filters?.status?.length) {
    where.status = { in: filters.status };
  }

  const addressAnd: Prisma.AdminAddressWhereInput[] = [];
  if (filters?.state?.length) {
    addressAnd.push({
      OR: filters.state.map((state) => ({
        state: { equals: state, mode: "insensitive" as const },
      })),
    });
  }
  if (filters?.city?.length) {
    addressAnd.push({
      OR: filters.city.map((city) => ({
        city: { equals: city, mode: "insensitive" as const },
      })),
    });
  }
  if (addressAnd.length === 1) {
    where.address = addressAnd[0];
  } else if (addressAnd.length > 1) {
    where.address = { AND: addressAnd };
  }

  if (filters?.ownedByAdminIds) {
    where.id = { in: filters.ownedByAdminIds };
  }

  return where;
}

const adminUserListInclude = {
  ...adminUserInclude,
  _count: {
    select: {
      registeredProviders: { where: { status: { not: "deleted" } } },
      assignedMembers: true,
      invitedAdmins: { where: { assignedToId: null } },
      assignedSupervisors: { where: { status: { not: "deleted" } } },
      createdSupervisors: { where: { status: { not: "deleted" }, assignedToId: null } },
    },
  },
} as const;

type AdminListRow = Prisma.AdminUserGetPayload<{ include: typeof adminUserListInclude }>;

export const adminUserRepository = {
  findByEmail(email: string) {
    return readDb.adminUser.findUnique({ where: { email }, include: adminUserInclude });
  },

  findById(id: string) {
    return readDb.adminUser.findUnique({ where: { id }, include: adminUserInclude });
  },

  findByPhone(phoneNumber: string) {
    return readDb.adminUser.findUnique({ where: { phoneNumber } });
  },

  list(page: { skip: number; take: number }, filters?: DirectoryFilters) {
    const where = directoryWhere(filters);

    return Promise.all([
      readDb.adminUser.findMany({
        where,
        include: adminUserListInclude,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
      }),
      readDb.adminUser.count({ where }),
    ]) as Promise<[AdminListRow[], number]>;
  },

  async countDirectoryStats(filters?: DirectoryFilters) {
    const byStatus = await readDb.adminUser.groupBy({
      by: ["status"],
      where: directoryWhere(filters),
      _count: { _all: true },
    });
    const countFor = (status: AdminUserStatus) =>
      byStatus.find((row) => row.status === status)?._count._all ?? 0;
    const active = countFor("active");
    const disabled = countFor("disabled");
    const pending = countFor("pending");
    return { total: active + disabled + pending, active, disabled, pending };
  },

  updateLastLogin(id: string) {
    return db.adminUser.update({ where: { id }, data: { lastLoginAt: new Date() } });
  },

  create(data: {
    email: string;
    fullName: string;
    phoneNumber: string;
    passwordHash: string;
    roleId: string;
    invitedBy: string;
    scopeLevel?: AccessScopeLevel;
    scopeBusinessUnit?: string | null;
    scopeCityIds?: string[];
    scopeZoneIds?: string[];
    categoryId?: string | null;
    assignedToId?: string | null;
  }) {
    return db.adminUser.create({
      data: {
        email: data.email,
        fullName: data.fullName,
        phoneNumber: data.phoneNumber,
        passwordHash: data.passwordHash,
        roleId: data.roleId,
        invitedBy: data.invitedBy,
        status: "active",
        passwordResetRequired: true,
        scopeLevel: data.scopeLevel,
        scopeBusinessUnit: data.scopeBusinessUnit,
        scopeCityIds: data.scopeCityIds,
        scopeZoneIds: data.scopeZoneIds,
        categoryId: data.categoryId,
        assignedToId: data.assignedToId,
      },
      include: adminUserInclude,
    });
  },

  update(
    id: string,
    data: {
      fullName?: string;
      phoneNumber?: string;
      roleId?: string;
      status?: "pending" | "active" | "disabled";
      passwordHash?: string;
      passwordResetRequired?: boolean;
      scopeLevel?: AccessScopeLevel;
      scopeBusinessUnit?: string | null;
      scopeCityIds?: string[];
      scopeZoneIds?: string[];
      categoryId?: string | null;
      assignedToId?: string | null;
    },
  ) {
    return db.adminUser.update({
      where: { id },
      data,
      include: adminUserInclude,
    });
  },

  async setPermissions(adminUserId: string, permissionIds: string[]) {
    await db.$transaction(async (tx) => {
      await tx.adminUserPermission.deleteMany({ where: { adminUserId } });
      if (permissionIds.length === 0) return;
      await tx.adminUserPermission.createMany({
        data: permissionIds.map((permissionId) => ({ adminUserId, permissionId })),
      });
    });
  },

  disable(id: string) {
    return db.adminUser.update({
      where: { id },
      data: { status: "disabled" },
      include: adminUserInclude,
    });
  },

  upsertAddress(adminUserId: string, data: AdminAddressInput) {
    return db.adminAddress.upsert({
      where: { adminUserId },
      create: {
        adminUserId,
        country: data.country ?? "India",
        state: data.state,
        city: data.city,
        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2,
        pincode: data.pincode,
      },
      update: {
        country: data.country,
        state: data.state,
        city: data.city,
        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2,
        pincode: data.pincode,
      },
    });
  },

  findAuditActors(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return readDb.adminUser.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true, email: true, role: { select: { name: true, roleName: true } } },
    });
  },

  findAuditSearchIds(q: string) {
    const term = q.trim();
    if (!term) return Promise.resolve([]);
    return readDb.adminUser.findMany({
      where: {
        OR: [
          { fullName: { contains: term, mode: "insensitive" } },
          { email: { contains: term, mode: "insensitive" } },
          { role: { name: { contains: term, mode: "insensitive" } } },
          { role: { roleName: { contains: term, mode: "insensitive" } } },
        ],
      },
      select: { id: true },
      take: 50,
    });
  },

  countRegisteredWorkers(adminId: string) {
    return readDb.serviceProvider.count({
      where: { registeredByAdminId: adminId, status: { not: "deleted" } },
    });
  },

  async countTeamToTransfer(adminId: string) {
    const [workers, assignedMembers, unassignedInvitees, assignedSupervisors, unassignedCreatedSupervisors] =
      await Promise.all([
        this.countRegisteredWorkers(adminId),
        readDb.adminUser.count({ where: { assignedToId: adminId } }),
        readDb.adminUser.count({ where: { invitedBy: adminId, assignedToId: null } }),
        readDb.supervisor.count({
          where: { assignedToId: adminId, status: { not: "deleted" } },
        }),
        readDb.supervisor.count({
          where: { createdBy: adminId, assignedToId: null, status: { not: "deleted" } },
        }),
      ]);
    return workers + assignedMembers + unassignedInvitees + assignedSupervisors + unassignedCreatedSupervisors;
  },

  countActivePeers(roleName: string, exceptId: string) {
    return readDb.adminUser.count({
      where: {
        id: { not: exceptId },
        status: "active",
        role: { roleName },
      },
    });
  },

  reassignTeam(fromId: string, toId: string) {
    return db.$transaction(async (tx) => {
      await tx.serviceProvider.updateMany({
        where: { registeredByAdminId: fromId, status: { not: "deleted" } },
        data: { registeredByAdminId: toId },
      });
      await tx.adminUser.updateMany({
        where: { assignedToId: fromId },
        data: { assignedToId: toId },
      });
      await tx.adminUser.updateMany({
        where: { invitedBy: fromId, assignedToId: null },
        data: { assignedToId: toId },
      });
      await tx.supervisor.updateMany({
        where: { assignedToId: fromId, status: { not: "deleted" } },
        data: { assignedToId: toId },
      });
      await tx.supervisor.updateMany({
        where: { createdBy: fromId, assignedToId: null, status: { not: "deleted" } },
        data: { createdBy: toId, assignedToId: toId },
      });
    });
  },

  findRoleNamesBySlugs(slugs: string[]) {
    if (slugs.length === 0) return Promise.resolve([]);
    return readDb.adminRole.findMany({
      where: { roleName: { in: slugs } },
      select: { roleName: true, name: true },
    });
  },
};

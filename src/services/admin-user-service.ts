import { adminUserRepository } from "../repositories/admin-user-repository";
import { adminRoleRepository } from "../repositories/admin-role-repository";
import { generateTemporaryPassword, hashPassword, verifyPassword } from "../lib/auth/password";
import { sendTeamMemberPasswordResetEmail, sendTeamMemberWelcomeEmail } from "../lib/mailer";
import { invalidateAdminPermissionCache } from "../lib/auth/permissions";
import { refreshTokenStore } from "../lib/auth/refresh-token-store";
import { normalizeRoleName } from "../lib/auth/permission-catalog";
import {
  defaultScopeForRole,
  roleDisplayLabel,
  type AccessScopeLevel,
} from "../lib/auth/crm-roles";
import {
  paginatedResult,
  paginationSkip,
  type AdminUserCreatedQuery,
  type AdminUserListQuery,
} from "../lib/pagination";
import { mapAdminAddressBody, toAdminAddressDto, toAdminRefDto } from "../lib/api-schemas";
import { serviceCategoryRepository } from "../repositories/service-category-repository";
import { adminProviderService } from "./admin-provider-service";
import { adminSupervisorService } from "./admin-supervisor-service";
import { managedTeamRolesForRole } from "../lib/team-member-role-modules";
import {
  adminSubtreeIds,
  roleIsAdmin,
  isLeafTeamRole,
  scopedAdminIds,
  SUPER_ADMIN,
  subtreeTeamCounts,
  supervisorIdsForAdmins,
} from "../lib/admin-subtree";
import { subtreeWorkerVisibility } from "../lib/worker-scope-modules";

type AdminRow = NonNullable<Awaited<ReturnType<typeof adminUserRepository.findById>>>;
type AdminListRow = Awaited<ReturnType<typeof adminUserRepository.list>>[0][number];

type ScopeInput = {
  scopeLevel?: AccessScopeLevel;
  scopeBusinessUnit?: string | null;
  scopeCityIds?: string[];
  scopeZoneIds?: string[];
};

function toAdminDto(admin: AdminRow) {
  return {
    id: admin.id,
    email: admin.email,
    fullName: admin.fullName,
    phoneNumber: admin.phoneNumber,
    status: admin.status,
    role: admin.role.roleName,
    permissions: admin.permissions.map((row) => row.permission.permissionKey),
    passwordResetRequired: admin.passwordResetRequired,
    lastLoginAt: admin.lastLoginAt,
    address: toAdminAddressDto(admin.address),
    scopeLevel: admin.scopeLevel,
    scopeBusinessUnit: admin.scopeBusinessUnit,
    scopeCityIds: admin.scopeCityIds,
    scopeZoneIds: admin.scopeZoneIds,
    category: admin.category,
    assignedTo: toAdminRefDto(admin.assignedTo),
    manager: toAdminRefDto(admin.assignedTo ?? admin.invitedByAdmin),
    createdAt: admin.createdAt,
    updatedAt: admin.updatedAt,
    isAdmin: roleIsAdmin(admin.role.roleName, admin.role.isAdmin),
  };
}

function toAdminListDto(admin: AdminListRow, teamCount: number) {
  const counts = admin._count;
  const hasTeamToTransfer =
    teamCount > 0 ||
    counts.registeredProviders > 0 ||
    counts.assignedMembers > 0 ||
    counts.invitedAdmins > 0 ||
    counts.assignedSupervisors > 0 ||
    counts.createdSupervisors > 0;
  return {
    ...toAdminDto(admin),
    teamCount,
    directTeamCount: counts.registeredProviders,
    hasTeamToTransfer,
  };
}

async function requireDirectoryAdmin(id: string) {
  const admin = await adminUserRepository.findById(id);
  if (!admin || admin.role.roleName === SUPER_ADMIN) throw new Error("ADMIN_NOT_FOUND");
  return admin;
}

async function resolveAssignableRole(raw?: string) {
  const roleName = normalizeRoleName(raw);
  const role = await adminRoleRepository.findByName(roleName);
  if (!role) throw new Error("UNKNOWN_ROLE");
  return role;
}

async function resolveCategory(categoryId?: string | null) {
  if (categoryId === undefined) return undefined;
  if (categoryId === null) return null;
  const category = await serviceCategoryRepository.findById(categoryId);
  if (!category || category.parentId) throw new Error("CATEGORY_NOT_FOUND");
  return categoryId;
}

async function resolveAssignedTo(assignedToId?: string | null) {
  if (assignedToId === undefined) return undefined;
  if (assignedToId === null) return null;
  const admin = await adminUserRepository.findById(assignedToId);
  if (!admin || admin.status !== "active" || admin.role.roleName === SUPER_ADMIN) {
    throw new Error("ASSIGNED_ADMIN_NOT_FOUND");
  }
  if (isLeafTeamRole(admin.role.roleName)) throw new Error("ASSIGNED_ADMIN_NOT_FOUND");
  return assignedToId;
}

type AdminAddressBody = NonNullable<Parameters<typeof mapAdminAddressBody>[0]>;

function constrainRoles(requested: string[] | undefined, managed: string[] | null) {
  if (managed == null) return requested;
  if (!requested?.length) return managed;
  return requested.filter((role) => managed.includes(role));
}

async function assertManagedRole(actorRole: string | undefined, targetRole: string) {
  if (!actorRole) return;
  const managed = await managedTeamRolesForRole(actorRole);
  if (managed && !managed.includes(targetRole)) throw new Error("ROLE_NOT_ALLOWED");
}

async function assertManagedDirectoryUser(id: string, actorRole?: string, actorId?: string) {
  const admin = await requireDirectoryAdmin(id);
  if (actorRole) await assertManagedRole(actorRole, admin.role.roleName);
  const memberIds = await scopedAdminIds(actorRole, actorId);
  if (memberIds && !memberIds.includes(admin.id)) {
    throw new Error("ADMIN_NOT_FOUND");
  }
  return admin;
}

function emptyDirectoryList(query: AdminUserListQuery) {
  return {
    ...paginatedResult([], 0, query),
    stats: { total: 0, active: 0, disabled: 0, pending: 0 },
  };
}

async function transferTeamIfNeeded(admin: AdminRow, transferToId?: string | null) {
  const teamSize = await adminUserRepository.countTeamToTransfer(admin.id);
  if (teamSize === 0) return;
  const peers = await adminUserRepository.countActivePeers(admin.role.roleName, admin.id);
  if (peers === 0) throw new Error("NO_ROLE_PEER");
  if (!transferToId) throw new Error("TEAM_TRANSFER_REQUIRED");
  const target = await adminUserRepository.findById(transferToId);
  if (!target || target.id === admin.id || target.status !== "active" || target.role.roleName !== admin.role.roleName) {
    throw new Error("TRANSFER_TARGET_INVALID");
  }
  await adminUserRepository.reassignTeam(admin.id, transferToId);
}

export const adminUserService = {
  async list(query: AdminUserListQuery, actorRole?: string, actorId?: string) {
    const managed = actorRole ? await managedTeamRolesForRole(actorRole) : null;
    const role = constrainRoles(query.role, managed);
    const ownedByAdminIds = await scopedAdminIds(actorRole, actorId);
    if ((managed && (!role || role.length === 0)) || ownedByAdminIds?.length === 0) {
      return emptyDirectoryList(query);
    }
    const filters = {
      q: query.q,
      role,
      status: query.status,
      state: query.state,
      city: query.city,
      ownedByAdminIds,
    };
    const [[admins, total], stats] = await Promise.all([
      adminUserRepository.list(paginationSkip(query), filters),
      adminUserRepository.countDirectoryStats(filters),
    ]);
    const teamCounts = await subtreeTeamCounts(admins.map((admin) => admin.id));
    return {
      ...paginatedResult(
        admins.map((admin) => toAdminListDto(admin, teamCounts.get(admin.id) ?? 0)),
        total,
        query,
      ),
      stats,
    };
  },

  async getById(id: string) {
    const admin = await adminUserRepository.findById(id);
    if (!admin) throw new Error("ADMIN_NOT_FOUND");
    return toAdminDto(admin);
  },

  async getDirectoryUser(id: string, actorRole?: string, actorId?: string) {
    return toAdminDto(await assertManagedDirectoryUser(id, actorRole, actorId));
  },

  async create(input: {
    fullName: string;
    email: string;
    phoneNumber: string;
    role: string;
    invitedBy: string;
    actorRole?: string;
    categoryId?: string | null;
    assignedToId?: string | null;
    address?: AdminAddressBody;
  } & ScopeInput) {
    const email = input.email.trim().toLowerCase();
    if (await adminUserRepository.findByEmail(email)) throw new Error("EMAIL_TAKEN");
    if (await adminUserRepository.findByPhone(input.phoneNumber)) throw new Error("PHONE_TAKEN");

    const role = await resolveAssignableRole(input.role);
    const roleName = role.roleName;
    await assertManagedRole(input.actorRole, roleName);
    const scopeLevel = input.scopeLevel ?? defaultScopeForRole(roleName);
    const categoryId = await resolveCategory(input.categoryId);
    const assignedToId = await resolveAssignedTo(input.assignedToId);

    const temporaryPassword = generateTemporaryPassword();
    const admin = await adminUserRepository.create({
      email,
      fullName: input.fullName.trim(),
      phoneNumber: input.phoneNumber,
      passwordHash: await hashPassword(temporaryPassword),
      roleId: role.id,
      invitedBy: input.invitedBy,
      scopeLevel,
      scopeBusinessUnit: input.scopeBusinessUnit,
      scopeCityIds: input.scopeCityIds,
      scopeZoneIds: input.scopeZoneIds,
      categoryId,
      assignedToId,
    });

    const addressInput = mapAdminAddressBody(input.address);
    if (addressInput) await adminUserRepository.upsertAddress(admin.id, addressInput);

    await invalidateAdminPermissionCache(roleName, admin.id);
    await sendTeamMemberWelcomeEmail({
      to: email,
      fullName: input.fullName.trim(),
      temporaryPassword,
      roleLabel: roleDisplayLabel(roleName),
    });

    const created = await adminUserRepository.findById(admin.id);
    return { admin: toAdminDto(created!), passwordResetRequired: true as const };
  },

  async update(
    id: string,
    input: {
      fullName?: string;
      phoneNumber?: string;
      role?: string;
      status?: "pending" | "active" | "disabled";
      categoryId?: string | null;
      assignedToId?: string | null;
      transferToId?: string | null;
      address?: AdminAddressBody;
      actorRole?: string;
      actorId?: string;
    } & ScopeInput,
  ) {
    const admin = await assertManagedDirectoryUser(id, input.actorRole, input.actorId);
    if (input.status === "disabled") {
      await transferTeamIfNeeded(admin, input.transferToId);
    }
    if (input.phoneNumber && input.phoneNumber !== admin.phoneNumber) {
      if (await adminUserRepository.findByPhone(input.phoneNumber)) throw new Error("PHONE_TAKEN");
    }

    let roleId: string | undefined;
    let roleName = admin.role.roleName;
    if (input.role) {
      const role = await resolveAssignableRole(input.role);
      await assertManagedRole(input.actorRole, role.roleName);
      roleName = role.roleName;
      roleId = role.id;
    }

    await adminUserRepository.update(id, {
      fullName: input.fullName?.trim(),
      phoneNumber: input.phoneNumber,
      roleId,
      status: input.status,
      scopeLevel: input.scopeLevel,
      scopeBusinessUnit: input.scopeBusinessUnit,
      scopeCityIds: input.scopeCityIds,
      scopeZoneIds: input.scopeZoneIds,
      categoryId: await resolveCategory(input.categoryId),
      assignedToId: await resolveAssignedTo(input.assignedToId),
    });

    const addressInput = mapAdminAddressBody(input.address);
    if (addressInput) await adminUserRepository.upsertAddress(id, addressInput);

    await invalidateAdminPermissionCache(roleName, id);
    return this.getDirectoryUser(id, input.actorRole, input.actorId);
  },

  async remove(id: string, actorId: string, actorRole?: string, transferToId?: string | null) {
    if (id === actorId) throw new Error("CANNOT_DELETE_SELF");
    const admin = await assertManagedDirectoryUser(id, actorRole, actorId);
    await transferTeamIfNeeded(admin, transferToId);
    await adminUserRepository.disable(id);
    await invalidateAdminPermissionCache(admin.role.roleName, id);
  },

  async resetPassword(id: string, actorRole?: string, actorId?: string) {
    const admin = await assertManagedDirectoryUser(id, actorRole, actorId);
    const temporaryPassword = generateTemporaryPassword();
    await adminUserRepository.update(id, {
      passwordHash: await hashPassword(temporaryPassword),
      passwordResetRequired: true,
    });
    await refreshTokenStore.revoke("admin", id);
    await sendTeamMemberPasswordResetEmail({
      to: admin.email,
      fullName: admin.fullName ?? "there",
      temporaryPassword,
      roleLabel: roleDisplayLabel(admin.role.roleName),
    });
    return { passwordResetRequired: true as const };
  },

  async listCreated(id: string, query: AdminUserCreatedQuery, actorRole?: string, actorId?: string) {
    const admin = await assertManagedDirectoryUser(id, actorRole, actorId);
    const leaf = isLeafTeamRole(admin.role.roleName);
    const group = leaf ? "workers" : (query.group ?? "members");
    const treeIds = leaf ? [id] : await adminSubtreeIds(id);
    const descendantIds = treeIds.filter((treeId) => treeId !== id);
    const visibility = leaf
      ? { registeredByAdminIds: [id] }
      : await subtreeWorkerVisibility(id);

    const [supervisorIds, workers] = await Promise.all([
      leaf ? Promise.resolve([] as string[]) : supervisorIdsForAdmins(treeIds),
      group === "workers"
        ? adminProviderService.list(
            {
              page: query.page,
              limit: query.limit,
              q: query.q,
              availability: query.availability,
              kyc: query.kyc,
              city: undefined,
              managedBy: undefined,
            },
            visibility,
          )
        : adminProviderService.listStats(visibility).then((stats) => ({
            ...paginatedResult([], 0, query),
            stats,
          })),
    ]);

    const member = { id: admin.id, fullName: admin.fullName, email: admin.email, role: admin.role.roleName };
    const stats = {
      members: {
        total: descendantIds.length,
        roles: [],
      },
      supervisors: { total: supervisorIds.length },
      workers: {
        total: workers.stats.online + workers.stats.busy + workers.stats.offline,
        ...workers.stats,
      },
    };

    if (group === "workers") {
      return {
        group,
        member,
        items: workers.items,
        page: workers.page,
        limit: workers.limit,
        total: workers.total,
        totalPages: workers.totalPages,
        stats,
      };
    }

    if (group === "supervisors") {
      return {
        group,
        member,
        ...(await adminSupervisorService.listByIds(supervisorIds, query)),
        stats,
      };
    }

    const [admins, total] =
      descendantIds.length === 0
        ? [[], 0]
        : await adminUserRepository.list(paginationSkip(query), {
            q: query.q,
            role: query.role ? [query.role] : undefined,
            ownedByAdminIds: descendantIds,
          });
    const teamCounts = await subtreeTeamCounts(admins.map((row) => row.id));
    return {
      group,
      member,
      ...paginatedResult(
        admins.map((row) => toAdminListDto(row, teamCounts.get(row.id) ?? 0)),
        total,
        query,
      ),
      stats,
    };
  },

  async changePassword(adminId: string, currentPassword: string, newPassword: string) {
    const admin = await adminUserRepository.findById(adminId);
    if (!admin?.passwordHash) throw new Error("ADMIN_NOT_FOUND");
    if (!(await verifyPassword(currentPassword, admin.passwordHash))) {
      throw new Error("INVALID_CREDENTIALS");
    }
    await adminUserRepository.update(adminId, {
      passwordHash: await hashPassword(newPassword),
      passwordResetRequired: false,
    });
  },
};

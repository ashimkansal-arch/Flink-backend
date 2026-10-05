import { adminRoleRepository, adminPermissionRepository } from "../repositories/admin-role-repository";
import { adminModuleRepository } from "../repositories/admin-module-repository";
import { invalidateAdminPermissionCache } from "../lib/auth/permissions";
import { normalizePermissionList } from "../lib/auth/permission-catalog";
import { roleDisplayLabel } from "../lib/auth/crm-roles";
import { slugifyRole } from "../lib/slug";
import { roleIsAdmin, SUPER_ADMIN } from "../lib/admin-subtree";
import { SYSTEM_SECTION_SLUG } from "../lib/sidebar-sections";
import type { OptionalSearchQuery } from "../lib/pagination";
import { syncTeamMemberRoleModules, withTeamMemberParentModuleIds } from "../lib/team-member-role-modules";
import { syncWorkerScopeModules } from "../lib/worker-scope-modules";

function toModuleRef(module: {
  id: string;
  name: string;
  slug: string;
  path?: string;
  isActive: boolean;
  sectionName?: string;
}) {
  return {
    id: module.id,
    name: module.name,
    slug: module.slug,
    path: module.path ?? "",
    isActive: module.isActive,
    sectionName: module.sectionName ?? null,
  };
}

function toRoleDto(role: NonNullable<Awaited<ReturnType<typeof adminRoleRepository.findById>>>) {
  const isSuperAdmin = role.roleName === SUPER_ADMIN;
  const modules = role.roleModules.map((rm) => toModuleRef(rm.module));
  return {
    id: role.id,
    name: role.name,
    roleName: role.roleName,
    description: role.description,
    isActive: role.isActive,
    isAdmin: roleIsAdmin(role.roleName, role.isAdmin),
    isReserved: isSuperAdmin,
    permissions: role.rolePermissions.map((rp) => rp.permission.permissionKey),
    modules,
    userCount: role._count.adminUsers,
  };
}

async function refreshRoleModules(roleName: string, extraName?: string) {
  await syncTeamMemberRoleModules();
  await syncWorkerScopeModules();
  await invalidateAdminPermissionCache(roleName);
  if (extraName && extraName !== roleName) await invalidateAdminPermissionCache(extraName);
}

async function resolvePermissionIds(permissions?: string[]): Promise<string[] | undefined> {
  if (permissions === undefined) return undefined;
  if (permissions.length === 0) return [];
  const keys = normalizePermissionList(permissions);
  const rows = await Promise.all(keys.map((key) => adminPermissionRepository.upsertByKey(key)));
  return rows.map((row) => row.id);
}

async function resolveModuleIds(moduleIds?: string[], systemOnly = false) {
  if (moduleIds === undefined) return undefined;
  const unique = [...new Set(moduleIds.filter(Boolean))];
  if (unique.length === 0) return [];
  const rows = await adminModuleRepository.findIds(unique);
  if (rows.length !== unique.length) throw new Error("MODULE_NOT_FOUND");
  if (!systemOnly) return withTeamMemberParentModuleIds(unique);
  const modules = await adminModuleRepository.list();
  const systemIds = new Set(
    modules.filter((module) => module.sectionSlug === SYSTEM_SECTION_SLUG).map((module) => module.id),
  );
  return unique.filter((id) => systemIds.has(id));
}

export const adminRoleService = {
  async list(query: OptionalSearchQuery = {}) {
    const roles = await adminRoleRepository.list(query.q);
    return roles.map((role) => toRoleDto(role));
  },

  async listAll(query: OptionalSearchQuery = {}) {
    const roles = await adminRoleRepository.list(query.q, true);
    const superAdminFirst = [...roles].sort((a, b) => {
      if (a.roleName === SUPER_ADMIN) return -1;
      if (b.roleName === SUPER_ADMIN) return 1;
      return a.name.localeCompare(b.name);
    });
    return superAdminFirst.map((role) => toRoleDto(role));
  },

  async getById(id: string) {
    const role = await adminRoleRepository.findById(id);
    if (!role) throw new Error("ROLE_NOT_FOUND");
    return toRoleDto(role);
  },

  async create(input: {
    name?: string;
    roleName?: string;
    description?: string;
    permissions?: string[];
    moduleIds?: string[];
    isActive?: boolean;
    isAdmin?: boolean;
  }) {
    const roleName = slugifyRole(input.roleName || input.name || "");
    if (roleName === SUPER_ADMIN) throw new Error("ROLE_RESERVED");
    const existing = await adminRoleRepository.findByName(roleName);
    if (existing) throw new Error("ROLE_EXISTS");

    const name = input.name?.trim() || roleDisplayLabel(roleName);
    const role = await adminRoleRepository.create({
      roleName,
      name,
      description: input.description,
      isActive: input.isActive,
      isAdmin: input.isAdmin,
    });

    const permissionIds = await resolvePermissionIds(input.permissions);
    if (permissionIds) await adminRoleRepository.setPermissions(role.id, permissionIds);
    const moduleIds = await resolveModuleIds(input.moduleIds);
    if (moduleIds) await adminRoleRepository.setModules(role.id, moduleIds);

    await refreshRoleModules(roleName);
    return this.getById(role.id);
  },

  async update(
    id: string,
    input: {
      name?: string;
      roleName?: string;
      description?: string | null;
      permissions?: string[];
      moduleIds?: string[];
      isActive?: boolean;
      isAdmin?: boolean;
    },
  ) {
    const role = await adminRoleRepository.findById(id);
    if (!role) throw new Error("ROLE_NOT_FOUND");
    const isSuperAdmin = role.roleName === SUPER_ADMIN;
    if (isSuperAdmin && (input.roleName || input.isActive === false)) throw new Error("ROLE_RESERVED");

    const nextName = input.roleName ? slugifyRole(input.roleName) : undefined;
    if (nextName === SUPER_ADMIN) throw new Error("ROLE_RESERVED");

    await adminRoleRepository.update(id, {
      roleName: nextName,
      name: input.name?.trim(),
      description: input.description,
      isActive: isSuperAdmin ? true : input.isActive,
      isAdmin: isSuperAdmin ? true : input.isAdmin,
    });

    const permissionIds = await resolvePermissionIds(input.permissions);
    if (permissionIds) await adminRoleRepository.setPermissions(id, permissionIds);
    const moduleIds = await resolveModuleIds(input.moduleIds, isSuperAdmin);
    if (moduleIds) await adminRoleRepository.setModules(id, moduleIds);

    await refreshRoleModules(role.roleName, nextName);
    return this.getById(id);
  },

  async remove(id: string) {
    const role = await adminRoleRepository.findById(id);
    if (!role || role.roleName === SUPER_ADMIN) throw new Error("ROLE_NOT_FOUND");
    if (role._count.adminUsers > 0) throw new Error("ROLE_IN_USE");
    await adminRoleRepository.delete(id);
    await syncTeamMemberRoleModules();
    await invalidateAdminPermissionCache(role.roleName);
  },
};

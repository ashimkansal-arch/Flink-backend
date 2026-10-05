import { db } from "./prisma";
import { adminModuleRepository } from "../repositories/admin-module-repository";
import { adminRoleRepository } from "../repositories/admin-role-repository";
import { visibleModulesForRole } from "./auth/visible-modules";

export const TEAM_MEMBERS_PATH = "/manage-team-members";
export const TEAM_MEMBER_ROLE_PATH_PREFIX = "/manage-team-members/role/";

const SUPER_ADMIN = "super_admin";

export function teamMemberRoleModulePath(roleName: string) {
  return `${TEAM_MEMBER_ROLE_PATH_PREFIX}${roleName}`;
}

export function parseManagedTeamRole(path: string) {
  if (!path.startsWith(TEAM_MEMBER_ROLE_PATH_PREFIX)) return null;
  return path.slice(TEAM_MEMBER_ROLE_PATH_PREFIX.length) || null;
}

export function isTeamMemberRoleModulePath(path: string) {
  return parseManagedTeamRole(path) != null;
}

/** `null` = every assignable role. `[]` = none. */
export async function managedTeamRolesForRole(roleName: string): Promise<string[] | null> {
  if (roleName === SUPER_ADMIN) return null;
  const modules = await visibleModulesForRole(roleName);
  const managed = modules
    .map((module) => parseManagedTeamRole(module.path))
    .filter((name): name is string => Boolean(name));
  if (managed.length > 0) return managed;
  if (modules.some((module) => module.path === TEAM_MEMBERS_PATH)) return null;
  return [];
}

export async function withTeamMemberParentModuleIds(moduleIds: string[]) {
  if (moduleIds.length === 0) return moduleIds;
  const rows = await db.adminModule.findMany({
    where: { id: { in: moduleIds } },
    select: { id: true, path: true },
  });
  if (!rows.some((row) => isTeamMemberRoleModulePath(row.path))) return moduleIds;
  const parent = await adminModuleRepository.findByPath(TEAM_MEMBERS_PATH);
  if (!parent || moduleIds.includes(parent.id)) return moduleIds;
  return [...moduleIds, parent.id];
}

export async function syncTeamMemberRoleModules() {
  const parent = await adminModuleRepository.findByPath(TEAM_MEMBERS_PATH);
  if (!parent) return;

  const roles = await adminRoleRepository.list(undefined, true);
  const assignable = roles.filter((role) => role.roleName !== SUPER_ADMIN);
  const existing = await db.adminModule.findMany({
    where: { path: { startsWith: TEAM_MEMBER_ROLE_PATH_PREFIX } },
  });
  const byRole = new Map(
    existing.flatMap((row) => {
      const roleName = parseManagedTeamRole(row.path);
      return roleName ? [[roleName, row] as const] : [];
    }),
  );

  for (const role of assignable) {
    const path = teamMemberRoleModulePath(role.roleName);
    const slug = `manage-team-members-${role.roleName}`.slice(0, 80);
    const name = `Manage team members · ${role.name}`.slice(0, 80);
    const found = byRole.get(role.roleName);
    if (!found) {
      await adminModuleRepository.create({
        name,
        slug,
        sectionName: parent.sectionName,
        sectionSlug: parent.sectionSlug,
        path,
        icon: parent.icon,
        displayOrder: parent.displayOrder + 1,
        description: `See and create ${role.name} team members`,
      });
    } else if (found.name !== name || found.slug !== slug || found.path !== path) {
      await adminModuleRepository.update(found.id, { name, slug, path });
    }
    byRole.delete(role.roleName);
  }

  for (const stale of byRole.values()) {
    await db.adminModule.delete({ where: { id: stale.id } });
  }
}

import { adminModuleRepository } from "../repositories/admin-module-repository";
import { adminRoleRepository } from "../repositories/admin-role-repository";
import { slugifyModule } from "../lib/slug";
import { resolveSidebarSection, sidebarSectionDisplayOrder } from "../lib/sidebar-sections";
import { resolveCrmScreen } from "../lib/crm-screens";
import { resolveModuleIcon } from "../lib/module-icons";
import { visibleModulesForRole } from "../lib/auth/visible-modules";
import { isTeamMemberRoleModulePath } from "../lib/team-member-role-modules";
import { invalidateAllRolePermissionCaches } from "../lib/auth/permissions";
import type { OptionalSearchQuery } from "../lib/pagination";

const SUPER_ADMIN = "super_admin";

function toRoleRef(role: { id: string; roleName: string; name: string }) {
  return { id: role.id, name: role.name, slug: role.roleName };
}

function toModuleDto(row: NonNullable<Awaited<ReturnType<typeof adminModuleRepository.findById>>>) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    sectionName: row.sectionName,
    sectionSlug: row.sectionSlug,
    path: row.path,
    icon: row.icon,
    displayOrder: row.displayOrder,
    description: row.description,
    isActive: row.isActive,
    roles: row.roleModules
      .filter((rm) => rm.role.roleName !== SUPER_ADMIN)
      .map((rm) => toRoleRef(rm.role)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function uniqueModuleSlug(nameOrSlug: string, exceptId?: string) {
  const slug = slugifyModule(nameOrSlug);
  const existing = await adminModuleRepository.findBySlug(slug);
  if (existing && existing.id !== exceptId) throw new Error("SLUG_TAKEN");
  return slug;
}

async function uniquePath(path: string, exceptId?: string) {
  const existing = await adminModuleRepository.findByPath(path);
  if (existing && existing.id !== exceptId) throw new Error("PATH_TAKEN");
  return path;
}

async function resolveAssignableRoleIds(roleIds?: string[]) {
  if (roleIds === undefined) return undefined;
  const unique = [...new Set(roleIds.filter(Boolean))];
  if (unique.length === 0) return [];
  const roles = await adminRoleRepository.findIds(unique);
  if (roles.length !== unique.length) throw new Error("ROLE_NOT_FOUND");
  return roles.filter((role) => role.roleName !== SUPER_ADMIN).map((role) => role.id);
}

export const adminModuleService = {
  async list(query: OptionalSearchQuery = {}) {
    const rows = await adminModuleRepository.list(query.q);
    return rows.map(toModuleDto);
  },

  async getById(id: string) {
    const row = await adminModuleRepository.findById(id);
    if (!row) throw new Error("MODULE_NOT_FOUND");
    return toModuleDto(row);
  },

  async create(input: {
    name: string;
    slug?: string;
    sectionName?: string;
    path: string;
    icon?: string;
    displayOrder?: number;
    description?: string;
    roleIds?: string[];
  }) {
    const screen = resolveCrmScreen(input.path);
    const slug = await uniqueModuleSlug(input.slug?.trim() || screen.slug);
    await uniquePath(screen.path);
    const section =
      screen.path === "/"
        ? { sectionName: "", sectionSlug: "", displayOrder: 0 }
        : resolveSidebarSection(input.sectionName ?? "");
    const displayOrder =
      input.displayOrder ??
      (await adminModuleRepository.nextDisplayOrder(section.sectionSlug, section.displayOrder));
    const row = await adminModuleRepository.create({
      name: input.name.trim(),
      slug,
      sectionName: section.sectionName,
      sectionSlug: section.sectionSlug,
      path: screen.path,
      icon: resolveModuleIcon(input.icon ?? screen.icon),
      displayOrder,
      description: input.description?.trim() || undefined,
    });
    const roleIds = await resolveAssignableRoleIds(input.roleIds);
    if (roleIds?.length) await adminModuleRepository.setRoles(row.id, roleIds);
    await invalidateAllRolePermissionCaches();
    return this.getById(row.id);
  },

  async update(
    id: string,
    input: {
      name?: string;
      slug?: string;
      sectionName?: string;
      path?: string;
      icon?: string;
      displayOrder?: number;
      description?: string | null;
      isActive?: boolean;
      roleIds?: string[];
    },
  ) {
    const existing = await adminModuleRepository.findById(id);
    if (!existing) throw new Error("MODULE_NOT_FOUND");
    const screen = input.path != null ? resolveCrmScreen(input.path) : undefined;
    if (screen) await uniquePath(screen.path, id);
    const slug =
      input.slug != null
        ? await uniqueModuleSlug(input.slug, id)
        : screen
          ? await uniqueModuleSlug(screen.slug, id)
          : undefined;
    const section =
      screen?.path === "/"
        ? { sectionName: "", sectionSlug: "", displayOrder: 0 }
        : input.sectionName != null
          ? resolveSidebarSection(input.sectionName)
          : undefined;
    await adminModuleRepository.update(id, {
      name: input.name?.trim(),
      slug,
      sectionName: section?.sectionName,
      sectionSlug: section?.sectionSlug,
      path: screen?.path,
      icon: input.icon != null ? resolveModuleIcon(input.icon) : screen ? resolveModuleIcon(screen.icon) : undefined,
      displayOrder: input.displayOrder,
      description: input.description,
      isActive: input.isActive,
    });
    const roleIds = await resolveAssignableRoleIds(input.roleIds);
    if (roleIds) await adminModuleRepository.setRoles(id, roleIds);
    await invalidateAllRolePermissionCaches();
    return this.getById(id);
  },

  async sidebarForRole(roleName: string) {
    const rows = await visibleModulesForRole(roleName);
    return groupSidebar(
      rows.map((row) => ({
        name: row.name,
        slug: row.slug,
        sectionName: row.sectionName,
        sectionSlug: row.sectionSlug,
        path: row.path,
        icon: row.icon,
        displayOrder: row.displayOrder,
      })),
    );
  },
};

function groupSidebar(
  modules: Array<{
    name: string;
    slug: string;
    sectionName: string;
    sectionSlug: string;
    path: string;
    icon: string;
    displayOrder: number;
  }>,
) {
  const grouped = new Map<
    string,
    {
      sectionName: string;
      sectionSlug: string;
      displayOrder: number;
      modules: Array<{ name: string; slug: string; path: string; icon: string; displayOrder: number }>;
    }
  >();

  for (const module of modules) {
    if (isTeamMemberRoleModulePath(module.path)) continue;
    if (!grouped.has(module.sectionSlug)) {
      grouped.set(module.sectionSlug, {
        sectionName: module.sectionName,
        sectionSlug: module.sectionSlug,
        displayOrder: sidebarSectionDisplayOrder(module.sectionSlug),
        modules: [],
      });
    }
    const section = grouped.get(module.sectionSlug)!;
    section.modules.push({
      name: module.name,
      slug: module.slug,
      path: module.path,
      icon: module.icon,
      displayOrder: module.displayOrder,
    });
  }

  for (const section of grouped.values()) {
    section.modules.sort(
      (a, b) =>
        a.displayOrder - b.displayOrder ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  }

  return [...grouped.values()]
    .sort((a, b) => {
      if (!a.sectionName && b.sectionName) return -1;
      if (a.sectionName && !b.sectionName) return 1;
      return (
        a.displayOrder - b.displayOrder ||
        a.sectionName.localeCompare(b.sectionName, undefined, { sensitivity: "base" })
      );
    })
    .map(({ displayOrder: _displayOrder, ...section }) => ({
      ...section,
      modules: section.modules.map(({ displayOrder: _order, ...module }) => module),
    }));
}

import { adminModuleRepository } from "../../repositories/admin-module-repository";
import { SYSTEM_SECTION_SLUG } from "../sidebar-sections";

const SUPER_ADMIN = "super_admin";

export type VisibleModule = {
  id: string;
  name: string;
  slug: string;
  sectionName: string;
  sectionSlug: string;
  path: string;
  icon: string;
  displayOrder: number;
};

function toVisible(row: VisibleModule): VisibleModule {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    sectionName: row.sectionName,
    sectionSlug: row.sectionSlug,
    path: row.path,
    icon: row.icon,
    displayOrder: row.displayOrder,
  };
}

/** Modules this role may open in the CRM sidebar. System is assignment-only for every role. */
export async function visibleModulesForRole(roleName: string): Promise<VisibleModule[]> {
  const assigned = await adminModuleRepository.listActiveForRole(roleName);
  if (roleName !== SUPER_ADMIN) return assigned.map(toVisible);

  const allActive = await adminModuleRepository.list(undefined, true);
  const byId = new Map<string, VisibleModule>();
  for (const row of allActive) {
    if (row.sectionSlug !== SYSTEM_SECTION_SLUG) byId.set(row.id, toVisible(row));
  }
  for (const row of assigned) {
    if (row.sectionSlug === SYSTEM_SECTION_SLUG) byId.set(row.id, toVisible(row));
  }
  return [...byId.values()];
}

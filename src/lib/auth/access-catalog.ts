import { PERMISSIONS } from "./permission-catalog";
import {
  ACCESS_SCOPE_LEVELS,
  ACCESS_SCOPE_LEVEL_META,
  CRM_ROLE_DEFINITIONS,
  type AccessScopeLevel,
} from "./crm-roles";

/** Shared Access Control / Teams catalog helpers — avoid duplicating route handlers. */

export function listScopeCatalog(): Array<{
  level: AccessScopeLevel;
  label: string;
  description: string;
  example: string;
}> {
  return ACCESS_SCOPE_LEVELS.map((level) => ({
    level,
    ...ACCESS_SCOPE_LEVEL_META[level],
  }));
}

export function listPermissionCatalog(): Array<{ key: string; description: string }> {
  return PERMISSIONS.map((p) => ({ key: p.key, description: p.description }));
}

export function listRoleCatalog() {
  return CRM_ROLE_DEFINITIONS;
}

export function enrichRoleWithCatalog<T extends { roleName: string }>(role: T) {
  const def = CRM_ROLE_DEFINITIONS.find((r) => r.roleName === role.roleName);
  return {
    ...role,
    category: def?.category ?? null,
    defaultScope: def?.defaultScope ?? null,
  };
}

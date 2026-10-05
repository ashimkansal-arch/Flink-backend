import { isTeamMemberRoleModulePath, TEAM_MEMBERS_PATH } from "../team-member-role-modules";

/** Permission keys granted when a role is assigned a CRM module path. */
const PATH_PERMISSIONS: Record<string, readonly string[]> = {
  "/": ["dashboard:read"],
  "/manage-team-members": ["admins:*"],
  "/customers": ["customers:read"],
  "/bookings": ["bookings:*"],
  "/live-orders": ["bookings:*"],
  "/services": ["categories:*"],
  "/sub-services": ["categories:*"],
  "/packages": ["packages:*"],
  "/workers": ["providers:*"],
  "/workers/assigned": ["providers:*"],
  "/providers/offline-requests": ["providers:*"],
  "/wallet": ["payments:*", "payouts:*"],
  "/reviews": ["bookings:*"],
  "/coupons": ["coupons:*"],
  "/geofencing": ["geofences:*"],
  "/cities": ["dashboard:read"],
  "/admin-roles": ["admins:*"],
  "/admin-modules": ["admins:*"],
  "/audit-logs": ["audit:read"],
  "/settings": ["settings:update"],
  "/legal-support": ["legal-support:update"],
  "/reports": ["dashboard:read"],
};

export function permissionsForModulePaths(paths: string[]): string[] {
  const keys = new Set<string>();
  for (const path of paths) {
    const mapped = PATH_PERMISSIONS[path] ?? (isTeamMemberRoleModulePath(path) ? PATH_PERMISSIONS[TEAM_MEMBERS_PATH] : undefined);
    for (const key of mapped ?? []) keys.add(key);
  }
  return [...keys];
}

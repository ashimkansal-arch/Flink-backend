// Shared permission catalog — seeded into admin_permissions and used to validate
// `permissions` on create/update admin. Keys are what FE should send (plus "all" → "*").
export const PERMISSIONS = [
  { key: "*", description: "All permissions (super admin)" },

  // Access Control (Super Admin platform config)
  { key: "access:read", description: "Can view Access Control (teams, roles, policies, audit)" },
  { key: "access:write", description: "Can create/update Access Control configuration" },
  { key: "access:*", description: "Full Access Control administration" },
  { key: "policies:*", description: "Full policy management (visibility, approval, workflow, SLA)" },
  { key: "audit:read", description: "Can read audit logs" },

  { key: "teams:read", description: "Can list CRM team members (admins / staff)" },
  { key: "teams:create", description: "Can create CRM team members" },
  { key: "teams:update", description: "Can update CRM team members and reset passwords" },
  { key: "teams:delete", description: "Can disable CRM team members" },
  { key: "teams:*", description: "Full CRM team member management" },
  { key: "admins:read", description: "Can read other admins (legacy alias of teams:read)" },
  { key: "dashboard:read", description: "Can view dashboard stats and graphs" },
  { key: "admins:*", description: "Full admin-user access (legacy alias of teams:*)" },
  { key: "users:approve", description: "Can approve users" },
  { key: "providers:create", description: "Can create providers" },
  { key: "providers:read", description: "Can list and view providers" },
  { key: "providers:update", description: "Can update providers, status, and reset device" },
  { key: "providers:delete", description: "Can soft-delete providers" },
  { key: "bookings:*", description: "Full booking access" },
  { key: "bookings:read", description: "Read bookings" },
  { key: "bookings:override", description: "Override booking status" },
  { key: "booking.view", description: "View bookings (atomic)" },
  { key: "booking.assign", description: "Assign bookings (atomic)" },
  { key: "booking.reassign", description: "Reassign bookings (atomic)" },
  { key: "booking.cancel", description: "Cancel bookings (atomic)" },
  { key: "providers:*", description: "Full provider access" },
  { key: "supervisors:read", description: "Can list and view supervisors" },
  { key: "supervisors:create", description: "Can create supervisors" },
  { key: "supervisors:update", description: "Can update supervisors and reset passwords" },
  { key: "supervisors:delete", description: "Can disable supervisors" },
  { key: "supervisors:*", description: "Full supervisor access" },
  { key: "assignments:*", description: "Full assignment access" },
  { key: "customers:read", description: "Read customer records" },
  { key: "wallet:credit:limited", description: "Issue bounded wallet credit" },
  { key: "payments:*", description: "Full payments access" },
  { key: "payouts:*", description: "Full payouts access" },
  { key: "refund.request", description: "Request a refund (atomic)" },
  { key: "refund.approve", description: "Approve a refund (atomic)" },
  { key: "refund.execute", description: "Execute an approved refund (atomic)" },
  { key: "job.view", description: "View jobs (atomic)" },
  { key: "job.accept", description: "Accept assigned jobs (atomic)" },
  { key: "job.start", description: "Start jobs (atomic)" },
  { key: "job.complete", description: "Complete jobs (atomic)" },
  { key: "categories:read", description: "Can read categories and sub-categories" },
  { key: "categories:create", description: "Can create categories and sub-categories" },
  { key: "categories:update", description: "Can update categories and sub-categories" },
  { key: "categories:delete", description: "Can delete categories and sub-categories" },
  { key: "categories:*", description: "Full category and sub-category access" },
  { key: "packages:read", description: "Can list and view recommended service packages" },
  { key: "packages:create", description: "Can create recommended service packages" },
  { key: "packages:update", description: "Can update recommended service packages" },
  { key: "packages:delete", description: "Can delete recommended service packages" },
  { key: "packages:*", description: "Full recommended service package management" },
  { key: "coupons:read", description: "Can list and view coupons" },
  { key: "coupons:create", description: "Can create coupons" },
  { key: "coupons:update", description: "Can update coupons and toggle active" },
  { key: "coupons:delete", description: "Can delete coupons" },
  { key: "coupons:*", description: "Full coupon management" },
  { key: "role.configure", description: "Can configure CRM roles and permissions" },
  { key: "legal-support:update", description: "Can update Legal & Support content" },
  { key: "geofences:read", description: "Can list and view geofence zones" },
  { key: "geofences:create", description: "Can create geofence zones" },
  { key: "geofences:update", description: "Can update and toggle geofence zones" },
  { key: "geofences:delete", description: "Can delete geofence zones and reassign workers" },
  { key: "geofences:*", description: "Full geofence zone management" },
] as const;

const PERMISSION_KEYS = new Set<string>(PERMISSIONS.map((p) => p.key));

export const DEFAULT_ASSIGNABLE_ROLE = "crm_admin";

export function normalizePermissionKey(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const key = trimmed === "all" ? "*" : trimmed;
  if (!PERMISSION_KEYS.has(key)) throw new Error("UNKNOWN_PERMISSION");
  return key;
}

/** Assignable on team member create/update. Role is required on create. */
export function normalizeRoleName(raw?: string): string {
  if (!raw || !raw.trim()) throw new Error("ROLE_REQUIRED");
  const name = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (name === "super_admin" || name === "all") throw new Error("UNKNOWN_ROLE");
  return name;
}

/** When permissions omitted, caller should pass role defaults — empty list means none. */
export function normalizePermissionList(permissions?: string[], fallbackKeys?: string[]): string[] {
  const source =
    permissions && permissions.length > 0
      ? permissions
      : fallbackKeys && fallbackKeys.length > 0
        ? fallbackKeys
        : ["dashboard:read"];
  return [...new Set(source.map(normalizePermissionKey))];
}

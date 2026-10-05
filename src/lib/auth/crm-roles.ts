/** CRM access scopes — independent of role (PRD §4). */
export const ACCESS_SCOPE_LEVELS = [
  "global",
  "business_unit",
  "city",
  "zone",
  "team",
  "assigned",
  "self",
] as const;

export type AccessScopeLevel = (typeof ACCESS_SCOPE_LEVELS)[number];

export const ACCESS_SCOPE_LEVEL_META: Record<
  AccessScopeLevel,
  { label: string; description: string; example: string }
> = {
  global: {
    label: "Global",
    description: "All permitted business data",
    example: "Operations Head",
  },
  business_unit: {
    label: "Business Unit",
    description: "All cities within a business unit",
    example: "Home Services Ops",
  },
  city: {
    label: "City",
    description: "Records in one city",
    example: "Bangalore City Manager",
  },
  zone: {
    label: "Zone",
    description: "Records within selected zones",
    example: "Whitefield Zone Manager",
  },
  team: {
    label: "Team",
    description: "Records owned by a team",
    example: "Support Team A",
  },
  assigned: {
    label: "Assigned",
    description: "Records explicitly assigned to user",
    example: "Support Agent",
  },
  self: {
    label: "Self",
    description: "User-owned records/actions",
    example: "Individual operator",
  },
};

/** Role categories from CRM PRD §5. */
export const ROLE_CATEGORIES = [
  "platform",
  "operations",
  "customer",
  "partner",
  "quality",
  "finance",
  "growth",
  "analytics",
] as const;

export type RoleCategory = (typeof ROLE_CATEGORIES)[number];

export type CrmRoleDefinition = {
  roleName: string;
  category: RoleCategory;
  description: string;
  defaultScope: AccessScopeLevel;
  /** Catalog permission keys granted to this role by default. */
  permissions: string[];
};

/**
 * Recommended CRM roles (PRD §5 / §7).
 * `admin` is kept as a legacy alias of `crm_admin` for existing data.
 * `super_admin` is platform-only and not assignable via team APIs.
 */
export const CRM_ROLE_DEFINITIONS: CrmRoleDefinition[] = [
  {
    roleName: "crm_admin",
    category: "platform",
    description: "CRM configuration & governance",
    defaultScope: "global",
    permissions: ["teams:*", "admins:*", "supervisors:*", "categories:*", "coupons:*", "geofences:*", "dashboard:read", "role.configure", "access:*", "policies:*", "audit:read"],
  },
  {
    roleName: "business_admin",
    category: "platform",
    description: "Runs the business — services, teams, operating setup",
    defaultScope: "global",
    permissions: ["access:read", "access:write", "policies:*", "categories:*", "coupons:*", "geofences:*", "dashboard:read", "providers:read", "teams:read"],
  },
  {
    roleName: "city_ops_manager",
    category: "operations",
    description: "Runs a city — bookings, workforce, exceptions, SLA",
    defaultScope: "city",
    permissions: [
      "dashboard:read",
      "bookings:*",
      "booking.view",
      "booking.assign",
      "booking.reassign",
      "providers:*",
      "assignments:*",
      "customers:read",
      "geofences:*",
      "refund.approve",
    ],
  },
  {
    roleName: "dispatcher",
    category: "operations",
    description: "Assigns work — eligible providers within scope",
    defaultScope: "team",
    permissions: ["booking.view", "booking.assign", "booking.reassign", "providers:read", "assignments:*", "job.view"],
  },
  {
    roleName: "auditor",
    category: "analytics",
    description: "Investigates what happened — read/audit visibility",
    defaultScope: "global",
    permissions: ["audit:read", "access:read", "dashboard:read", "bookings:read", "customers:read", "providers:read"],
  },
  {
    roleName: "admin",
    category: "platform",
    description: "Legacy day-to-day platform admin (alias of CRM Admin)",
    defaultScope: "global",
    permissions: [
      "teams:*",
      "admins:*",
      "dashboard:read",
      "providers:*",
      "supervisors:*",
      "categories:*",
      "coupons:*",
      "geofences:*",
      "bookings:*",
      "access:read",
    ],
  },
  {
    roleName: "operations_head",
    category: "operations",
    description: "Overall operations leadership",
    defaultScope: "global",
    permissions: ["dashboard:read", "bookings:*", "providers:*", "assignments:*", "customers:read", "geofences:*"],
  },
  {
    roleName: "city_manager",
    category: "operations",
    description: "City performance and operational approvals",
    defaultScope: "city",
    permissions: ["dashboard:read", "bookings:*", "providers:*", "assignments:*", "customers:read", "geofences:*"],
  },
  {
    roleName: "zone_manager",
    category: "operations",
    description: "Zone operations and operational actions",
    defaultScope: "zone",
    permissions: ["dashboard:read", "bookings:*", "providers:*", "assignments:*", "geofences:*"],
  },
  {
    roleName: "operations_executive",
    category: "operations",
    description: "Day-to-day operations execution",
    defaultScope: "team",
    permissions: ["bookings:read", "bookings:override", "providers:read", "assignments:*"],
  },
  {
    roleName: "customer_support_head",
    category: "customer",
    description: "Customer support leadership",
    defaultScope: "global",
    permissions: ["customers:read", "bookings:*", "wallet:credit:limited"],
  },
  {
    roleName: "support_lead",
    category: "customer",
    description: "Support team lead — refund approvals within limits",
    defaultScope: "team",
    permissions: ["customers:read", "bookings:read", "bookings:override", "wallet:credit:limited"],
  },
  {
    roleName: "support_agent",
    category: "customer",
    description: "Customer resolution on assigned records",
    defaultScope: "assigned",
    permissions: ["customers:read", "bookings:read", "wallet:credit:limited"],
  },
  {
    roleName: "partner_operations_head",
    category: "partner",
    description: "Partner / expert operations leadership",
    defaultScope: "global",
    permissions: ["providers:*", "supervisors:*", "assignments:*", "dashboard:read"],
  },
  {
    roleName: "partner_manager",
    category: "partner",
    description: "Partner operations at city/zone",
    defaultScope: "city",
    permissions: ["providers:*", "supervisors:*", "assignments:*"],
  },
  {
    roleName: "partner_executive",
    category: "partner",
    description: "Partner / expert field operations",
    defaultScope: "zone",
    permissions: ["providers:read", "providers:update", "supervisors:read", "assignments:*"],
  },
  {
    roleName: "quality_head",
    category: "quality",
    description: "Quality & complaints leadership",
    defaultScope: "global",
    permissions: ["customers:read", "bookings:read", "providers:read"],
  },
  {
    roleName: "quality_manager",
    category: "quality",
    description: "Quality decisions at city / global",
    defaultScope: "city",
    permissions: ["customers:read", "bookings:read", "providers:read"],
  },
  {
    roleName: "quality_executive",
    category: "quality",
    description: "Quality case execution",
    defaultScope: "assigned",
    permissions: ["customers:read", "bookings:read"],
  },
  {
    roleName: "finance_head",
    category: "finance",
    description: "Financial operations leadership",
    defaultScope: "global",
    permissions: ["payments:*", "payouts:*", "dashboard:read"],
  },
  {
    roleName: "finance_manager",
    category: "finance",
    description: "Refund and payout approvals",
    defaultScope: "global",
    permissions: ["payments:*", "payouts:*"],
  },
  {
    roleName: "finance_executive",
    category: "finance",
    description: "Financial operations execution",
    defaultScope: "team",
    permissions: ["payments:*", "payouts:*"],
  },
  {
    roleName: "growth_manager",
    category: "growth",
    description: "CRM / growth management",
    defaultScope: "global",
    permissions: ["customers:read", "dashboard:read", "coupons:*"],
  },
  {
    roleName: "growth_executive",
    category: "growth",
    description: "CRM / growth execution",
    defaultScope: "team",
    permissions: ["customers:read", "coupons:read"],
  },
  {
    roleName: "business_analyst",
    category: "analytics",
    description: "Reporting and analytics — no operational actions",
    defaultScope: "global",
    permissions: ["dashboard:read", "bookings:read", "customers:read", "providers:read"],
  },
  {
    roleName: "readonly_user",
    category: "analytics",
    description: "Read-only CRM access",
    defaultScope: "global",
    permissions: ["dashboard:read", "bookings:read", "customers:read"],
  },
];

export function defaultScopeForRole(roleName: string): AccessScopeLevel {
  const found = CRM_ROLE_DEFINITIONS.find((r) => r.roleName === roleName);
  return found?.defaultScope ?? "global";
}

export function defaultPermissionsForRole(roleName: string): string[] {
  const found = CRM_ROLE_DEFINITIONS.find((r) => r.roleName === roleName);
  return found?.permissions ? [...found.permissions] : ["dashboard:read"];
}

/** Role category for CRM nav/feature gates. `super_admin` is always platform. */
export function categoryForRole(roleName: string | null | undefined): RoleCategory | null {
  if (!roleName) return null;
  if (roleName === "super_admin") return "platform";
  return CRM_ROLE_DEFINITIONS.find((r) => r.roleName === roleName)?.category ?? null;
}

export function roleDisplayLabel(roleName: string): string {
  return roleName
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

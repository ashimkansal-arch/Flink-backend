export const CRM_SCREENS = [
  { name: "Dashboard", path: "/", slug: "dashboard", icon: "LayoutDashboard" },
  { name: "Manage team members", path: "/manage-team-members", slug: "manage-team-members", icon: "UserCog" },
  { name: "Customers", path: "/customers", slug: "customers", icon: "ContactRound" },
  { name: "Bookings", path: "/bookings", slug: "bookings", icon: "CalendarDays" },
  { name: "Services", path: "/services", slug: "services", icon: "Layers" },
  { name: "Sub services", path: "/sub-services", slug: "sub-services", icon: "ListTree" },
  { name: "Packages", path: "/packages", slug: "packages", icon: "Package" },
  { name: "Workers · All", path: "/workers", slug: "workers", icon: "Users" },
  { name: "Workers · Assigned", path: "/workers/assigned", slug: "workers-assigned", icon: "Users" },
  { name: "Offline requests", path: "/providers/offline-requests", slug: "providers-offline-requests", icon: "Clock" },
  { name: "Settings", path: "/settings", slug: "settings", icon: "Settings" },
  { name: "Live Orders", path: "/live-orders", slug: "live-orders", icon: "Activity" },
  { name: "Payments", path: "/payments", slug: "payments", icon: "CreditCard" },
  { name: "Revenue", path: "/revenue", slug: "revenue", icon: "TrendingUp" },
  { name: "Wallet", path: "/wallet", slug: "wallet", icon: "Wallet" },
  { name: "GeoFencing", path: "/geofencing", slug: "geofencing", icon: "Map" },
  { name: "Regions", path: "/regions", slug: "regions", icon: "Globe" },
  { name: "Cities", path: "/cities", slug: "cities", icon: "Building2" },
  { name: "Complaints", path: "/complaints", slug: "complaints", icon: "AlertOctagon" },
  { name: "Support Tickets", path: "/support", slug: "support", icon: "LifeBuoy" },
  { name: "Reviews", path: "/reviews", slug: "reviews", icon: "Star" },
  { name: "Coupons", path: "/coupons", slug: "coupons", icon: "TicketPercent" },
  { name: "Notifications", path: "/notifications", slug: "notifications", icon: "Bell" },
  { name: "Reports", path: "/reports", slug: "reports", icon: "FileBarChart" },
  { name: "SEO & Keywords", path: "/seo", slug: "seo", icon: "Search" },
  { name: "Admin Roles", path: "/admin-roles", slug: "admin-roles", icon: "Shield" },
  { name: "Modules", path: "/admin-modules", slug: "admin-modules", icon: "Layers" },
  { name: "Audit Logs", path: "/audit-logs", slug: "audit-logs", icon: "ScrollText" },
  { name: "Legal & Support", path: "/legal-support", slug: "legal-support", icon: "Scale" },
] as const;

export type CrmScreenPath = (typeof CRM_SCREENS)[number]["path"];

export const CRM_SCREEN_PATHS = CRM_SCREENS.map((screen) => screen.path) as [
  CrmScreenPath,
  ...CrmScreenPath[],
];

const SLUG_ALIASES: Record<string, string> = {
  "admin-users": "/manage-team-members",
  "manage-team": "/manage-team-members",
  "team-members": "/manage-team-members",
  modules: "/admin-modules",
  supervisors: "/manage-team-members",
  providers: "/workers",
  "provider-kyc": "/workers/kyc",
  "providers-kyc": "/workers/kyc",
  "workers-kyc": "/workers/kyc",
  "offline-requests": "/providers/offline-requests",
  "seo-keywords": "/seo",
  "support-tickets": "/support",
};

export function screenByPath(path: string) {
  return CRM_SCREENS.find((screen) => screen.path === path) ?? null;
}

export function pathForModuleSlug(slug: string) {
  const match = CRM_SCREENS.find((screen) => screen.slug === slug);
  if (match) return match.path;
  return SLUG_ALIASES[slug] ?? null;
}

export function resolveCrmScreen(path: string) {
  const screen = screenByPath(path);
  if (!screen) throw new Error("UNKNOWN_PATH");
  return screen;
}

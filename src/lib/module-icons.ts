export const DEFAULT_MODULE_ICON = "Layers";

export const MODULE_ICONS = [
  "Activity",
  "AlertOctagon",
  "Bell",
  "Boxes",
  "Briefcase",
  "Building2",
  "CalendarCheck",
  "CalendarDays",
  "ClipboardCheck",
  "Clock",
  "ContactRound",
  "CreditCard",
  "FileBarChart",
  "Globe",
  "Layers",
  "LayoutDashboard",
  "LifeBuoy",
  "ListTree",
  "Map",
  "Package",
  "Scale",
  "ScrollText",
  "Search",
  "Settings",
  "Shield",
  "Star",
  "TicketPercent",
  "TrendingUp",
  "User",
  "UserCog",
  "Users",
  "Wallet",
  "Wrench",
] as const;

export type ModuleIconName = (typeof MODULE_ICONS)[number];

export const MODULE_ICON_NAMES = MODULE_ICONS as unknown as [ModuleIconName, ...ModuleIconName[]];

export function resolveModuleIcon(name?: string | null): ModuleIconName {
  const trimmed = name?.trim();
  if (!trimmed) return DEFAULT_MODULE_ICON;
  if ((MODULE_ICONS as readonly string[]).includes(trimmed)) return trimmed as ModuleIconName;
  throw new Error("UNKNOWN_ICON");
}

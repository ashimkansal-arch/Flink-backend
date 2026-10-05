export const SIDEBAR_SECTIONS = [
  { name: "Operations", slug: "operations", displayOrder: 10 },
  { name: "Catalog", slug: "catalog", displayOrder: 100 },
  { name: "Finance", slug: "finance", displayOrder: 200 },
  { name: "Geo", slug: "geo", displayOrder: 300 },
  { name: "Engagement", slug: "engagement", displayOrder: 400 },
  { name: "System", slug: "system", displayOrder: 900 },
] as const;

export const SYSTEM_SECTION_SLUG = "system";

export type SidebarSectionName = (typeof SIDEBAR_SECTIONS)[number]["name"];

export const SIDEBAR_SECTION_NAMES = SIDEBAR_SECTIONS.map((section) => section.name) as [
  SidebarSectionName,
  ...SidebarSectionName[],
];

export function resolveSidebarSection(name: string): {
  sectionName: string;
  sectionSlug: string;
  displayOrder: number;
} {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("SECTION_REQUIRED");
  const found = SIDEBAR_SECTIONS.find((section) => section.name === trimmed);
  if (!found) throw new Error("UNKNOWN_SECTION");
  return { sectionName: found.name, sectionSlug: found.slug, displayOrder: found.displayOrder };
}

export function sidebarSectionDisplayOrder(sectionSlug: string) {
  if (!sectionSlug) return 0;
  return SIDEBAR_SECTIONS.find((section) => section.slug === sectionSlug)?.displayOrder ?? 0;
}

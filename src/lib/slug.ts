function slugifyKey(value: string, separator: "_" | "-", max: number): string {
  const escaped = separator === "_" ? "_+" : "-+";
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`^${escaped}|${escaped}$`, "g"), "")
    .slice(0, max);
  if (!slug) throw new Error("INVALID_SLUG");
  return slug;
}

export const slugifyRole = (value: string) => slugifyKey(value, "_", 60);
export const slugifyModule = (value: string) => slugifyKey(value, "-", 80);

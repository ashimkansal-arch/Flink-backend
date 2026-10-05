export function searchTerm(q?: string): string | undefined {
  const term = q?.trim();
  return term || undefined;
}

export function nameEmailPhoneSearchOr(term: string) {
  const or: Array<{
    fullName?: { contains: string; mode: "insensitive" };
    email?: { contains: string; mode: "insensitive" };
    phoneNumber?: { contains: string };
  }> = [
    { fullName: { contains: term, mode: "insensitive" } },
    { email: { contains: term, mode: "insensitive" } },
  ];

  const phoneDigits = term.replace(/\D/g, "");
  if (phoneDigits.length >= 3) {
    or.push({ phoneNumber: { contains: phoneDigits } });
  }

  return or;
}

export function nameSlugSearchOr(term: string) {
  return [
    { name: { contains: term, mode: "insensitive" as const } },
    { slug: { contains: term, mode: "insensitive" as const } },
  ];
}

export function roleSearchOr(term: string) {
  return [
    { roleName: { contains: term, mode: "insensitive" as const } },
    { name: { contains: term, mode: "insensitive" as const } },
    { description: { contains: term, mode: "insensitive" as const } },
  ];
}

export function applyNameEmailPhoneSearch<T extends { OR?: unknown }>(where: T, q?: string): T {
  const term = searchTerm(q);
  if (term) where.OR = nameEmailPhoneSearchOr(term);
  return where;
}

export function applyNameSlugSearch<T extends { OR?: unknown }>(where: T, q?: string): T {
  const term = searchTerm(q);
  if (term) where.OR = nameSlugSearchOr(term);
  return where;
}

export function applyRoleSearch<T extends { OR?: unknown }>(where: T, q?: string): T {
  const term = searchTerm(q);
  if (term) where.OR = roleSearchOr(term);
  return where;
}

export function applyNameSlugSearchWithChildren<T extends { OR?: unknown }>(where: T, q?: string): T {
  const term = searchTerm(q);
  if (term) {
    const textOr = nameSlugSearchOr(term);
    where.OR = [...textOr, { children: { some: { OR: textOr } } }];
  }
  return where;
}

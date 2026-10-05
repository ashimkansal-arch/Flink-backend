export const categoryRefSelect = { id: true, name: true, slug: true } as const;

export const coverageZoneRefSelect = {
  id: true,
  zoneName: true,
  city: true,
  isActive: true,
  launchedAt: true,
} as const;

export const adminUserRefSelect = {
  id: true,
  fullName: true,
  email: true,
  role: { select: { name: true, roleName: true } },
} as const;

export const supervisorRefSelect = {
  id: true,
  fullName: true,
  email: true,
  phoneNumber: true,
  category: { select: categoryRefSelect },
} as const;

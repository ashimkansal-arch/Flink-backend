import { db, readDb } from "../lib/prisma";
import type { Prisma } from "../generated/prisma/client";
import { applyNameSlugSearch } from "../lib/search";

const moduleInclude = {
  roleModules: { include: { role: { select: { id: true, roleName: true, name: true } } } },
} as const;

export const adminModuleRepository = {
  list(q?: string, activeOnly = false) {
    const where = applyNameSlugSearch<Prisma.AdminModuleWhereInput>(
      activeOnly ? { isActive: true } : {},
      q,
    );
    return readDb.adminModule.findMany({
      where,
      include: moduleInclude,
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    });
  },

  findById(id: string) {
    return readDb.adminModule.findUnique({ where: { id }, include: moduleInclude });
  },

  findBySlug(slug: string) {
    return readDb.adminModule.findUnique({ where: { slug }, include: moduleInclude });
  },

  findByPath(path: string) {
    return readDb.adminModule.findUnique({ where: { path }, include: moduleInclude });
  },

  findIds(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return readDb.adminModule.findMany({ where: { id: { in: ids } }, select: { id: true } });
  },

  async nextDisplayOrder(sectionSlug: string, fallback = 0) {
    const row = await readDb.adminModule.aggregate({
      where: { sectionSlug },
      _max: { displayOrder: true },
    });
    const max = row._max.displayOrder;
    if (max == null) return fallback;
    return max + 10;
  },

  create(data: {
    name: string;
    slug: string;
    sectionName: string;
    sectionSlug: string;
    path: string;
    icon?: string;
    displayOrder?: number;
    description?: string;
    isActive?: boolean;
  }) {
    return db.adminModule.create({ data, include: moduleInclude });
  },

  update(
    id: string,
    data: {
      name?: string;
      slug?: string;
      sectionName?: string;
      sectionSlug?: string;
      path?: string;
      icon?: string;
      displayOrder?: number;
      description?: string | null;
      isActive?: boolean;
    },
  ) {
    return db.adminModule.update({ where: { id }, data, include: moduleInclude });
  },

  listActiveForRole(roleName: string) {
    return readDb.adminModule.findMany({
      where: {
        isActive: true,
        roleModules: { some: { role: { roleName, isActive: true } } },
      },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    });
  },

  async setRoles(moduleId: string, roleIds: string[]) {
    await db.$transaction([
      db.roleModule.deleteMany({
        where: { moduleId, role: { roleName: { not: "super_admin" } } },
      }),
      ...(roleIds.length > 0
        ? [db.roleModule.createMany({ data: roleIds.map((roleId) => ({ roleId, moduleId })) })]
        : []),
    ]);
  },
};

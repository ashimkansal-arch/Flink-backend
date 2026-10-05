import { db, readDb } from "../lib/prisma";
import type { Prisma } from "../generated/prisma/client";
import { applyRoleSearch } from "../lib/search";

const roleInclude = {
  rolePermissions: { include: { permission: true } },
  roleModules: { include: { module: true } },
  _count: { select: { adminUsers: true } },
} as const;

export const adminRoleRepository = {
  list(q?: string, includeSuperAdmin = false) {
    const where = applyRoleSearch<Prisma.AdminRoleWhereInput>(
      includeSuperAdmin ? {} : { roleName: { not: "super_admin" } },
      q,
    );

    return readDb.adminRole.findMany({
      where,
      include: roleInclude,
      orderBy: { name: "asc" },
    });
  },

  findIds(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return readDb.adminRole.findMany({ where: { id: { in: ids } }, select: { id: true, roleName: true } });
  },

  findById(id: string) {
    return readDb.adminRole.findUnique({ where: { id }, include: roleInclude });
  },

  findByName(roleName: string) {
    return readDb.adminRole.findUnique({ where: { roleName }, include: roleInclude });
  },

  create(data: { roleName: string; name: string; description?: string; isActive?: boolean; isAdmin?: boolean }) {
    return db.adminRole.create({ data, include: roleInclude });
  },

  update(
    id: string,
    data: { roleName?: string; name?: string; description?: string | null; isActive?: boolean; isAdmin?: boolean },
  ) {
    return db.adminRole.update({ where: { id }, data, include: roleInclude });
  },

  async setPermissions(roleId: string, permissionIds: string[]) {
    await db.$transaction([
      db.rolePermission.deleteMany({ where: { roleId } }),
      ...(permissionIds.length > 0
        ? [
            db.rolePermission.createMany({
              data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
            }),
          ]
        : []),
    ]);
  },

  async setModules(roleId: string, moduleIds: string[]) {
    await db.$transaction([
      db.roleModule.deleteMany({ where: { roleId } }),
      ...(moduleIds.length > 0
        ? [db.roleModule.createMany({ data: moduleIds.map((moduleId) => ({ roleId, moduleId })) })]
        : []),
    ]);
  },

  delete(id: string) {
    return db.adminRole.delete({ where: { id } });
  },
};

export const adminPermissionRepository = {
  upsertByKey(permissionKey: string, description?: string) {
    return db.adminPermission.upsert({
      where: { permissionKey },
      update: description ? { description } : {},
      create: { permissionKey, description },
    });
  },
};

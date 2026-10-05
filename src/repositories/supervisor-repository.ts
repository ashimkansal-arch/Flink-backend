import { db, readDb } from "../lib/prisma";
import { categoryRefSelect } from "../lib/prisma-selects";
import type { Prisma } from "../generated/prisma/client";
import { applyNameEmailPhoneSearch } from "../lib/search";

const supervisorInclude = {
  category: { select: categoryRefSelect },
  assignedToAdmin: { select: { id: true, fullName: true, email: true } },
} as const;

const supervisorListInclude = {
  ...supervisorInclude,
  _count: {
    select: {
      registeredProviders: { where: { status: { not: "deleted" } } },
    },
  },
} as const;

function buildListWhere(
  q?: string,
  ownedByAdminIds?: string[],
  ids?: string[],
): Prisma.SupervisorWhereInput {
  const searched = applyNameEmailPhoneSearch<Prisma.SupervisorWhereInput>(
    { status: { not: "deleted" } },
    q,
  );
  const extra: Prisma.SupervisorWhereInput[] = [];
  if (ownedByAdminIds) {
    extra.push({
      OR: [{ createdBy: { in: ownedByAdminIds } }, { assignedToId: { in: ownedByAdminIds } }],
    });
  }
  if (ids) extra.push({ id: { in: ids } });
  if (extra.length === 0) return searched;
  return { AND: [searched, ...extra] };
}

export const supervisorRepository = {
  findById(id: string) {
    return readDb.supervisor.findUnique({ where: { id }, include: supervisorInclude });
  },

  findByEmail(email: string) {
    return readDb.supervisor.findUnique({ where: { email }, include: supervisorInclude });
  },

  findByPhone(phoneNumber: string) {
    return readDb.supervisor.findUnique({ where: { phoneNumber } });
  },

  list(page: { skip: number; take: number }, q?: string, ownedByAdminIds?: string[], ids?: string[]) {
    const where = buildListWhere(q, ownedByAdminIds, ids);
    return Promise.all([
      readDb.supervisor.findMany({
        where,
        include: supervisorListInclude,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
      }),
      readDb.supervisor.count({ where }),
    ]);
  },

  create(data: {
    fullName: string;
    email: string;
    phoneNumber: string;
    passwordHash: string;
    categoryId: string;
    createdBy: string;
    assignedToId?: string | null;
  }) {
    return db.supervisor.create({ data, include: supervisorInclude });
  },

  update(
    id: string,
    data: {
      fullName?: string;
      email?: string;
      phoneNumber?: string;
      categoryId?: string;
      assignedToId?: string | null;
      status?: "active" | "inactive" | "suspended" | "deleted";
      passwordHash?: string;
      passwordResetRequired?: boolean;
    },
  ) {
    return db.supervisor.update({ where: { id }, data, include: supervisorInclude });
  },

  findAuditActors(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return readDb.supervisor.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true, email: true },
    });
  },

  findIdsMatchingName(q: string) {
    const term = q.trim();
    if (!term) return Promise.resolve([]);
    return readDb.supervisor.findMany({
      where: {
        OR: [
          { fullName: { contains: term, mode: "insensitive" } },
          { email: { contains: term, mode: "insensitive" } },
        ],
      },
      select: { id: true },
      take: 50,
    });
  },
};

import { db, readDb } from "../lib/prisma";
import type { Prisma } from "../generated/prisma/client";
import type { CatalogServiceSort } from "../lib/api-schemas";
import { categoryRefSelect } from "../lib/prisma-selects";
import { applyNameSlugSearch, applyNameSlugSearchWithChildren } from "../lib/search";

const orderBy = { displayOrder: "asc" as const };

export function rowsInOrder<T extends { id: string }>(ids: string[], rows: T[]) {
  const map = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = map.get(id);
    return row ? [row] : [];
  });
}

export function namedFromRows(ids: string[], rows: Array<{ id: string; name: string }>) {
  return rowsInOrder(ids, rows).map((row) => ({ id: row.id, name: row.name }));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidKeys(ids: string[]) {
  return [...new Set(ids.filter((id) => UUID_RE.test(id)))];
}

function findManyBySelect<S extends Prisma.ServiceCategorySelect>(ids: string[], select: S) {
  const uuids = uuidKeys(ids);
  if (uuids.length === 0) return Promise.resolve([]);
  return readDb.serviceCategory.findMany({ where: { id: { in: uuids } }, select });
}

const catalogSortBy = {
  popular: { bookings: { _count: "desc" } },
  high_to_low: { pricePaise: { sort: "desc", nulls: "last" } },
  low_to_high: { pricePaise: { sort: "asc", nulls: "last" } },
} as const satisfies Record<CatalogServiceSort, Prisma.ServiceCategoryOrderByWithRelationInput>;
const childStats = {
  _count: { select: { bookings: true } },
} as const;
const withChildren = {
  children: {
    orderBy,
    include: childStats,
  },
} as const;

async function countByActive(where: Prisma.ServiceCategoryWhereInput) {
  const byActive = await readDb.serviceCategory.groupBy({
    by: ["isActive"],
    where,
    _count: { _all: true },
  });
  const countFor = (isActive: boolean) =>
    byActive.find((row) => row.isActive === isActive)?._count._all ?? 0;
  const active = countFor(true);
  const inactive = countFor(false);
  return { total: active + inactive, active, inactive };
}

export const serviceCategoryRepository = {
  listActiveRoots() {
    return readDb.serviceCategory.findMany({
      where: { isActive: true, parentId: null },
      orderBy,
    });
  },

  findActiveRoot(id: string) {
    return readDb.serviceCategory.findFirst({
      where: { id, isActive: true, parentId: null },
      select: { id: true },
    });
  },

  listActiveChildren(parentId?: string, sort?: CatalogServiceSort, q?: string) {
    const where = applyNameSlugSearch<Prisma.ServiceCategoryWhereInput>(
      { isActive: true, parentId: parentId ?? { not: null } },
      q,
    );
    return readDb.serviceCategory.findMany({
      where,
      orderBy: sort ? [catalogSortBy[sort], orderBy] : [orderBy],
    });
  },

  findActiveById(id: string) {
    return readDb.serviceCategory.findUnique({
      where: { id, isActive: true },
    });
  },

  findById(id: string) {
    return readDb.serviceCategory.findUnique({
      where: { id },
      include: {
        ...withChildren,
        _count: { select: { bookings: true, children: true, planServices: true } },
      },
    });
  },

  findManyByIds(ids: string[]) {
    return findManyBySelect(ids, {
      ...categoryRefSelect,
      parentId: true,
      pricePaise: true,
      isActive: true,
      sessionMinutes: true,
      parent: { select: { id: true, slug: true } },
      _count: { select: { children: true } },
    });
  },

  findManySessionByIds(ids: string[]) {
    return findManyBySelect(ids, {
      ...categoryRefSelect,
      sessionMinutes: true,
      includedTasks: true,
    });
  },

  async findManyRefsByKeys(keys: string[]) {
    const unique = [...new Set(keys.filter(Boolean))];
    if (unique.length === 0) return [];
    const ids = unique.filter((key) => UUID_RE.test(key));
    const slugs = unique.filter((key) => !UUID_RE.test(key));
    const rows = await readDb.serviceCategory.findMany({
      where: {
        OR: [
          ...(ids.length ? [{ id: { in: ids } }] : []),
          ...(slugs.length ? [{ slug: { in: slugs } }] : []),
        ],
      },
      select: categoryRefSelect,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const bySlug = new Map(rows.map((row) => [row.slug, row]));
    const seen = new Set<string>();
    return unique.flatMap((key) => {
      const row = byId.get(key) ?? bySlug.get(key);
      if (!row || seen.has(row.id)) return [];
      seen.add(row.id);
      return [row];
    });
  },

  async namedInOrder(ids: string[]) {
    return namedFromRows(ids, await this.findManyByIds([...new Set(ids)]));
  },

  findBySlug(slug: string) {
    return readDb.serviceCategory.findUnique({ where: { slug } });
  },

  async nextDisplayOrder(parentId: string | null) {
    const max = await readDb.serviceCategory.aggregate({
      where: { parentId },
      _max: { displayOrder: true },
    });
    return Math.max(1, (max._max.displayOrder ?? 0) + 1);
  },

  listRoots(page: { skip: number; take: number }, q?: string) {
    const where = applyNameSlugSearchWithChildren<Prisma.ServiceCategoryWhereInput>({ parentId: null }, q);

    return Promise.all([
      readDb.serviceCategory.findMany({
        where,
        include: withChildren,
        orderBy,
        skip: page.skip,
        take: page.take,
      }),
      readDb.serviceCategory.count({ where }),
    ]);
  },

  async countRootStats() {
    const [roots, subcategories] = await Promise.all([
      countByActive({ parentId: null }),
      readDb.serviceCategory.count({ where: { parentId: { not: null } } }),
    ]);
    return { total: roots.total, active: roots.active, subcategories };
  },

  async countChildStats(parentId: string) {
    const [counts, top] = await Promise.all([
      countByActive({ parentId }),
      readDb.serviceCategory.findFirst({
        where: { parentId },
        orderBy: { bookings: { _count: "desc" } },
        select: { _count: { select: { bookings: true } } },
      }),
    ]);
    return { ...counts, mostSelling: top?._count.bookings ?? 0 };
  },

  listChildren(parentId: string, page: { skip: number; take: number }, q?: string) {
    const where = applyNameSlugSearch<Prisma.ServiceCategoryWhereInput>({ parentId }, q);

    return Promise.all([
      readDb.serviceCategory.findMany({
        where,
        orderBy,
        skip: page.skip,
        take: page.take,
        include: childStats,
      }),
      readDb.serviceCategory.count({ where }),
    ]);
  },

  create(data: Prisma.ServiceCategoryUncheckedCreateInput) {
    return db.serviceCategory.create({ data });
  },

  update(id: string, data: Prisma.ServiceCategoryUncheckedUpdateInput) {
    return db.serviceCategory.update({ where: { id }, data });
  },

  delete(id: string) {
    return db.serviceCategory.delete({ where: { id } });
  },
};

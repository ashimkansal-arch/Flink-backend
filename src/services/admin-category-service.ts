import { serviceCategoryRepository } from "../repositories/service-category-repository";
import { paginatedResult, paginationSkip, type SearchQuery } from "../lib/pagination";
import { paise } from "../lib/money";
import {
  deleteCatalogIconIfStored,
  isCatalogIconKey,
  normalizeStoredIconUrl,
  resolveCatalogIconDisplayUrl,
} from "../lib/catalog-icon";
import { slugifyModule } from "../lib/slug";

type CategoryRow = NonNullable<Awaited<ReturnType<typeof serviceCategoryRepository.findById>>>;

async function uniqueSlug(nameOrSlug: string, exceptId?: string): Promise<string> {
  const slug = slugifyModule(nameOrSlug);
  const existing = await serviceCategoryRepository.findBySlug(slug);
  if (existing && existing.id !== exceptId) throw new Error("SLUG_TAKEN");
  return slug;
}

async function categoryShape(row: {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  iconUrl: string | null;
  includedTasks: string[];
  excludedTasks: string[];
  isActive: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    iconUrl: row.iconUrl,
    iconDisplayUrl: await resolveCatalogIconDisplayUrl(row.iconUrl),
    includedTasks: row.includedTasks,
    excludedTasks: row.excludedTasks,
    isActive: row.isActive,
    displayOrder: row.displayOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function toSubcategoryDto(
  row: Parameters<typeof categoryShape>[0] & {
    parentId: string | null;
    pricePaise?: bigint | null;
    sessionMinutes?: number | null;
    _count?: { bookings?: number };
  },
) {
  return {
    ...(await categoryShape(row)),
    categoryId: row.parentId!,
    pricePaise: row.pricePaise == null ? null : paise(row.pricePaise),
    sessionMinutes: row.sessionMinutes ?? null,
    bookingCount: row._count?.bookings ?? 0,
  };
}

async function toCategoryDto(
  row: CategoryRow | Awaited<ReturnType<typeof serviceCategoryRepository.listRoots>>[0][number],
) {
  const children = "children" in row ? row.children : [];
  return {
    ...(await categoryShape(row)),
    subcategories: await Promise.all(children.map(toSubcategoryDto)),
  };
}

async function replaceCatalogIcon(previous: string | null, next: string | null | undefined) {
  if (next === undefined || previous === next) return;
  if (previous && isCatalogIconKey(previous)) {
    await deleteCatalogIconIfStored(previous);
  }
}

type CategoryFields = {
  name: string;
  slug?: string;
  description?: string | null;
  iconUrl?: string | null;
  includedTasks?: string[];
  excludedTasks?: string[];
  isActive?: boolean;
  displayOrder?: number;
  pricePaise?: number;
  sessionMinutes?: number;
};

function subcategoryWrite(input: Partial<CategoryFields>) {
  return {
    pricePaise: input.pricePaise != null ? BigInt(input.pricePaise) : undefined,
    sessionMinutes: input.sessionMinutes,
  };
}

async function requireNode(id: string, kind: "category" | "subcategory"): Promise<CategoryRow> {
  const row = await serviceCategoryRepository.findById(id);
  const isRoot = Boolean(row && !row.parentId);
  if (kind === "category" && (!row || !isRoot)) throw new Error("CATEGORY_NOT_FOUND");
  if (kind === "subcategory" && (!row || isRoot)) throw new Error("SUBCATEGORY_NOT_FOUND");
  return row!;
}

function writeFields(input: Partial<CategoryFields>, slug?: string) {
  return {
    name: input.name?.trim(),
    slug,
    description: input.description,
    iconUrl: normalizeStoredIconUrl(input.iconUrl),
    includedTasks: input.includedTasks,
    excludedTasks: input.excludedTasks,
    isActive: input.isActive,
    displayOrder: input.displayOrder,
  };
}

export const adminCategoryService = {
  async list(query: SearchQuery) {
    const [[rows, total], stats] = await Promise.all([
      serviceCategoryRepository.listRoots(paginationSkip(query), query.q),
      serviceCategoryRepository.countRootStats(),
    ]);
    return { ...paginatedResult(await Promise.all(rows.map(toCategoryDto)), total, query), stats };
  },

  async getById(id: string) {
    return toCategoryDto(await requireNode(id, "category"));
  },

  async create(input: CategoryFields) {
    const slug = await uniqueSlug(input.slug?.trim() || input.name);
    const displayOrder = input.displayOrder ?? (await serviceCategoryRepository.nextDisplayOrder(null));
    const row = await serviceCategoryRepository.create({
      ...writeFields(input, slug),
      name: input.name.trim(),
      slug,
      displayOrder,
      parentId: null,
    });
    return this.getById(row.id);
  },

  async update(id: string, input: Partial<CategoryFields>) {
    const existing = await requireNode(id, "category");
    const slug = input.slug != null ? await uniqueSlug(input.slug, id) : undefined;
    const fields = writeFields(input, slug);
    await serviceCategoryRepository.update(id, fields);
    await replaceCatalogIcon(existing.iconUrl, fields.iconUrl);
    return this.getById(id);
  },

  async remove(id: string) {
    const row = await requireNode(id, "category");
    if (row._count.children > 0) throw new Error("CATEGORY_HAS_SUBCATEGORIES");
    if (row._count.bookings > 0 || row._count.planServices > 0) throw new Error("CATEGORY_IN_USE");
    await serviceCategoryRepository.delete(id);
    await deleteCatalogIconIfStored(row.iconUrl);
  },

  async listSubcategories(categoryId: string, query: SearchQuery) {
    await requireNode(categoryId, "category");
    const [[rows, total], stats] = await Promise.all([
      serviceCategoryRepository.listChildren(categoryId, paginationSkip(query), query.q),
      serviceCategoryRepository.countChildStats(categoryId),
    ]);
    return { ...paginatedResult(await Promise.all(rows.map(toSubcategoryDto)), total, query), stats };
  },

  async getSubcategoryById(id: string) {
    return toSubcategoryDto(await requireNode(id, "subcategory"));
  },

  async createSubcategory(categoryId: string, input: CategoryFields) {
    await requireNode(categoryId, "category");
    const slug = await uniqueSlug(input.slug?.trim() || input.name);
    const displayOrder = input.displayOrder ?? (await serviceCategoryRepository.nextDisplayOrder(categoryId));
    const row = await serviceCategoryRepository.create({
      ...writeFields(input, slug),
      name: input.name.trim(),
      slug,
      displayOrder,
      parentId: categoryId,
      ...subcategoryWrite(input),
    });
    return this.getSubcategoryById(row.id);
  },

  async updateSubcategory(id: string, input: Partial<CategoryFields>) {
    const existing = await requireNode(id, "subcategory");
    const slug = input.slug != null ? await uniqueSlug(input.slug, id) : undefined;
    const fields = writeFields(input, slug);
    await serviceCategoryRepository.update(id, {
      ...fields,
      ...subcategoryWrite(input),
    });
    await replaceCatalogIcon(existing.iconUrl, fields.iconUrl);
    return this.getSubcategoryById(id);
  },

  async removeSubcategory(id: string) {
    const row = await requireNode(id, "subcategory");
    if (row._count.bookings > 0 || row._count.planServices > 0) throw new Error("CATEGORY_IN_USE");
    await serviceCategoryRepository.delete(id);
    await deleteCatalogIconIfStored(row.iconUrl);
  },
};

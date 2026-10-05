import { serviceCategoryRepository } from "../repositories/service-category-repository";
import { servicePlanRepository } from "../repositories/service-plan-repository";
import { paginatedResult, paginationSkip, type SearchQuery } from "../lib/pagination";
import { toAdminPackageDto } from "../lib/package-dto";
import { slugifyModule } from "../lib/slug";

export type PackageFields = {
  name: string;
  slug?: string;
  description?: string | null;
  pricePaise: number;
  includedTasks?: string[];
  excludedTasks?: string[];
  serviceIds: string[];
  durationMinutes?: number;
  isActive?: boolean;
  displayOrder?: number;
};

type PackageRow = NonNullable<Awaited<ReturnType<typeof servicePlanRepository.findById>>>;

async function requirePackage(id: string): Promise<PackageRow> {
  const row = await servicePlanRepository.findById(id);
  if (!row) throw new Error("PACKAGE_NOT_FOUND");
  return row;
}

async function uniqueSlug(nameOrSlug: string, exceptId?: string) {
  const slug = slugifyModule(nameOrSlug);
  const existing = await servicePlanRepository.findBySlug(slug);
  if (existing && existing.id !== exceptId) throw new Error("SLUG_TAKEN");
  return slug;
}

async function requireLeafServices(ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) throw new Error("SERVICES_REQUIRED");
  const rows = await serviceCategoryRepository.findManyByIds(unique);
  if (rows.length !== unique.length) throw new Error("SERVICE_NOT_FOUND");
  if (rows.some((row) => !row.parentId || row._count.children > 0)) throw new Error("PACKAGES_ONLY_ON_LEAF");
  return unique;
}

export const adminPackageService = {
  async list(query: SearchQuery) {
    const [[rows, total], stats] = await Promise.all([
      servicePlanRepository.list(paginationSkip(query), query.q),
      servicePlanRepository.countStats(),
    ]);
    return { ...paginatedResult(rows.map(toAdminPackageDto), total, query), stats };
  },

  async getById(id: string) {
    return toAdminPackageDto(await requirePackage(id));
  },

  async create(input: PackageFields) {
    const serviceIds = await requireLeafServices(input.serviceIds);
    const slug = await uniqueSlug(input.slug?.trim() || input.name);
    const displayOrder = input.displayOrder ?? (await servicePlanRepository.nextDisplayOrder());
    const row = await servicePlanRepository.create({
      name: input.name.trim(),
      slug,
      description: input.description ?? null,
      pricePaise: BigInt(input.pricePaise),
      includedTasks: input.includedTasks ?? [],
      excludedTasks: input.excludedTasks ?? [],
      serviceIds,
      durationMinutes: input.durationMinutes,
      isActive: input.isActive ?? true,
      displayOrder,
    });
    return toAdminPackageDto(row);
  },

  async update(id: string, input: Partial<PackageFields>) {
    await requirePackage(id);
    const serviceIds = input.serviceIds ? await requireLeafServices(input.serviceIds) : undefined;
    const slug =
      input.slug != null || input.name != null
        ? await uniqueSlug(input.slug?.trim() || input.name || "", id)
        : undefined;
    const row = await servicePlanRepository.update(id, {
      name: input.name?.trim(),
      slug,
      description: input.description,
      pricePaise: input.pricePaise != null ? BigInt(input.pricePaise) : undefined,
      includedTasks: input.includedTasks,
      excludedTasks: input.excludedTasks,
      serviceIds,
      durationMinutes: input.durationMinutes,
      isActive: input.isActive,
      displayOrder: input.displayOrder,
    });
    return toAdminPackageDto(row);
  },

  async remove(id: string) {
    const row = await requirePackage(id);
    if (row._count.bookings > 0) throw new Error("PACKAGE_IN_USE");
    await servicePlanRepository.delete(id);
  },
};

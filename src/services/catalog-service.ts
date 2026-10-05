import { serviceCategoryRepository } from "../repositories/service-category-repository";
import { servicePlanRepository, type ServicePlanWithServices } from "../repositories/service-plan-repository";
import { resolveCatalogIconDisplayUrl } from "../lib/catalog-icon";
import { toPlanDto } from "../lib/package-dto";
import { paise } from "../lib/money";
import type { CatalogServiceSort } from "../lib/api-schemas";

type CatalogRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  iconUrl: string | null;
  includedTasks: string[];
  excludedTasks: string[];
  pricePaise?: bigint | null;
  sessionMinutes?: number | null;
};

async function toCategory(row: CatalogRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    iconUrl: await resolveCatalogIconDisplayUrl(row.iconUrl),
    includedTasks: row.includedTasks,
    excludedTasks: row.excludedTasks,
  };
}

async function toService(row: CatalogRow, categoryId: string | null) {
  return {
    ...(await toCategory(row)),
    categoryId,
    pricePaise: row.pricePaise == null ? null : paise(row.pricePaise),
    sessionMinutes: row.sessionMinutes ?? null,
  };
}

function recommendRank(selected: string[], row: ServicePlanWithServices) {
  const selectedSet = new Set(selected);
  const packageIds = row.services.map((link) => link.category.id);
  const packageSet = new Set(packageIds);
  const matchedServiceIds = packageIds.filter((id) => selectedSet.has(id));
  const extraServiceIds = packageIds.filter((id) => !selectedSet.has(id));
  const missingServiceIds = selected.filter((id) => !packageSet.has(id));
  const matchCount = matchedServiceIds.length;
  const tightness = matchCount / Math.max(packageIds.length, 1);
  return {
    ...toPlanDto(row),
    matchCount,
    matchedServiceIds,
    missingServiceIds,
    extraServiceIds,
    tightness,
  };
}

export const catalogService = {
  async listServices() {
    const roots = await serviceCategoryRepository.listActiveRoots();
    return Promise.all(roots.map(toCategory));
  },

  async listSubcategories(categoryId?: string, sort?: CatalogServiceSort, q?: string) {
    if (categoryId && !(await serviceCategoryRepository.findActiveRoot(categoryId))) {
      throw new Error("SERVICE_NOT_FOUND");
    }
    const children = await serviceCategoryRepository.listActiveChildren(categoryId, sort, q);
    return Promise.all(children.map((child) => toService(child, child.parentId)));
  },

  async getServicePlans(serviceId: string) {
    const category = await serviceCategoryRepository.findActiveById(serviceId);
    if (!category) throw new Error("SERVICE_NOT_FOUND");
    const plans = await servicePlanRepository.listActiveOverlapping([serviceId]);
    return {
      service: await toService(category, category.parentId),
      plans: plans.map(toPlanDto),
    };
  },

  async recommendPackages(serviceIds: string[]) {
    const selected = [...new Set(serviceIds)];
    if (selected.length === 0) return [];
    const rows = await servicePlanRepository.listActiveOverlapping(selected);
    return rows
      .map((row) => recommendRank(selected, row))
      .filter((row) => row.matchCount > 0)
      .sort(
        (a, b) =>
          b.matchCount - a.matchCount ||
          b.tightness - a.tightness ||
          a.pricePaise - b.pricePaise,
      )
      .map(({ tightness: _tightness, ...row }) => row);
  },
};

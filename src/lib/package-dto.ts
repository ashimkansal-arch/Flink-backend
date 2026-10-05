import { paise } from "./money";
import type { ServicePlanWithServices } from "../repositories/service-plan-repository";

export function toPlanDto(row: ServicePlanWithServices) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    durationMinutes: row.durationMinutes,
    pricePaise: paise(row.pricePaise),
    includedTasks: row.includedTasks,
    excludedTasks: row.excludedTasks,
    services: row.services.map((link) => link.category),
  };
}

export function toAdminPackageDto(row: ServicePlanWithServices & { isActive: boolean; displayOrder: number }) {
  return {
    ...toPlanDto(row),
    isActive: row.isActive,
    displayOrder: row.displayOrder,
  };
}

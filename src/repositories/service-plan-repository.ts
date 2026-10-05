import { db, readDb } from "../lib/prisma";
import type { Prisma } from "../generated/prisma/client";
import { applyNameSlugSearch } from "../lib/search";

const serviceSelect = {
  category: { select: { id: true, name: true, slug: true } },
} as const;

const withServices = {
  services: { select: serviceSelect, orderBy: { category: { name: "asc" as const } } },
} as const;

export type ServicePlanWithServices = Prisma.ServicePlanGetPayload<{ include: typeof withServices }>;

export interface CreateServicePlanInput {
  name: string;
  slug: string;
  description?: string | null;
  pricePaise: bigint;
  includedTasks: string[];
  excludedTasks: string[];
  serviceIds: string[];
  durationMinutes?: number;
  isActive?: boolean;
  displayOrder?: number;
}

export type UpdateServicePlanInput = Partial<Omit<CreateServicePlanInput, "serviceIds">> & {
  serviceIds?: string[];
};

function connectServices(serviceIds: string[]) {
  return { create: serviceIds.map((categoryId) => ({ categoryId })) };
}

export const servicePlanRepository = {
  list(page: { skip: number; take: number }, q?: string) {
    const where = applyNameSlugSearch<Prisma.ServicePlanWhereInput>({}, q);
    return Promise.all([
      readDb.servicePlan.findMany({
        where,
        include: withServices,
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
        skip: page.skip,
        take: page.take,
      }),
      readDb.servicePlan.count({ where }),
    ]);
  },

  async countStats() {
    const [total, active] = await Promise.all([
      readDb.servicePlan.count(),
      readDb.servicePlan.count({ where: { isActive: true } }),
    ]);
    return { total, active };
  },

  findById(id: string) {
    return readDb.servicePlan.findUnique({
      where: { id },
      include: { ...withServices, _count: { select: { bookings: true } } },
    });
  },

  findBySlug(slug: string) {
    return readDb.servicePlan.findUnique({ where: { slug }, select: { id: true } });
  },

  listActiveOverlapping(serviceIds: string[]) {
    if (serviceIds.length === 0) return Promise.resolve([]);
    return readDb.servicePlan.findMany({
      where: { isActive: true, services: { some: { categoryId: { in: serviceIds } } } },
      include: withServices,
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    });
  },

  async nextDisplayOrder() {
    const max = await readDb.servicePlan.aggregate({ _max: { displayOrder: true } });
    return Math.max(1, (max._max.displayOrder ?? 0) + 1);
  },

  create(data: CreateServicePlanInput) {
    const { serviceIds, ...fields } = data;
    return db.servicePlan.create({
      data: {
        ...fields,
        services: connectServices(serviceIds),
      },
      include: withServices,
    });
  },

  async update(id: string, data: UpdateServicePlanInput) {
    const { serviceIds, ...fields } = data;
    return db.$transaction(async (tx) => {
      if (serviceIds) {
        await tx.servicePlanService.deleteMany({ where: { planId: id } });
      }
      return tx.servicePlan.update({
        where: { id },
        data: {
          ...fields,
          ...(serviceIds ? { services: connectServices(serviceIds) } : {}),
        },
        include: withServices,
      });
    });
  },

  delete(id: string) {
    return db.servicePlan.delete({ where: { id } });
  },
};

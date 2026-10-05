import { db, readDb } from "../lib/prisma";
import type { PolicyStatus, Prisma, VisibilityLevel } from "../generated/prisma/client";

export const visibilityPolicyRepository = {
  list(q?: string) {
    const where: Prisma.VisibilityPolicyWhereInput = q
      ? { name: { contains: q, mode: "insensitive" } }
      : {};
    return readDb.visibilityPolicy.findMany({ where, orderBy: { name: "asc" } });
  },
  findById(id: string) {
    return readDb.visibilityPolicy.findUnique({ where: { id } });
  },
  create(data: { name: string; level: VisibilityLevel; config?: Prisma.InputJsonValue; status?: PolicyStatus }) {
    return db.visibilityPolicy.create({ data });
  },
  update(
    id: string,
    data: { name?: string; level?: VisibilityLevel; config?: Prisma.InputJsonValue; status?: PolicyStatus },
  ) {
    return db.visibilityPolicy.update({ where: { id }, data });
  },
  delete(id: string) {
    return db.visibilityPolicy.delete({ where: { id } });
  },
};

export const approvalPolicyRepository = {
  list(q?: string) {
    const where: Prisma.ApprovalPolicyWhereInput = q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { actionKey: { contains: q, mode: "insensitive" } },
          ],
        }
      : {};
    return readDb.approvalPolicy.findMany({ where, orderBy: { name: "asc" } });
  },
  findById(id: string) {
    return readDb.approvalPolicy.findUnique({ where: { id } });
  },
  create(data: {
    name: string;
    actionKey: string;
    thresholdPaise?: bigint | null;
    approverRoleNames?: string[];
    escalationRoleNames?: string[];
    config?: Prisma.InputJsonValue;
    status?: PolicyStatus;
  }) {
    return db.approvalPolicy.create({ data });
  },
  update(
    id: string,
    data: {
      name?: string;
      actionKey?: string;
      thresholdPaise?: bigint | null;
      approverRoleNames?: string[];
      escalationRoleNames?: string[];
      config?: Prisma.InputJsonValue;
      status?: PolicyStatus;
    },
  ) {
    return db.approvalPolicy.update({ where: { id }, data });
  },
  delete(id: string) {
    return db.approvalPolicy.delete({ where: { id } });
  },
};

export const workflowPolicyRepository = {
  list(q?: string) {
    const where: Prisma.WorkflowPolicyWhereInput = q
      ? { name: { contains: q, mode: "insensitive" } }
      : {};
    return readDb.workflowPolicy.findMany({ where, orderBy: { name: "asc" } });
  },
  findById(id: string) {
    return readDb.workflowPolicy.findUnique({ where: { id } });
  },
  create(data: {
    name: string;
    version?: number;
    steps?: Prisma.InputJsonValue;
    transitions?: Prisma.InputJsonValue;
    status?: PolicyStatus;
  }) {
    return db.workflowPolicy.create({
      data: {
        name: data.name,
        version: data.version ?? 1,
        steps: data.steps ?? [],
        transitions: data.transitions ?? [],
        status: data.status ?? "draft",
      },
    });
  },
  update(
    id: string,
    data: {
      name?: string;
      version?: number;
      steps?: Prisma.InputJsonValue;
      transitions?: Prisma.InputJsonValue;
      status?: PolicyStatus;
    },
  ) {
    return db.workflowPolicy.update({ where: { id }, data });
  },
  delete(id: string) {
    return db.workflowPolicy.delete({ where: { id } });
  },
};

export const slaPolicyRepository = {
  list(q?: string) {
    const where: Prisma.SlaPolicyWhereInput = q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { metricKey: { contains: q, mode: "insensitive" } },
          ],
        }
      : {};
    return readDb.slaPolicy.findMany({ where, orderBy: { name: "asc" } });
  },
  findById(id: string) {
    return readDb.slaPolicy.findUnique({ where: { id } });
  },
  create(data: {
    name: string;
    metricKey: string;
    targetMinutes: number;
    escalateAfterMinutes?: number | null;
    escalationRoleNames?: string[];
    config?: Prisma.InputJsonValue;
    status?: PolicyStatus;
  }) {
    return db.slaPolicy.create({ data });
  },
  update(
    id: string,
    data: {
      name?: string;
      metricKey?: string;
      targetMinutes?: number;
      escalateAfterMinutes?: number | null;
      escalationRoleNames?: string[];
      config?: Prisma.InputJsonValue;
      status?: PolicyStatus;
    },
  ) {
    return db.slaPolicy.update({ where: { id }, data });
  },
  delete(id: string) {
    return db.slaPolicy.delete({ where: { id } });
  },
};

export const auditLogRepository = {
  list(filters: {
    q?: string;
    action?: string;
    entityType?: string;
    actorId?: string;
    actorIdsForQ?: string[];
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }) {
    const searchOr: Prisma.AuditLogWhereInput[] = filters.q
      ? [
          { action: { contains: filters.q, mode: "insensitive" } },
          { entityType: { contains: filters.q, mode: "insensitive" } },
          ...(filters.actorIdsForQ?.length ? [{ actorId: { in: filters.actorIdsForQ } }] : []),
          { metadata: { path: ["actorRole"], string_contains: filters.q } },
        ]
      : [];
    const where: Prisma.AuditLogWhereInput = {
      AND: [
        filters.action ? { action: { contains: filters.action, mode: "insensitive" } } : {},
        filters.entityType ? { entityType: filters.entityType } : {},
        filters.actorId ? { actorId: filters.actorId } : {},
        filters.from || filters.to
          ? {
              createdAt: {
                ...(filters.from ? { gte: filters.from } : {}),
                ...(filters.to ? { lte: filters.to } : {}),
              },
            }
          : {},
        searchOr.length ? { OR: searchOr } : {},
      ],
    };
    const take = Math.min(filters.limit ?? 50, 200);
    const skip = filters.offset ?? 0;
    return Promise.all([
      readDb.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take, skip }),
      readDb.auditLog.count({ where }),
    ]).then(([items, total]) => ({ items, total }));
  },
};

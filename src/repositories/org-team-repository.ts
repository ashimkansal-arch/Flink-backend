import { db, readDb } from "../lib/prisma";
import type { OrgTeamStatus, Prisma } from "../generated/prisma/client";

const teamInclude = {
  parent: { select: { id: true, name: true, code: true } },
  members: {
    include: {
      adminUser: { select: { id: true, fullName: true, email: true, status: true } },
    },
  },
  policy: {
    include: {
      visibilityPolicy: { select: { id: true, name: true } },
      approvalPolicy: { select: { id: true, name: true } },
      workflowPolicy: { select: { id: true, name: true } },
      slaPolicy: { select: { id: true, name: true } },
    },
  },
  _count: { select: { members: true, children: true } },
} as const;

export const orgTeamRepository = {
  list(q?: string) {
    const where: Prisma.OrgTeamWhereInput = q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { code: { contains: q, mode: "insensitive" } },
          ],
        }
      : {};
    return readDb.orgTeam.findMany({
      where,
      include: teamInclude,
      orderBy: { name: "asc" },
    });
  },

  findById(id: string) {
    return readDb.orgTeam.findUnique({ where: { id }, include: teamInclude });
  },

  findByCode(code: string) {
    return readDb.orgTeam.findUnique({ where: { code } });
  },

  create(data: {
    name: string;
    code: string;
    parentTeamId?: string | null;
    cityIds?: string[];
    zoneIds?: string[];
    status?: OrgTeamStatus;
  }) {
    return db.orgTeam.create({
      data: {
        name: data.name,
        code: data.code,
        parentTeamId: data.parentTeamId ?? null,
        cityIds: data.cityIds ?? [],
        zoneIds: data.zoneIds ?? [],
        status: data.status ?? "active",
      },
      include: teamInclude,
    });
  },

  update(
    id: string,
    data: {
      name?: string;
      code?: string;
      parentTeamId?: string | null;
      cityIds?: string[];
      zoneIds?: string[];
      status?: OrgTeamStatus;
    },
  ) {
    return db.orgTeam.update({ where: { id }, data, include: teamInclude });
  },

  delete(id: string) {
    return db.orgTeam.delete({ where: { id } });
  },

  addMember(teamId: string, adminUserId: string, isPrimary = true) {
    return db.teamMember.upsert({
      where: { teamId_adminUserId: { teamId, adminUserId } },
      update: { isPrimary },
      create: { teamId, adminUserId, isPrimary },
    });
  },

  removeMember(teamId: string, adminUserId: string) {
    return db.teamMember.delete({
      where: { teamId_adminUserId: { teamId, adminUserId } },
    });
  },

  upsertPolicy(
    teamId: string,
    data: {
      visibilityPolicyId?: string | null;
      approvalPolicyId?: string | null;
      workflowPolicyId?: string | null;
      slaPolicyId?: string | null;
      overrides?: Prisma.InputJsonValue;
    },
  ) {
    return db.teamPolicy.upsert({
      where: { teamId },
      update: data,
      create: { teamId, ...data },
      include: {
        visibilityPolicy: { select: { id: true, name: true } },
        approvalPolicy: { select: { id: true, name: true } },
        workflowPolicy: { select: { id: true, name: true } },
        slaPolicy: { select: { id: true, name: true } },
      },
    });
  },

  getPolicy(teamId: string) {
    return readDb.teamPolicy.findUnique({
      where: { teamId },
      include: {
        visibilityPolicy: true,
        approvalPolicy: true,
        workflowPolicy: true,
        slaPolicy: true,
      },
    });
  },
};

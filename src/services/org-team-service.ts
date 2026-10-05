import { orgTeamRepository } from "../repositories/org-team-repository";
import type { OptionalSearchQuery } from "../lib/pagination";
import type { OrgTeamStatus } from "../generated/prisma/client";

function toTeamDto(team: NonNullable<Awaited<ReturnType<typeof orgTeamRepository.findById>>>) {
  return {
    id: team.id,
    name: team.name,
    code: team.code,
    parentTeamId: team.parentTeamId,
    parent: team.parent,
    cityIds: team.cityIds,
    zoneIds: team.zoneIds,
    status: team.status,
    memberCount: team._count.members,
    childCount: team._count.children,
    members: team.members.map((m) => ({
      id: m.id,
      adminUserId: m.adminUserId,
      isPrimary: m.isPrimary,
      adminUser: m.adminUser,
    })),
    policy: team.policy
      ? {
          id: team.policy.id,
          visibilityPolicyId: team.policy.visibilityPolicyId,
          approvalPolicyId: team.policy.approvalPolicyId,
          workflowPolicyId: team.policy.workflowPolicyId,
          slaPolicyId: team.policy.slaPolicyId,
          visibilityPolicy: team.policy.visibilityPolicy,
          approvalPolicy: team.policy.approvalPolicy,
          workflowPolicy: team.policy.workflowPolicy,
          slaPolicy: team.policy.slaPolicy,
          overrides: team.policy.overrides,
        }
      : null,
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt.toISOString(),
  };
}

export const orgTeamService = {
  async list(query: OptionalSearchQuery = {}) {
    const teams = await orgTeamRepository.list(query.q);
    return teams.map(toTeamDto);
  },

  async getById(id: string) {
    const team = await orgTeamRepository.findById(id);
    if (!team) throw new Error("TEAM_NOT_FOUND");
    return toTeamDto(team);
  },

  async create(input: {
    name: string;
    code: string;
    parentTeamId?: string | null;
    cityIds?: string[];
    zoneIds?: string[];
    status?: OrgTeamStatus;
  }) {
    const code = input.code.trim().toLowerCase().replace(/\s+/g, "_");
    const existing = await orgTeamRepository.findByCode(code);
    if (existing) throw new Error("TEAM_CODE_EXISTS");
    if (input.parentTeamId) {
      const parent = await orgTeamRepository.findById(input.parentTeamId);
      if (!parent) throw new Error("PARENT_TEAM_NOT_FOUND");
    }
    const team = await orgTeamRepository.create({ ...input, code });
    return toTeamDto(team);
  },

  async update(
    id: string,
    input: {
      name?: string;
      code?: string;
      parentTeamId?: string | null;
      cityIds?: string[];
      zoneIds?: string[];
      status?: OrgTeamStatus;
    },
  ) {
    const team = await orgTeamRepository.findById(id);
    if (!team) throw new Error("TEAM_NOT_FOUND");
    if (input.code) {
      const code = input.code.trim().toLowerCase().replace(/\s+/g, "_");
      const existing = await orgTeamRepository.findByCode(code);
      if (existing && existing.id !== id) throw new Error("TEAM_CODE_EXISTS");
      input = { ...input, code };
    }
    if (input.parentTeamId === id) throw new Error("INVALID_PARENT_TEAM");
    if (input.parentTeamId) {
      const parent = await orgTeamRepository.findById(input.parentTeamId);
      if (!parent) throw new Error("PARENT_TEAM_NOT_FOUND");
    }
    return toTeamDto(await orgTeamRepository.update(id, input));
  },

  async remove(id: string) {
    const team = await orgTeamRepository.findById(id);
    if (!team) throw new Error("TEAM_NOT_FOUND");
    if (team._count.children > 0) throw new Error("TEAM_HAS_CHILDREN");
    await orgTeamRepository.delete(id);
  },

  async addMember(teamId: string, adminUserId: string, isPrimary: boolean) {
    const team = await orgTeamRepository.findById(teamId);
    if (!team) throw new Error("TEAM_NOT_FOUND");
    await orgTeamRepository.addMember(teamId, adminUserId, isPrimary);
    return this.getById(teamId);
  },

  async removeMember(teamId: string, adminUserId: string) {
    const team = await orgTeamRepository.findById(teamId);
    if (!team) throw new Error("TEAM_NOT_FOUND");
    try {
      await orgTeamRepository.removeMember(teamId, adminUserId);
    } catch {
      throw new Error("TEAM_MEMBER_NOT_FOUND");
    }
    return this.getById(teamId);
  },

  async getPolicy(teamId: string) {
    const team = await orgTeamRepository.findById(teamId);
    if (!team) throw new Error("TEAM_NOT_FOUND");
    return orgTeamRepository.getPolicy(teamId);
  },

  async upsertPolicy(
    teamId: string,
    input: {
      visibilityPolicyId?: string | null;
      approvalPolicyId?: string | null;
      workflowPolicyId?: string | null;
      slaPolicyId?: string | null;
      overrides?: object | null;
    },
  ) {
    const team = await orgTeamRepository.findById(teamId);
    if (!team) throw new Error("TEAM_NOT_FOUND");
    return orgTeamRepository.upsertPolicy(teamId, {
      visibilityPolicyId: input.visibilityPolicyId,
      approvalPolicyId: input.approvalPolicyId,
      workflowPolicyId: input.workflowPolicyId,
      slaPolicyId: input.slaPolicyId,
      overrides: input.overrides === null ? undefined : (input.overrides as object | undefined),
    });
  },
};

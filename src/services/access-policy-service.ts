import {
  approvalPolicyRepository,
  auditLogRepository,
  slaPolicyRepository,
  visibilityPolicyRepository,
  workflowPolicyRepository,
} from "../repositories/access-policy-repository";
import { adminUserRepository } from "../repositories/admin-user-repository";
import { supervisorRepository } from "../repositories/supervisor-repository";
import type { OptionalSearchQuery } from "../lib/pagination";
import type { PolicyStatus, VisibilityLevel } from "../generated/prisma/client";

function snapshotActorRole(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const role = (metadata as { actorRole?: unknown }).actorRole;
  return typeof role === "string" && role.trim() ? role.trim() : null;
}

function serializeBigInt<T extends { thresholdPaise?: bigint | null }>(row: T) {
  return {
    ...row,
    thresholdPaise:
      row.thresholdPaise === null || row.thresholdPaise === undefined
        ? null
        : row.thresholdPaise.toString(),
  };
}

export const accessPolicyService = {
  // Visibility
  async listVisibility(query: OptionalSearchQuery = {}) {
    return visibilityPolicyRepository.list(query.q);
  },
  async getVisibility(id: string) {
    const row = await visibilityPolicyRepository.findById(id);
    if (!row) throw new Error("VISIBILITY_POLICY_NOT_FOUND");
    return row;
  },
  async createVisibility(
    input: { name: string; level: VisibilityLevel; config?: object; status?: PolicyStatus }
  ) {
    const row = await visibilityPolicyRepository.create(input);
    return row;
  },
  async updateVisibility(
    id: string,
    input: { name?: string; level?: VisibilityLevel; config?: object; status?: PolicyStatus }
  ) {
    await this.getVisibility(id);
    const row = await visibilityPolicyRepository.update(id, input);
    return row;
  },
  async removeVisibility(id: string) {
    await this.getVisibility(id);
    await visibilityPolicyRepository.delete(id);
  },

  // Approval
  async listApproval(query: OptionalSearchQuery = {}) {
    const rows = await approvalPolicyRepository.list(query.q);
    return rows.map(serializeBigInt);
  },
  async getApproval(id: string) {
    const row = await approvalPolicyRepository.findById(id);
    if (!row) throw new Error("APPROVAL_POLICY_NOT_FOUND");
    return serializeBigInt(row);
  },
  async createApproval(
    input: {
      name: string;
      actionKey: string;
      thresholdPaise?: string | number | null;
      approverRoleNames?: string[];
      escalationRoleNames?: string[];
      config?: object;
      status?: PolicyStatus;
    }
  ) {
    const row = await approvalPolicyRepository.create({
      ...input,
      thresholdPaise:
        input.thresholdPaise === null || input.thresholdPaise === undefined
          ? null
          : BigInt(input.thresholdPaise),
    });
    return serializeBigInt(row);
  },
  async updateApproval(
    id: string,
    input: {
      name?: string;
      actionKey?: string;
      thresholdPaise?: string | number | null;
      approverRoleNames?: string[];
      escalationRoleNames?: string[];
      config?: object;
      status?: PolicyStatus;
    }
  ) {
    await this.getApproval(id);
    const row = await approvalPolicyRepository.update(id, {
      ...input,
      thresholdPaise:
        input.thresholdPaise === undefined
          ? undefined
          : input.thresholdPaise === null
            ? null
            : BigInt(input.thresholdPaise),
    });
    return serializeBigInt(row);
  },
  async removeApproval(id: string) {
    await this.getApproval(id);
    await approvalPolicyRepository.delete(id);
  },

  // Workflow
  async listWorkflow(query: OptionalSearchQuery = {}) {
    return workflowPolicyRepository.list(query.q);
  },
  async getWorkflow(id: string) {
    const row = await workflowPolicyRepository.findById(id);
    if (!row) throw new Error("WORKFLOW_POLICY_NOT_FOUND");
    return row;
  },
  async createWorkflow(
    input: {
      name: string;
      version?: number;
      steps?: unknown;
      transitions?: unknown;
      status?: PolicyStatus;
    }
  ) {
    const row = await workflowPolicyRepository.create({
      name: input.name,
      version: input.version,
      steps: (input.steps as object) ?? [],
      transitions: (input.transitions as object) ?? [],
      status: input.status,
    });
    return row;
  },
  async updateWorkflow(
    id: string,
    input: {
      name?: string;
      version?: number;
      steps?: unknown;
      transitions?: unknown;
      status?: PolicyStatus;
    }
  ) {
    await this.getWorkflow(id);
    const row = await workflowPolicyRepository.update(id, {
      name: input.name,
      version: input.version,
      steps: input.steps as object | undefined,
      transitions: input.transitions as object | undefined,
      status: input.status,
    });
    return row;
  },
  async removeWorkflow(id: string) {
    await this.getWorkflow(id);
    await workflowPolicyRepository.delete(id);
  },

  // SLA
  async listSla(query: OptionalSearchQuery = {}) {
    return slaPolicyRepository.list(query.q);
  },
  async getSla(id: string) {
    const row = await slaPolicyRepository.findById(id);
    if (!row) throw new Error("SLA_POLICY_NOT_FOUND");
    return row;
  },
  async createSla(
    input: {
      name: string;
      metricKey: string;
      targetMinutes: number;
      escalateAfterMinutes?: number | null;
      escalationRoleNames?: string[];
      config?: object;
      status?: PolicyStatus;
    }
  ) {
    const row = await slaPolicyRepository.create(input);
    return row;
  },
  async updateSla(
    id: string,
    input: {
      name?: string;
      metricKey?: string;
      targetMinutes?: number;
      escalateAfterMinutes?: number | null;
      escalationRoleNames?: string[];
      config?: object;
      status?: PolicyStatus;
    }
  ) {
    await this.getSla(id);
    const row = await slaPolicyRepository.update(id, input);
    return row;
  },
  async removeSla(id: string) {
    await this.getSla(id);
    await slaPolicyRepository.delete(id);
  },

  async listAudit(filters: {
    q?: string;
    action?: string;
    entityType?: string;
    actorId?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }) {
    const actorIdsForQ = filters.q
      ? (
          await Promise.all([
            adminUserRepository.findAuditSearchIds(filters.q),
            supervisorRepository.findIdsMatchingName(filters.q),
          ])
        ).flatMap((rows) => rows.map((row) => row.id))
      : [];
    const { from, to, ...rest } = filters;
    const result = await auditLogRepository.list({
      ...rest,
      actorIdsForQ,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
    const actorIds = [...new Set(result.items.map((item) => item.actorId).filter((id): id is string => Boolean(id)))];
    const snapshotSlugs = [
      ...new Set(
        result.items
          .map((item) => snapshotActorRole(item.metadata))
          .filter((slug): slug is string => Boolean(slug) && slug !== "supervisor"),
      ),
    ];
    const [admins, supervisors] = await Promise.all([
      adminUserRepository.findAuditActors(actorIds),
      supervisorRepository.findAuditActors(actorIds),
    ]);
    const adminById = new Map(admins.map((actor) => [actor.id, actor]));
    const supervisorById = new Map(supervisors.map((actor) => [actor.id, actor]));
    const roleNameBySlug = new Map(admins.map((actor) => [actor.role.roleName, actor.role.name]));
    const missingSlugs = snapshotSlugs.filter((slug) => !roleNameBySlug.has(slug));
    if (missingSlugs.length) {
      for (const row of await adminUserRepository.findRoleNamesBySlugs(missingSlugs)) {
        roleNameBySlug.set(row.roleName, row.name);
      }
    }
    return {
      total: result.total,
      items: result.items.map((item) => {
        const admin = item.actorId ? adminById.get(item.actorId) : undefined;
        const supervisor = item.actorId ? supervisorById.get(item.actorId) : undefined;
        const snapshot = snapshotActorRole(item.metadata);
        const actorRole =
          snapshot === "supervisor"
            ? "Supervisor"
            : (snapshot ? roleNameBySlug.get(snapshot) ?? snapshot : null) ||
              admin?.role.name ||
              (supervisor ? "Supervisor" : null);
        return {
          ...item,
          actorName: admin?.fullName || admin?.email || supervisor?.fullName || supervisor?.email || null,
          actorRole,
        };
      }),
    };
  },
};

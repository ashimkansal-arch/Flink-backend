import { supervisorRepository } from "../repositories/supervisor-repository";
import { adminUserRepository } from "../repositories/admin-user-repository";
import { serviceCategoryRepository } from "../repositories/service-category-repository";
import { generateTemporaryPassword, hashPassword } from "../lib/auth/password";
import { sendTeamMemberPasswordResetEmail, sendTeamMemberWelcomeEmail } from "../lib/mailer";
import { paginatedResult, paginationSkip, type SearchQuery } from "../lib/pagination";
import { toAdminRefDto } from "../lib/api-schemas";
import { refreshTokenStore } from "../lib/auth/refresh-token-store";
import { scopedAdminIds } from "../lib/admin-subtree";

type SupervisorRow = NonNullable<Awaited<ReturnType<typeof supervisorRepository.findById>>>;
type SupervisorListRow = Awaited<ReturnType<typeof supervisorRepository.list>>[0][number];

function toSupervisorDto(row: SupervisorRow) {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    phoneNumber: row.phoneNumber,
    role: "supervisor" as const,
    status: row.status,
    passwordResetRequired: row.passwordResetRequired,
    category: row.category,
    createdBy: row.createdBy,
    assignedTo: toAdminRefDto(row.assignedToAdmin),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSupervisorListDto(row: SupervisorListRow) {
  return { ...toSupervisorDto(row), teamCount: row._count.registeredProviders };
}

function canSeeSupervisor(
  row: Pick<SupervisorRow, "createdBy" | "assignedToId">,
  adminIds?: string[],
) {
  if (!adminIds) return true;
  return adminIds.includes(row.createdBy) || (row.assignedToId != null && adminIds.includes(row.assignedToId));
}

async function requireSupervisor(id: string, actorRole?: string, actorId?: string): Promise<SupervisorRow> {
  const row = await supervisorRepository.findById(id);
  if (!row || row.status === "deleted") throw new Error("SUPERVISOR_NOT_FOUND");
  const adminIds = await scopedAdminIds(actorRole, actorId, true);
  if (!canSeeSupervisor(row, adminIds)) throw new Error("SUPERVISOR_NOT_FOUND");
  return row;
}

async function resolveCategory(categoryId: string) {
  const category = await serviceCategoryRepository.findById(categoryId);
  if (!category) throw new Error("CATEGORY_NOT_FOUND");
  return category;
}

async function resolveAssignedTo(assignedTo?: string | null): Promise<string | null | undefined> {
  if (assignedTo === undefined) return undefined;
  if (assignedTo === null) return null;

  const admin = await adminUserRepository.findById(assignedTo);
  if (!admin || admin.status !== "active" || admin.role.roleName === "super_admin") {
    throw new Error("ASSIGNED_ADMIN_NOT_FOUND");
  }
  return assignedTo;
}

export const adminSupervisorService = {
  async list(query: SearchQuery, actorRole?: string, actorId?: string) {
    const ownedByAdminIds = await scopedAdminIds(actorRole, actorId, true);
    const [rows, total] = await supervisorRepository.list(paginationSkip(query), query.q, ownedByAdminIds);
    return paginatedResult(rows.map(toSupervisorListDto), total, query);
  },

  async listByIds(ids: string[], query: SearchQuery) {
    if (ids.length === 0) return paginatedResult([], 0, query);
    const [rows, total] = await supervisorRepository.list(paginationSkip(query), query.q, undefined, ids);
    return paginatedResult(rows.map(toSupervisorListDto), total, query);
  },

  async getById(id: string, actorRole?: string, actorId?: string) {
    return toSupervisorDto(await requireSupervisor(id, actorRole, actorId));
  },

  async create(input: {
    fullName: string;
    email: string;
    phoneNumber: string;
    categoryId: string;
    createdBy: string;
    assignedTo?: string | null;
  }) {
    const email = input.email.trim().toLowerCase();
    if (await supervisorRepository.findByEmail(email)) throw new Error("EMAIL_TAKEN");
    if (await supervisorRepository.findByPhone(input.phoneNumber)) throw new Error("PHONE_TAKEN");
    await resolveCategory(input.categoryId);
    const assignedToId = await resolveAssignedTo(input.assignedTo);

    const temporaryPassword = generateTemporaryPassword();
    const fullName = input.fullName.trim();
    const row = await supervisorRepository.create({
      email,
      phoneNumber: input.phoneNumber,
      fullName,
      passwordHash: await hashPassword(temporaryPassword),
      categoryId: input.categoryId,
      createdBy: input.createdBy,
      assignedToId,
    });
    await sendTeamMemberWelcomeEmail({
      to: email,
      fullName,
      temporaryPassword,
      roleLabel: "Dispatcher",
    });
    return { supervisor: toSupervisorDto(row), passwordResetRequired: true as const };
  },

  async update(
    id: string,
    input: {
      fullName?: string;
      email?: string;
      phoneNumber?: string;
      categoryId?: string;
      assignedTo?: string | null;
      status?: "active" | "inactive" | "suspended";
    },
    actorRole?: string,
    actorId?: string,
  ) {
    const row = await requireSupervisor(id, actorRole, actorId);
    if (input.email) {
      const email = input.email.trim().toLowerCase();
      const taken = await supervisorRepository.findByEmail(email);
      if (taken && taken.id !== id) throw new Error("EMAIL_TAKEN");
    }
    if (input.phoneNumber && input.phoneNumber !== row.phoneNumber) {
      if (await supervisorRepository.findByPhone(input.phoneNumber)) throw new Error("PHONE_TAKEN");
    }
    if (input.categoryId) await resolveCategory(input.categoryId);
    const assignedToId = await resolveAssignedTo(input.assignedTo);

    const updated = await supervisorRepository.update(id, {
      fullName: input.fullName?.trim(),
      email: input.email?.trim().toLowerCase(),
      phoneNumber: input.phoneNumber,
      categoryId: input.categoryId,
      assignedToId,
      status: input.status,
    });
    if (input.status && input.status !== "active") await refreshTokenStore.revoke("supervisor", id);
    return toSupervisorDto(updated);
  },

  async remove(id: string, actorRole?: string, actorId?: string) {
    await requireSupervisor(id, actorRole, actorId);
    await supervisorRepository.update(id, { status: "deleted" });
    await refreshTokenStore.revoke("supervisor", id);
  },

  async resetPassword(id: string, actorRole?: string, actorId?: string) {
    const row = await requireSupervisor(id, actorRole, actorId);
    const temporaryPassword = generateTemporaryPassword();
    await supervisorRepository.update(id, {
      passwordHash: await hashPassword(temporaryPassword),
      passwordResetRequired: true,
    });
    await sendTeamMemberPasswordResetEmail({
      to: row.email,
      fullName: row.fullName,
      temporaryPassword,
      roleLabel: "Dispatcher",
    });
    return { passwordResetRequired: true as const };
  },
};

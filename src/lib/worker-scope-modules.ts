import type { Prisma } from "../generated/prisma/client";
import { adminModuleRepository } from "../repositories/admin-module-repository";
import { visibleModulesForRole } from "./auth/visible-modules";
import { adminSubtreeIds, scopedAdminIds, SUPER_ADMIN, supervisorIdsForAdmins } from "./admin-subtree";

export const WORKERS_PATH = "/workers";
export const WORKERS_ASSIGNED_PATH = "/workers/assigned";

export type WorkerVisibility = {
  registeredByAdminIds?: string[];
  registeredBySupervisorIds?: string[];
};

export function workerOwnerWhere(visibility?: WorkerVisibility): Prisma.ServiceProviderWhereInput | undefined {
  if (!visibility) return undefined;
  const treeOr: Prisma.ServiceProviderWhereInput[] = [];
  if (visibility.registeredByAdminIds?.length) {
    treeOr.push({ registeredByAdminId: { in: visibility.registeredByAdminIds } });
  }
  if (visibility.registeredBySupervisorIds?.length) {
    treeOr.push({ registeredBySupervisorId: { in: visibility.registeredBySupervisorIds } });
  }
  if (treeOr.length === 0) return undefined;
  return treeOr.length === 1 ? treeOr[0] : { OR: treeOr };
}

async function workerAccessForRole(roleName?: string) {
  if (!roleName) return { all: false, assigned: false };
  if (roleName === SUPER_ADMIN) return { all: true, assigned: true };
  const modules = await visibleModulesForRole(roleName);
  const paths = new Set(modules.map((module) => module.path));
  return {
    all: paths.has(WORKERS_PATH),
    assigned: paths.has(WORKERS_ASSIGNED_PATH),
  };
}

function assignedOnly(access: { all: boolean; assigned: boolean }) {
  return access.assigned && !access.all;
}

async function visibilityForAdminIds(adminIds: string[]): Promise<WorkerVisibility> {
  return {
    registeredByAdminIds: adminIds,
    registeredBySupervisorIds: await supervisorIdsForAdmins(adminIds),
  };
}

export async function workerVisibility(
  auth: { type: string; id: string; role?: string },
  scope?: "all" | "assigned",
): Promise<WorkerVisibility> {
  if (auth.type === "supervisor") return { registeredBySupervisorIds: [auth.id] };
  if (auth.role === SUPER_ADMIN) {
    return scope === "assigned" ? { registeredByAdminIds: [auth.id] } : {};
  }

  const adminIds = await scopedAdminIds(auth.role, auth.id, true);
  if (!adminIds) return {};
  return visibilityForAdminIds(adminIds);
}

export async function subtreeWorkerVisibility(rootAdminId: string) {
  return visibilityForAdminIds(await adminSubtreeIds(rootAdminId));
}

export async function resolveWorkerCreateManager(
  auth: { type: string; id: string; role?: string },
  requestedManagerId?: string,
) {
  if (auth.type !== "admin") {
    return { managedByAdminId: undefined, requireManager: false };
  }
  const access = await workerAccessForRole(auth.role);
  return {
    managedByAdminId: assignedOnly(access) ? auth.id : requestedManagerId,
    requireManager: true,
  };
}

export function matchesWorkerVisibility(
  row: { registeredBySupervisorId?: string | null; registeredByAdminId?: string | null },
  visibility?: WorkerVisibility,
) {
  if (!workerOwnerWhere(visibility)) return true;
  const adminIds = visibility?.registeredByAdminIds;
  const supervisorIds = visibility?.registeredBySupervisorIds;
  if (row.registeredByAdminId && adminIds?.includes(row.registeredByAdminId)) return true;
  if (row.registeredBySupervisorId && supervisorIds?.includes(row.registeredBySupervisorId)) return true;
  return false;
}

export async function syncWorkerScopeModules() {
  const parent = await adminModuleRepository.findByPath(WORKERS_PATH);
  if (!parent) return;

  const assigned = await adminModuleRepository.findByPath(WORKERS_ASSIGNED_PATH);
  if (!assigned) {
    await adminModuleRepository.create({
      name: "Workers · Assigned",
      slug: "workers-assigned",
      sectionName: parent.sectionName,
      sectionSlug: parent.sectionSlug,
      path: WORKERS_ASSIGNED_PATH,
      icon: parent.icon,
      displayOrder: parent.displayOrder + 1,
      description: "Workers assigned to the signed-in team member",
    });
  }

  if (parent.name !== "Workers · All") {
    await adminModuleRepository.update(parent.id, { name: "Workers · All" });
  }
}

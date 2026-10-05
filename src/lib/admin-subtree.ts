import { readDb } from "./prisma";

export const SUPER_ADMIN = "super_admin";

/** CRM roles that manage workers, not other CRM members. */
const LEAF_TEAM_ROLES = new Set(["supervisor", "dispatcher"]);

export function isLeafTeamRole(roleName: string | undefined) {
  return Boolean(roleName && LEAF_TEAM_ROLES.has(roleName));
}

type AdminLink = {
  id: string;
  invitedBy: string | null;
  assignedToId: string | null;
  roleName: string;
};

function crmParentId(row: AdminLink, byId: Map<string, AdminLink>) {
  let id = row.assignedToId ?? row.invitedBy;
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const parent = byId.get(id);
    if (!parent) return id;
    if (!isLeafTeamRole(parent.roleName)) return id;
    id = parent.assignedToId ?? parent.invitedBy;
  }
  return null;
}

function walkDescendantIds(rootAdminId: string, rows: AdminLink[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const children = new Map<string, string[]>();
  for (const row of rows) {
    const parentId = crmParentId(row, byId);
    if (!parentId || parentId === row.id) continue;
    const list = children.get(parentId);
    if (list) list.push(row.id);
    else children.set(parentId, [row.id]);
  }

  const seen = new Set<string>();
  const stack = [rootAdminId];
  while (stack.length) {
    const parentId = stack.pop()!;
    for (const childId of children.get(parentId) ?? []) {
      if (seen.has(childId)) continue;
      seen.add(childId);
      stack.push(childId);
    }
  }
  return [...seen];
}

async function adminParentLinks() {
  const rows = await readDb.adminUser.findMany({
    where: { role: { roleName: { not: SUPER_ADMIN } } },
    select: {
      id: true,
      invitedBy: true,
      assignedToId: true,
      role: { select: { roleName: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    invitedBy: row.invitedBy,
    assignedToId: row.assignedToId,
    roleName: row.role.roleName,
  }));
}

async function descendantAdminIds(rootAdminId: string) {
  return walkDescendantIds(rootAdminId, await adminParentLinks());
}

async function supervisorsForAdmins(adminIds: string[]) {
  if (adminIds.length === 0) return [];
  return readDb.supervisor.findMany({
    where: {
      status: { not: "deleted" },
      OR: [{ assignedToId: { in: adminIds } }, { assignedToId: null, createdBy: { in: adminIds } }],
    },
    select: { id: true, createdBy: true, assignedToId: true },
  });
}

/** Super Admin, or a role with the Admin toggle on. */
export function roleIsAdmin(roleName: string | undefined, isAdmin?: boolean) {
  return roleName === SUPER_ADMIN || Boolean(isAdmin);
}

/** `undefined` = unrestricted (Super Admin). Otherwise the visible admin-user ids. */
export async function scopedAdminIds(
  actorRole: string | undefined,
  actorId: string | undefined,
  includeSelf = false,
) {
  if (!actorId || !actorRole || actorRole === SUPER_ADMIN) return undefined;
  const descendants = await descendantAdminIds(actorId);
  return includeSelf ? [actorId, ...descendants] : descendants;
}

export async function adminSubtreeIds(adminId: string) {
  return [adminId, ...(await descendantAdminIds(adminId))];
}

export async function subtreeTeamCounts(rootIds: string[]) {
  const counts = new Map(rootIds.map((id) => [id, 0]));
  if (rootIds.length === 0) return counts;

  const links = await adminParentLinks();
  const byId = new Map(links.map((row) => [row.id, row]));
  const subtree = new Map<string, Set<string>>();
  const adminRootIds: string[] = [];
  const leafRootIds: string[] = [];
  const allAdminIds = new Set<string>();

  for (const id of rootIds) {
    const descendants = walkDescendantIds(id, links);
    const tree = new Set([id, ...descendants]);
    subtree.set(id, tree);
    for (const childId of tree) allAdminIds.add(childId);
    if (isLeafTeamRole(byId.get(id)?.roleName)) leafRootIds.push(id);
    else adminRootIds.push(id);
  }

  const adminIdList = [...allAdminIds];
  const supervisors = adminRootIds.length ? await supervisorsForAdmins(adminIdList) : [];
  const supervisorsByRoot = new Map<string, Set<string>>();
  const allSupervisorIds = new Set<string>();
  for (const rootId of adminRootIds) {
    const tree = subtree.get(rootId)!;
    const ids = new Set<string>();
    for (const row of supervisors) {
      const ownerId = row.assignedToId ?? row.createdBy;
      if (tree.has(ownerId)) ids.add(row.id);
    }
    supervisorsByRoot.set(rootId, ids);
    for (const supervisorId of ids) allSupervisorIds.add(supervisorId);
  }

  const providerOr = [
    ...(adminIdList.length ? [{ registeredByAdminId: { in: adminIdList } }] : []),
    ...(allSupervisorIds.size ? [{ registeredBySupervisorId: { in: [...allSupervisorIds] } }] : []),
  ];
  const providers = providerOr.length
    ? await readDb.serviceProvider.findMany({
        where: { status: { not: "deleted" }, OR: providerOr },
        select: { registeredByAdminId: true, registeredBySupervisorId: true },
      })
    : [];

  for (const rootId of leafRootIds) {
    counts.set(rootId, providers.filter((row) => row.registeredByAdminId === rootId).length);
  }

  for (const rootId of adminRootIds) {
    const tree = subtree.get(rootId)!;
    const supervisorIds = supervisorsByRoot.get(rootId) ?? new Set<string>();
    let workers = 0;
    for (const row of providers) {
      if (row.registeredByAdminId && tree.has(row.registeredByAdminId)) workers += 1;
      else if (row.registeredBySupervisorId && supervisorIds.has(row.registeredBySupervisorId)) workers += 1;
    }
    counts.set(rootId, tree.size - 1 + supervisorIds.size + workers);
  }

  return counts;
}

export async function supervisorIdsForAdmins(adminIds: string[]) {
  return (await supervisorsForAdmins(adminIds)).map((row) => row.id);
}

import { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { cache } from "../cache";
import { readDb } from "../prisma";
import {
  ADMIN_PERMISSIONS_CACHE_TTL_SECONDS,
  adminPermissionsKey,
  adminUserPermissionsKey,
} from "../redis-keys";
import { visibleModulesForRole } from "./visible-modules";
import { permissionsForModulePaths } from "./module-permissions";

const SUPER_ADMIN = "super_admin";

export async function getPermissionsForAdmin(_adminId: string, roleName: string): Promise<string[]> {
  if (roleName === SUPER_ADMIN) return ["*"];

  const cached = await cache.get<string[]>(adminPermissionsKey(roleName));
  if (cached) return cached;

  const modules = await visibleModulesForRole(roleName);
  const keys = permissionsForModulePaths(modules.map((module) => module.path));
  await cache.set(adminPermissionsKey(roleName), keys, ADMIN_PERMISSIONS_CACHE_TTL_SECONDS);
  return keys;
}

function isReadRequest(request: FastifyRequest) {
  const method = request.method.toUpperCase();
  return method === "GET" || method === "HEAD";
}

/** Super Admin may call every admin API. Any admin may call GET/HEAD (pickers, lists). Writes stay module-gated. */
async function denyUnlessAdminAllowed(
  request: FastifyRequest,
  reply: FastifyReply,
  allowed: (granted: string[]) => boolean,
) {
  if (!request.auth || request.auth.type !== "admin") {
    return reply.code(401).send({ error: "UNAUTHORIZED" });
  }
  if (request.auth.role === SUPER_ADMIN || isReadRequest(request)) return;
  const granted = await getPermissionsForAdmin(request.auth.id, request.auth.role);
  if (!allowed(granted)) {
    return reply.code(403).send({ error: "FORBIDDEN" });
  }
}

export async function invalidateAdminPermissionCache(roleName: string, adminId?: string): Promise<void> {
  await cache.del(adminPermissionsKey(roleName));
  if (adminId) await cache.del(adminUserPermissionsKey(adminId));
}

export async function invalidateAllRolePermissionCaches(): Promise<void> {
  const roles = await readDb.adminRole.findMany({ select: { roleName: true } });
  await Promise.all(roles.map((role) => cache.del(adminPermissionsKey(role.roleName))));
}

export function hasPermission(granted: string[], required: string): boolean {
  if (granted.includes("*") || granted.includes(required)) return true;
  const [resource] = required.split(":");
  if (resource && granted.includes(`${resource}:*`)) return true;
  // Atomic keys like booking.view / booking.assign — also honor bookings:*
  if (required.includes(".")) {
    const ns = required.split(".")[0];
    if (ns === "booking") {
      if (granted.includes("bookings:*")) return true;
      if (required === "booking.view" && granted.includes("bookings:read")) return true;
    }
    if (ns === "refund" && granted.includes("payments:*")) return true;
    if (ns === "job" && granted.includes("assignments:*")) return true;
  }
  // Legacy aliases: teams:* ↔ admins:*
  if (resource === "teams" && (granted.includes("admins:*") || (granted.includes("admins:read") && required.endsWith(":read")))) {
    if (granted.includes("admins:*")) return true;
    if (required === "teams:read" && granted.includes("admins:read")) return true;
  }
  if (resource === "admins" && granted.includes("teams:*")) return true;
  if (required === "admins:read" && granted.includes("teams:read")) return true;
  if (resource === "access" && granted.includes("policies:*") && required === "access:read") return true;
  return false;
}

export function hasAnyPermission(granted: string[], required: readonly string[]): boolean {
  return required.some((key) => hasPermission(granted, key));
}

/** Read providers for list/detail without requiring exact providers:read. */
export const PROVIDER_ACCESS_PERMISSIONS = [
  "providers:read",
  "providers:create",
  "providers:update",
  "providers:delete",
] as const;

/** Review / mutate KYC requires update (or broader) access. */
export const PROVIDER_KYC_REVIEW_PERMISSIONS = [
  "providers:update",
  "providers:create",
  "providers:delete",
] as const;

/** Read categories for supervisor/provider admin forms without full category management access. */
export const CATEGORY_PICKER_PERMISSIONS = [
  "categories:read",
  "supervisors:read",
  "supervisors:create",
  "supervisors:update",
  "providers:read",
  "providers:create",
  "providers:update",
] as const;

export function requirePermission(key: string): preHandlerAsyncHookHandler {
  return async (request, reply) => {
    await denyUnlessAdminAllowed(request, reply, (granted) => hasPermission(granted, key));
  };
}

/** Platform-only writes (not granted via CRM modules). */
export function requireSuperAdmin(): preHandlerAsyncHookHandler {
  return async (request, reply) => {
    if (!request.auth || request.auth.type !== "admin") {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }
    if (request.auth.role !== SUPER_ADMIN) {
      return reply.code(403).send({ error: "FORBIDDEN" });
    }
  };
}

export function requireAnyPermission(keys: readonly string[]): preHandlerAsyncHookHandler {
  return async (request, reply) => {
    await denyUnlessAdminAllowed(request, reply, (granted) => hasAnyPermission(granted, keys));
  };
}

/** Supervisors always pass. Admins: GET is open; writes need the given permission. Super Admin always passes. */
export function requireStaffPermission(key: string): preHandlerAsyncHookHandler {
  return async (request, reply) => {
    if (!request.auth) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }
    if (request.auth.type === "supervisor") return;
    await denyUnlessAdminAllowed(request, reply, (granted) => hasPermission(granted, key));
  };
}

/** Supervisors always pass. Admins: GET is open; writes need any listed permission. Super Admin always passes. */
export function requireStaffAnyPermission(keys: readonly string[]): preHandlerAsyncHookHandler {
  return async (request, reply) => {
    if (!request.auth) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }
    if (request.auth.type === "supervisor") return;
    await denyUnlessAdminAllowed(request, reply, (granted) => hasAnyPermission(granted, keys));
  };
}

// Key-prefix and TTL conventions, decided up front rather than per-callsite. See REDIS.md.

export const CACHE_TTL_SECONDS = {
  // Hot, cheap-to-recompute data: rate-limit counters, live counts.
  short: 60,
  // Typical API response cache.
  default: 300,
  // Rarely-changing data, e.g. catalog listings.
  long: 3600,
} as const;

export const GEO_TTL_SECONDS = 60 * 30; // 30 minutes — stale location data isn't useful

// Admin role -> permissions lookup, for the live RBAC check in src/lib/auth/permissions.ts.
// Short TTL: bounds how long a revoked/changed permission stays effective.
export const ADMIN_PERMISSIONS_CACHE_TTL_SECONDS = CACHE_TTL_SECONDS.short;

export function cacheKey(...parts: string[]): string {
  return ["cache", ...parts].join(":");
}

export function geoKey(name: string): string {
  return `geo:${name}`;
}

// One key per actor holding their current refresh-token jti — single active session per actor.
// A new login overwrites it; logout deletes it. See src/lib/auth/refresh-token-store.ts.
export function refreshTokenKey(
  actorType: "customer" | "provider" | "admin" | "supervisor",
  actorId: string,
): string {
  return `refresh:${actorType}:${actorId}`;
}

// Keyed by role NAME (not id) — that's what the admin JWT payload carries (see
// src/lib/auth/jwt.ts's AdminAccessPayload), avoiding an extra id lookup on every request.
export function adminPermissionsKey(roleName: string): string {
  return `admin-permissions:role:${roleName}`;
}

export function adminUserPermissionsKey(adminId: string): string {
  return `admin-permissions:user:${adminId}`;
}

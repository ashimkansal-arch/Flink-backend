import jwt from "jsonwebtoken";

// Kept as named constants (matching the CACHE_TTL_SECONDS/GEO_TTL_SECONDS style already in
// redis-keys.ts) rather than env-configurable — these are an auth design decision, not deployment
// config. Server.ts guarantees process.env is fully populated before this module is imported.
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type ActorType = "customer" | "provider" | "admin" | "supervisor";

interface CustomerOrProviderAccessPayload {
  sub: string;
  type: "customer" | "provider";
  phone: string;
}

interface AdminAccessPayload {
  sub: string;
  type: "admin";
  role: string;
}

interface SupervisorAccessPayload {
  sub: string;
  type: "supervisor";
}

export type AccessTokenPayload = CustomerOrProviderAccessPayload | AdminAccessPayload | SupervisorAccessPayload;

export interface RefreshTokenPayload {
  sub: string;
  type: ActorType;
  jti: string;
}

function accessSecret(): string {
  return process.env.JWT_ACCESS_SECRET as string;
}

function refreshSecret(): string {
  return process.env.JWT_REFRESH_SECRET as string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, accessSecret(), { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, accessSecret()) as AccessTokenPayload;
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, refreshSecret(), { expiresIn: REFRESH_TOKEN_TTL_SECONDS });
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, refreshSecret()) as RefreshTokenPayload;
}

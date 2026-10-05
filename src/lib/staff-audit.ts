import type { FastifyReply, FastifyRequest } from "fastify";
import { writeAudit } from "./audit";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SENSITIVE_KEY = /password|token|secret|hash|otp|pin|authorization/i;

const METHOD_VERB: Record<string, string> = {
  POST: "create",
  PUT: "upsert",
  PATCH: "update",
  DELETE: "delete",
};

const SKIP_PREFIXES = ["/access/audit", "/auth", "/me", "/health", "/docs"];

function routePath(request: FastifyRequest): string {
  const raw = request.routeOptions.url ?? request.url.split("?")[0] ?? "";
  return raw.replace(/^\/v1(?=\/|$)/, "") || raw;
}

function shouldSkip(path: string): boolean {
  return SKIP_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function auditAction(method: string, path: string): string {
  const segments = path.split("/").filter(Boolean);
  const literals = segments.filter((segment) => !segment.startsWith(":"));
  const last = segments[segments.length - 1] ?? "request";
  const verb = METHOD_VERB[method] ?? method.toLowerCase();
  const parts =
    !last.startsWith(":") && segments.some((segment) => segment.startsWith(":"))
      ? literals
      : [...literals, verb];
  return parts.join(".").slice(0, 80);
}

function entityTypeFromPath(path: string): string | null {
  const literals = path
    .split("/")
    .filter((segment) => segment && !segment.startsWith(":"))
    .slice(0, 2)
    .map((segment) => segment.replace(/-/g, "_"));
  if (literals.length === 0) return null;
  return literals.join("_").slice(0, 40);
}

function entityIdFromParams(params: unknown): string | null {
  if (!params || typeof params !== "object") return null;
  for (const value of Object.values(params as Record<string, unknown>)) {
    if (typeof value === "string" && UUID_RE.test(value)) return value;
  }
  return null;
}

function safeBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body) || Buffer.isBuffer(body)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (value == null || typeof value === "boolean" || typeof value === "number") {
      out[key] = value;
    } else if (typeof value === "string") {
      out[key] = value.length > 200 ? value.slice(0, 200) : value;
    } else if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      out[key] = value.slice(0, 30);
    }
  }
  return out;
}

function clientIp(request: FastifyRequest): string | null {
  const ip = request.ip;
  return ip ? ip.slice(0, 45) : null;
}

/**
 * Records CRM staff mutations so Super Admin can see what dynamic-role team members did.
 * Fire-and-forget — never delays or fails the response.
 */
export function recordStaffActivity(request: FastifyRequest, reply: FastifyReply): void {
  const auth = request.auth;
  if (!auth || (auth.type !== "admin" && auth.type !== "supervisor")) return;
  if (!WRITE_METHODS.has(request.method)) return;
  if (reply.statusCode >= 400) return;

  const path = routePath(request);
  if (shouldSkip(path)) return;

  const actorRole = auth.type === "admin" ? auth.role : "supervisor";
  void writeAudit({
    actorType: "admin",
    actorId: auth.id,
    action: auditAction(request.method, path),
    entityType: entityTypeFromPath(path),
    entityId: entityIdFromParams(request.params),
    ipAddress: clientIp(request),
    metadata: {
      actorRole,
      method: request.method,
      route: path,
      statusCode: reply.statusCode,
      ...safeBody(request.body),
    },
  });
}

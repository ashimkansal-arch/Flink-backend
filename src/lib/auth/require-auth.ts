import { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { verifyAccessToken, type ActorType } from "./jwt";
import {
  assertAdminActiveById,
  assertCustomerActiveById,
  assertProviderActiveById,
  assertSupervisorActiveById,
} from "./actor-status";

const FORBIDDEN_CODES = new Set([
  "ACCOUNT_DELETED",
  "ACCOUNT_BLOCKED",
  "ACCOUNT_SUSPENDED",
  "ACCOUNT_INACTIVE",
]);

// One factory for all three actor types — a customer token can't hit a provider or admin route,
// since the token's `type` claim must match what the route expects, not just "any valid JWT."
// After JWT verification, the actor is re-loaded from the DB so deleted/blocked/suspended
// accounts can't keep calling APIs until the access token happens to expire.
export function adminActorRole(auth?: { type: string; role?: string } | null) {
  return auth?.type === "admin" ? auth.role : undefined;
}

export function requireAuth(type: ActorType | ActorType[]): preHandlerAsyncHookHandler {
  const allowed = Array.isArray(type) ? type : [type];
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    try {
      const payload = verifyAccessToken(header.slice("Bearer ".length));
      if (!allowed.includes(payload.type)) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      if (payload.type === "customer") {
        await assertCustomerActiveById(payload.sub);
      } else if (payload.type === "provider") {
        await assertProviderActiveById(payload.sub);
      } else if (payload.type === "supervisor") {
        await assertSupervisorActiveById(payload.sub);
      } else {
        await assertAdminActiveById(payload.sub);
      }

      if (payload.type === "admin") {
        request.auth = { type: "admin", id: payload.sub, role: payload.role };
      } else if (payload.type === "supervisor") {
        request.auth = { type: "supervisor", id: payload.sub };
      } else {
        request.auth = { type: payload.type, id: payload.sub, phone: payload.phone };
      }
    } catch (err) {
      if (err instanceof Error && FORBIDDEN_CODES.has(err.message)) {
        return reply.code(403).send({ error: err.message });
      }
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }
  };
}

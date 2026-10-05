import type { FastifyReply } from "fastify";

const RBAC_ERRORS: Record<string, 400 | 404 | 409> = {
  ROLE_NOT_FOUND: 404,
  MODULE_NOT_FOUND: 404,
  ROLE_EXISTS: 409,
  ROLE_IN_USE: 409,
  ROLE_RESERVED: 409,
  SLUG_TAKEN: 409,
  UNKNOWN_PERMISSION: 400,
  SECTION_REQUIRED: 400,
  UNKNOWN_SECTION: 400,
  PATH_TAKEN: 409,
  UNKNOWN_PATH: 400,
  UNKNOWN_ICON: 400,
  INVALID_SLUG: 400,
};

export function mapRbacError(message: string): { status: 400 | 404 | 409; error: string } | null {
  const status = RBAC_ERRORS[message];
  return status ? { status, error: message } : null;
}

export function replyMapped(reply: FastifyReply, err: unknown) {
  if (!(err instanceof Error)) throw err;
  const mapped = mapRbacError(err.message);
  if (!mapped) throw err;
  return reply.code(mapped.status).send({ error: mapped.error });
}

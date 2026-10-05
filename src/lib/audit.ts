import type { ActorType, Prisma } from "../generated/prisma/client";
import { db } from "./prisma";

export type WriteAuditInput = {
  actorType: ActorType;
  actorId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
};

/** Best-effort audit write — never throws into the request path. */
export async function writeAudit(input: WriteAuditInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        metadata: input.metadata ?? undefined,
        ipAddress: input.ipAddress ?? null,
      },
    });
  } catch (err) {
    console.warn("[audit] failed to write audit log", err);
  }
}

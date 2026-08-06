import { Prisma } from "../generated/prisma/client";

export type WriteAuditLogInput = {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function writeAuditLog(tx: Prisma.TransactionClient, input: WriteAuditLogInput): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      reason: input.reason ?? null,
      metadataJson: input.metadata !== undefined ? (input.metadata as Prisma.InputJsonValue) : undefined
    }
  });
}

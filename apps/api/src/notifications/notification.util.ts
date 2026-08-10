import type { NotificationType, Prisma } from "../generated/prisma/client";
import type { RealtimeEmitter } from "../realtime/deferred-emitter";

export type CreateNotificationInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  relatedEntityId?: string | null;
};

/**
 * Every domain module (orders, restaurants, drivers) calls this instead of importing a
 * NotificationsService, matching the codebase's existing pattern of touching shared Prisma
 * models directly rather than importing another domain's service class.
 *
 * Callers inside a transaction pass a DeferredEmitter rather than the gateway itself, so the
 * socket event fires only after the transaction commits.
 */
export async function createNotification(
  tx: Prisma.TransactionClient,
  gateway: Pick<RealtimeEmitter, "emitToUser">,
  input: CreateNotificationInput
): Promise<void> {
  const notification = await tx.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      relatedEntityId: input.relatedEntityId ?? null
    }
  });
  gateway.emitToUser(input.userId, "notification.created", {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    relatedEntityId: notification.relatedEntityId,
    isRead: notification.isRead,
    createdAt: notification.createdAt
  });
}

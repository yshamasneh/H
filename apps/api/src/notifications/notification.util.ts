import type { NotificationType, Prisma } from "../generated/prisma/client";
import type { RealtimeEmitter } from "../realtime/deferred-emitter";

export type CreateNotificationInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  relatedEntityId?: string | null;
  businessId?: string | null;
};

export type CreateBusinessNotificationInput = Omit<CreateNotificationInput, "userId"> & {
  businessId: string;
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
  gateway: Pick<RealtimeEmitter, "emitToUser" | "sendPush">,
  input: CreateNotificationInput
): Promise<void> {
  const notification = await tx.notification.create({
    data: {
      userId: input.userId,
      businessId: input.businessId ?? null,
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
  // A socket event only reaches an app that is already open; a device push is what reaches the
  // business (or customer, or driver) when it is not. Most important case: a new order must wake
  // up the business even with the app closed.
  gateway.sendPush(input.userId, {
    title: notification.title,
    body: notification.body,
    data: { type: notification.type, relatedEntityId: notification.relatedEntityId ?? undefined }
  });
}

/**
 * Notifies every active member of a business, so a new order reaches whoever is actually on shift
 * rather than only the owner of record. One row per member keeps read state per person: one staff
 * member marking an order notification read must not hide it from everyone else.
 */
export async function createBusinessNotification(
  tx: Prisma.TransactionClient,
  gateway: Pick<RealtimeEmitter, "emitToUser" | "sendPush">,
  input: CreateBusinessNotificationInput
): Promise<void> {
  const members = await tx.businessMember.findMany({
    where: { businessId: input.businessId, isActive: true },
    select: { userId: true }
  });

  for (const member of members) {
    await createNotification(tx, gateway, { ...input, userId: member.userId });
  }
}

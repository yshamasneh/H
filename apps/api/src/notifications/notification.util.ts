import { UserRole, type NotificationType, type Prisma } from "../generated/prisma/client";
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
  gateway: Pick<RealtimeEmitter, "emitToUser">,
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
  const tokens = await tx.pushToken.findMany({
    where: { userId: input.userId, isActive: true },
    select: { id: true }
  });
  if (tokens.length > 0) {
    await tx.pushDelivery.createMany({
      data: tokens.map((token) => ({
        notificationId: notification.id,
        pushTokenId: token.id,
        deduplicationKey: `${notification.id}:${token.id}`
      })),
      skipDuplicates: true
    });
  }
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

/**
 * Notifies every active member of a business, so a new order reaches whoever is actually on shift
 * rather than only the owner of record. One row per member keeps read state per person: one staff
 * member marking an order notification read must not hide it from everyone else.
 */
export async function createBusinessNotification(
  tx: Prisma.TransactionClient,
  gateway: Pick<RealtimeEmitter, "emitToUser">,
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

/**
 * The same notification for many recipients — a "delivery available" alert for every on-shift
 * driver. One token lookup and one bulk outbox insert cover the whole audience, so the cost grows
 * with the number of notification rows rather than with three queries per recipient. Read state
 * stays per recipient: one driver dismissing the alert must not clear it for the others.
 */
export async function createNotificationsForUsers(
  tx: Prisma.TransactionClient,
  gateway: Pick<RealtimeEmitter, "emitToUser">,
  userIds: string[],
  input: Omit<CreateNotificationInput, "userId">
): Promise<void> {
  const recipients = [...new Set(userIds)];
  if (recipients.length === 0) return;

  const tokens = await tx.pushToken.findMany({
    where: { userId: { in: recipients }, isActive: true },
    select: { id: true, userId: true }
  });
  const tokensByUser = new Map<string, string[]>();
  for (const token of tokens) {
    tokensByUser.set(token.userId, [...(tokensByUser.get(token.userId) ?? []), token.id]);
  }

  const deliveries: { notificationId: string; pushTokenId: string; deduplicationKey: string }[] = [];
  for (const userId of recipients) {
    const notification = await tx.notification.create({
      data: {
        userId,
        businessId: input.businessId ?? null,
        type: input.type,
        title: input.title,
        body: input.body,
        relatedEntityId: input.relatedEntityId ?? null
      }
    });
    for (const pushTokenId of tokensByUser.get(userId) ?? []) {
      deliveries.push({
        notificationId: notification.id,
        pushTokenId,
        deduplicationKey: `${notification.id}:${pushTokenId}`
      });
    }
    gateway.emitToUser(userId, "notification.created", {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      relatedEntityId: notification.relatedEntityId,
      isRead: notification.isRead,
      createdAt: notification.createdAt
    });
  }
  if (deliveries.length > 0) {
    await tx.pushDelivery.createMany({ data: deliveries, skipDuplicates: true });
  }
}

/**
 * Every active admin account. Used for the few events an operator has to act on rather than merely
 * watch, such as a failed delivery: the admin console already gets a live socket event, but an admin
 * with the console closed only hears about it through a push.
 */
export async function findAdminUserIds(tx: Prisma.TransactionClient): Promise<string[]> {
  const admins = await tx.user.findMany({
    where: { role: UserRole.ADMIN, isActive: true },
    select: { id: true }
  });
  return admins.map((admin) => admin.id);
}

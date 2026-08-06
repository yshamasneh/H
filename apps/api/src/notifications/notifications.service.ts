import { Injectable } from "@nestjs/common";
import { ApiException } from "../common/api.exception";
import type { Notification } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { NotificationView, Page } from "./notifications.types";

type NotificationsPage = Page<NotificationView> & { unreadCount: number };

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string, page: number, pageSize: number): Promise<NotificationsPage> {
    const where = { userId };
    const [notifications, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, isRead: false } })
    ]);
    return { items: notifications.map(toView), page, pageSize, total, unreadCount };
  }

  async markRead(userId: string, notificationId: string): Promise<NotificationView> {
    const notification = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!notification || notification.userId !== userId) {
      throw new ApiException(404, "NOTIFICATION_NOT_FOUND", "This notification does not exist.");
    }
    const updated = await this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true }
    });
    return toView(updated);
  }
}

function toView(notification: Notification): NotificationView {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    relatedEntityId: notification.relatedEntityId,
    isRead: notification.isRead,
    createdAt: notification.createdAt
  };
}

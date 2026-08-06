import { randomUUID } from "node:crypto";

type NotificationRecord = {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  relatedEntityId: string | null;
  isRead: boolean;
  createdAt: Date;
};

export class FakeNotificationsPrisma {
  readonly notifications: NotificationRecord[] = [];

  readonly notification = {} as any;

  constructor() {
    this.notification.findMany = async ({ where, skip = 0, take, orderBy }: any) => {
      let matches = this.notifications.filter(
        (item) => item.userId === where.userId && (where.isRead === undefined || item.isRead === where.isRead)
      );
      if (orderBy?.createdAt === "desc") {
        matches = [...matches].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
      }
      return typeof take === "number" ? matches.slice(skip, skip + take) : matches.slice(skip);
    };
    this.notification.count = async ({ where }: any) =>
      this.notifications.filter(
        (item) => item.userId === where.userId && (where.isRead === undefined || item.isRead === where.isRead)
      ).length;
    this.notification.findUnique = async ({ where }: any) =>
      this.notifications.find((item) => item.id === where.id) ?? null;
    this.notification.update = async ({ where, data }: any) => {
      const notification = this.notifications.find((item) => item.id === where.id);
      if (!notification) throw new Error("missing notification");
      if (data.isRead !== undefined) notification.isRead = data.isRead;
      return notification;
    };
  }

  seedNotification(userId: string, overrides: Partial<NotificationRecord> = {}): NotificationRecord {
    const notification: NotificationRecord = {
      id: randomUUID(),
      userId,
      type: "ORDER_PLACED",
      title: "Test notification",
      body: "Body text",
      relatedEntityId: null,
      isRead: false,
      createdAt: new Date(),
      ...overrides
    };
    this.notifications.push(notification);
    return notification;
  }
}

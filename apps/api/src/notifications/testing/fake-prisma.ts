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

type FakeUserRecord = { id: string; role: string; isActive: boolean };
type FakePushTokenRecord = { id: string; userId: string; isActive: boolean };

export class FakeNotificationsPrisma {
  readonly notifications: NotificationRecord[] = [];
  readonly users: FakeUserRecord[] = [];
  readonly pushTokens: FakePushTokenRecord[] = [];
  readonly pushDeliveries: { notificationId: string; pushTokenId: string; deduplicationKey: string }[] = [];

  readonly notification = {} as any;
  readonly user = {} as any;
  readonly pushToken = {} as any;
  readonly pushDelivery = {} as any;

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
    this.notification.createMany = async ({ data }: any) => {
      this.notifications.push(...data.map((row: any) => ({ isRead: false, relatedEntityId: null, ...row })));
      return { count: data.length };
    };

    this.user.findMany = async ({ where }: any) =>
      this.users.filter((item) => item.role === where.role && item.isActive === where.isActive);

    this.pushToken.findMany = async ({ where }: any) => {
      const ids: string[] = where.userId.in;
      return this.pushTokens.filter((token) => ids.includes(token.userId) && token.isActive === where.isActive);
    };

    this.pushDelivery.createMany = async ({ data }: any) => {
      for (const row of data) {
        if (!this.pushDeliveries.some((existing) => existing.deduplicationKey === row.deduplicationKey)) {
          this.pushDeliveries.push(row);
        }
      }
      return { count: data.length };
    };
  }

  async $transaction(operations: Promise<unknown>[]): Promise<unknown[]> {
    return Promise.all(operations);
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

  seedUser(overrides: Partial<FakeUserRecord> = {}): FakeUserRecord {
    const user: FakeUserRecord = { id: randomUUID(), role: "CUSTOMER", isActive: true, ...overrides };
    this.users.push(user);
    return user;
  }

  seedPushToken(userId: string, overrides: Partial<FakePushTokenRecord> = {}): FakePushTokenRecord {
    const token: FakePushTokenRecord = { id: randomUUID(), userId, isActive: true, ...overrides };
    this.pushTokens.push(token);
    return token;
  }
}

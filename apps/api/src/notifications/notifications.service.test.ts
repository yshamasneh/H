import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ApiException } from "../common/api.exception";
import { NotificationsService } from "./notifications.service";
import { FakeNotificationsPrisma } from "./testing/fake-prisma";

function createFakeRealtime() {
  const emitted: { userId: string; event: string; payload: unknown }[] = [];
  return { emitted, emitToUser: (userId: string, event: string, payload: unknown) => emitted.push({ userId, event, payload }) };
}

function createService() {
  const prisma = new FakeNotificationsPrisma();
  const realtime = createFakeRealtime();
  const service = new NotificationsService(prisma as never, realtime as never);
  return { prisma, realtime, service };
}

test("a user only sees their own notifications, most recent first, with an unread count", async () => {
  const { prisma, service } = createService();
  const userA = randomUUID();
  const userB = randomUUID();
  prisma.seedNotification(userA, { title: "First" });
  prisma.seedNotification(userA, { title: "Second" });
  prisma.seedNotification(userB, { title: "Not yours" });

  const page = await service.listForUser(userA, 1, 20);
  assert.equal(page.total, 2);
  assert.equal(page.unreadCount, 2);
  assert.ok(page.items.every((item) => item.title !== "Not yours"));
});

test("marking a notification read only works for its own owner", async () => {
  const { prisma, service } = createService();
  const owner = randomUUID();
  const stranger = randomUUID();
  const notification = prisma.seedNotification(owner);

  await assert.rejects(service.markRead(stranger, notification.id), hasCode("NOTIFICATION_NOT_FOUND"));

  const updated = await service.markRead(owner, notification.id);
  assert.equal(updated.isRead, true);
});

test("unread count decreases after marking a notification read", async () => {
  const { prisma, service } = createService();
  const userId = randomUUID();
  const first = prisma.seedNotification(userId);
  prisma.seedNotification(userId);

  await service.markRead(userId, first.id);
  const page = await service.listForUser(userId, 1, 20);
  assert.equal(page.unreadCount, 1);
});

test("a broadcast reaches only active accounts of the chosen audience role", async () => {
  const { prisma, realtime, service } = createService();
  const customer = prisma.seedUser({ role: "CUSTOMER" });
  prisma.seedUser({ role: "DRIVER" });
  prisma.seedUser({ role: "CUSTOMER", isActive: false });

  const result = await service.broadcast("CUSTOMER", "  Weekend deal  ", "  20% off everything  ");

  assert.equal(result.recipients, 1);
  assert.equal(prisma.notifications.length, 1);
  assert.equal(prisma.notifications[0].userId, customer.id);
  assert.equal(prisma.notifications[0].type, "ANNOUNCEMENT");
  assert.equal(prisma.notifications[0].title, "Weekend deal");
  assert.equal(prisma.notifications[0].body, "20% off everything");
  assert.equal(realtime.emitted.length, 1);
});

test("a broadcast to an audience with no active accounts sends nothing", async () => {
  const { prisma, service } = createService();
  prisma.seedUser({ role: "CUSTOMER", isActive: false });

  const result = await service.broadcast("CUSTOMER", "Title", "Body");
  assert.equal(result.recipients, 0);
  assert.equal(prisma.notifications.length, 0);
});

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof ApiException && (error.getResponse() as { code?: string }).code === code;
}

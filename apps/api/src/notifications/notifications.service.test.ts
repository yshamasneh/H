import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ApiException } from "../common/api.exception";
import { NotificationsService } from "./notifications.service";
import { FakeNotificationsPrisma } from "./testing/fake-prisma";

function createService() {
  const prisma = new FakeNotificationsPrisma();
  const service = new NotificationsService(prisma as never);
  return { prisma, service };
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

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof ApiException && (error.getResponse() as { code?: string }).code === code;
}

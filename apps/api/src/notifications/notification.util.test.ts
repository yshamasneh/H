import assert from "node:assert/strict";
import { test } from "node:test";
import { broadcastNotification } from "./notification.util";
import { FakeNotificationsPrisma } from "./testing/fake-prisma";

function createFakeRealtime() {
  const emitted: { userId: string; event: string }[] = [];
  return { emitted, emitToUser: (userId: string, event: string) => emitted.push({ userId, event }) };
}

test("broadcasting creates one notification per recipient and a push delivery per active token", async () => {
  const prisma = new FakeNotificationsPrisma();
  const realtime = createFakeRealtime();
  const userWithToken = prisma.seedUser();
  const userWithoutToken = prisma.seedUser();
  prisma.seedPushToken(userWithToken.id);
  prisma.seedPushToken(userWithToken.id, { isActive: false });

  const notified = await broadcastNotification(prisma as never, realtime, {
    userIds: [userWithToken.id, userWithoutToken.id],
    type: "ANNOUNCEMENT",
    title: "Title",
    body: "Body"
  });

  assert.equal(notified, 2);
  assert.equal(prisma.notifications.length, 2);
  assert.equal(prisma.pushDeliveries.length, 1, "only the active token gets a delivery row");
  assert.equal(realtime.emitted.length, 2);
});

test("duplicate recipient ids are only notified once", async () => {
  const prisma = new FakeNotificationsPrisma();
  const realtime = createFakeRealtime();
  const user = prisma.seedUser();

  const notified = await broadcastNotification(prisma as never, realtime, {
    userIds: [user.id, user.id],
    type: "ANNOUNCEMENT",
    title: "Title",
    body: "Body"
  });

  assert.equal(notified, 1);
  assert.equal(prisma.notifications.length, 1);
});

test("an empty audience sends nothing and never touches the database", async () => {
  const prisma = new FakeNotificationsPrisma();
  const realtime = createFakeRealtime();

  const notified = await broadcastNotification(prisma as never, realtime, {
    userIds: [],
    type: "ANNOUNCEMENT",
    title: "Title",
    body: "Body"
  });

  assert.equal(notified, 0);
  assert.equal(prisma.notifications.length, 0);
});

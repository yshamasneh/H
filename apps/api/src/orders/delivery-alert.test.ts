import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { FakeRealtimeGateway } from "../realtime/testing/fake-realtime-gateway";
import { FakeOrdersPrisma } from "./testing/fake-prisma";
import { OrdersService } from "./orders.service";

function setup() {
  const prisma = new FakeOrdersPrisma();
  const realtime = new FakeRealtimeGateway();
  const service = new OrdersService(
    prisma as never,
    realtime as never,
    new ConfigService({ RESTAURANT_ORDERING_ENABLED: true })
  );
  return { prisma, realtime, service };
}

/** Places an order and walks it to the step just before READY_FOR_PICKUP. */
async function preparingOrder(prisma: FakeOrdersPrisma, service: OrdersService) {
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id);
  const order = await service.createOrder(randomUUID(), {
    restaurantId: restaurant.id,
    items: [{ menuItemId: menuItem.id, quantity: 1 }],
    deliveryLabel: "Home",
    deliveryAddressLine: "12 Secret Street, Biddu",
    deliveryLatitude: 31.9038,
    deliveryLongitude: 35.2034,
    paymentMethod: "CASH"
  } as never);
  await service.updateStatusForRestaurantOwner(restaurant.ownerUserId, order.id, "ACCEPTED", undefined);
  await service.updateStatusForRestaurantOwner(restaurant.ownerUserId, order.id, "PREPARING", undefined);
  return { restaurant, order };
}

function alertsFor(prisma: FakeOrdersPrisma, userId: string) {
  return prisma.notifications.filter((item) => item.userId === userId && item.type === "DELIVERY_AVAILABLE");
}

test("an on-shift driver is alerted, with a queued push, when a delivery becomes available", async () => {
  const { prisma, realtime, service } = setup();
  const driver = prisma.seedDriver();
  const token = prisma.seedPushToken(driver.userId);
  const { restaurant, order } = await preparingOrder(prisma, service);

  await service.updateStatusForRestaurantOwner(restaurant.ownerUserId, order.id, "READY_FOR_PICKUP", undefined);

  const [alert] = alertsFor(prisma, driver.userId);
  assert.ok(alert, "the driver must be notified");
  const delivery = prisma.deliveries.find((candidate) => candidate.orderId === order.id)!;
  assert.equal(alert.relatedEntityId, delivery.id, "the alert points at the delivery to accept");
  assert.ok(alert.body.includes(restaurant.name), "the alert names the pickup store");

  const queued = prisma.pushDeliveries.filter((item) => item.notificationId === alert.id);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].pushTokenId, token.id, "the push goes to the driver's registered device");

  assert.ok(
    realtime.emitted.some((event) => event.room === `user:${driver.userId}` && event.event === "notification.created"),
    "an app that is open hears about it over the socket too"
  );
  assert.ok(
    realtime.emitted.some((event) => event.room === "drivers" && event.event === "delivery.available"),
    "open driver screens are told to refresh their list"
  );
});

test("the alert never carries the customer's address, because a lock screen is public", async () => {
  const { prisma, service } = setup();
  const driver = prisma.seedDriver();
  prisma.seedPushToken(driver.userId);
  const { restaurant, order } = await preparingOrder(prisma, service);

  await service.updateStatusForRestaurantOwner(restaurant.ownerUserId, order.id, "READY_FOR_PICKUP", undefined);

  const [alert] = alertsFor(prisma, driver.userId);
  assert.ok(!alert.title.includes("Secret") && !alert.body.includes("Secret"));
});

test("only approved, online, unoccupied drivers with a live account are alerted", async () => {
  const { prisma, service } = setup();
  const eligible = prisma.seedDriver();
  const offline = prisma.seedDriver({ isOnline: false });
  const pending = prisma.seedDriver({ status: "PENDING" });
  const suspended = prisma.seedDriver({ status: "SUSPENDED" });
  const deactivated = prisma.seedDriver({ isActive: false });
  const busy = prisma.seedDriver();
  await prisma.delivery.create({ data: { orderId: randomUUID(), driverId: busy.userId, status: "ON_THE_WAY" } });
  for (const driver of [eligible, offline, pending, suspended, deactivated, busy]) {
    prisma.seedPushToken(driver.userId);
  }
  const { restaurant, order } = await preparingOrder(prisma, service);

  await service.updateStatusForRestaurantOwner(restaurant.ownerUserId, order.id, "READY_FOR_PICKUP", undefined);

  assert.equal(alertsFor(prisma, eligible.userId).length, 1);
  for (const excluded of [offline, pending, suspended, deactivated, busy]) {
    assert.equal(alertsFor(prisma, excluded.userId).length, 0);
  }
});

test("a driver with no registered device still gets an in-app alert but no push row", async () => {
  const { prisma, service } = setup();
  const driver = prisma.seedDriver();
  const { restaurant, order } = await preparingOrder(prisma, service);

  await service.updateStatusForRestaurantOwner(restaurant.ownerUserId, order.id, "READY_FOR_PICKUP", undefined);

  assert.equal(alertsFor(prisma, driver.userId).length, 1);
  assert.equal(prisma.pushDeliveries.length, 0);
});

test("marking an order ready still succeeds when no driver is on shift", async () => {
  const { prisma, service } = setup();
  const { restaurant, order } = await preparingOrder(prisma, service);

  const ready = await service.updateStatusForRestaurantOwner(restaurant.ownerUserId, order.id, "READY_FOR_PICKUP", undefined);

  assert.equal(ready.status, "READY_FOR_PICKUP");
  assert.ok(prisma.deliveries.some((delivery) => delivery.orderId === order.id && delivery.status === "PENDING_ASSIGNMENT"));
  assert.equal(prisma.notifications.filter((item) => item.type === "DELIVERY_AVAILABLE").length, 0);
});

// ---------------------------------------------------------------------------------------------
// When is a driver alerted? Online AND the app running. The three cases that define it:

test("online + app open = alert", async () => {
  const { prisma, service } = setup();
  const driver = prisma.seedDriver({ isOnline: true, appLeaseUntil: new Date(Date.now() + 60_000) });
  prisma.seedPushToken(driver.userId);
  const { restaurant, order } = await preparingOrder(prisma, service);

  await service.updateStatusForRestaurantOwner(restaurant.ownerUserId, order.id, "READY_FOR_PICKUP", undefined);

  assert.equal(alertsFor(prisma, driver.userId).length, 1);
  assert.equal(prisma.pushDeliveries.length, 1);
});

test("online + app closed = no alert attempted at all, not even a queued push", async () => {
  const { prisma, realtime, service } = setup();
  // Marked online, but the app stopped reporting in: never reported, or the lease has run out.
  const neverReported = prisma.seedDriver({ isOnline: true, appLeaseUntil: null });
  const leaseExpired = prisma.seedDriver({ isOnline: true, appLeaseUntil: new Date(Date.now() - 1_000) });
  const forgotYesterday = prisma.seedDriver({ isOnline: true, appLeaseUntil: new Date(Date.now() - 24 * 3_600_000) });
  for (const stale of [neverReported, leaseExpired, forgotYesterday]) prisma.seedPushToken(stale.userId);
  const { restaurant, order } = await preparingOrder(prisma, service);

  await service.updateStatusForRestaurantOwner(restaurant.ownerUserId, order.id, "READY_FOR_PICKUP", undefined);

  for (const stale of [neverReported, leaseExpired, forgotYesterday]) {
    assert.equal(alertsFor(prisma, stale.userId).length, 0, "no notification row");
  }
  assert.equal(prisma.pushDeliveries.length, 0, "no push was queued for a closed app");
  assert.ok(
    !realtime.emitted.some(
      (event) => event.event === "notification.created" && (event.payload as { type?: string }).type === "DELIVERY_AVAILABLE"
    ),
    "and no delivery alert was signalled to anyone"
  );
});

test("offline + app open = no alert", async () => {
  const { prisma, service } = setup();
  const driver = prisma.seedDriver({ isOnline: false, appLeaseUntil: new Date(Date.now() + 60_000) });
  prisma.seedPushToken(driver.userId);
  const { restaurant, order } = await preparingOrder(prisma, service);

  await service.updateStatusForRestaurantOwner(restaurant.ownerUserId, order.id, "READY_FOR_PICKUP", undefined);

  assert.equal(alertsFor(prisma, driver.userId).length, 0);
  assert.equal(prisma.pushDeliveries.length, 0);
});

test("a backgrounded app is still alerted inside its grace, and dropped once the grace has run out", async () => {
  const { prisma, service } = setup();
  const insideGrace = prisma.seedDriver({ appLeaseUntil: new Date(Date.now() + 20 * 60_000) });
  const pastGrace = prisma.seedDriver({ appLeaseUntil: new Date(Date.now() - 60_000) });
  prisma.seedPushToken(insideGrace.userId);
  prisma.seedPushToken(pastGrace.userId);
  const { restaurant, order } = await preparingOrder(prisma, service);

  await service.updateStatusForRestaurantOwner(restaurant.ownerUserId, order.id, "READY_FOR_PICKUP", undefined);

  assert.equal(alertsFor(prisma, insideGrace.userId).length, 1);
  assert.equal(alertsFor(prisma, pastGrace.userId).length, 0);
});

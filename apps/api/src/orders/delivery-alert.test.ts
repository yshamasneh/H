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

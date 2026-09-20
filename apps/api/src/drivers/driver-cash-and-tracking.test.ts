import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiException } from "../common/api.exception";
import { FakeRealtimeGateway } from "../realtime/testing/fake-realtime-gateway";
import { DriversService } from "./drivers.service";
import { FakeDriversPrisma } from "./testing/fake-prisma";

function createService() {
  const prisma = new FakeDriversPrisma();
  const realtime = new FakeRealtimeGateway();
  const service = new DriversService(prisma as never, realtime as never);
  return { prisma, realtime, service };
}

/** One delivered order: 22.00 of food plus the given fee, walked through the real status flow. */
async function completeDelivery(
  prisma: FakeDriversPrisma,
  service: DriversService,
  restaurantId: string,
  driverUserId: string,
  deliveryFeeMinor = 1000
) {
  const order = prisma.seedOrder(restaurantId, {
    deliveryFeeMinor,
    subtotalMinor: 2200,
    totalMinor: 2200 + deliveryFeeMinor
  });
  prisma.seedOrderItem(order.id);
  const delivery = prisma.seedDelivery(order.id, { driverId: driverUserId, status: "ASSIGNED" as never });
  await service.updateDeliveryStatus(driverUserId, delivery.id, "PICKED_UP");
  await service.updateDeliveryStatus(driverUserId, delivery.id, "ON_THE_WAY");
  await service.updateDeliveryStatus(driverUserId, delivery.id, "DELIVERED");
  return order;
}

/** A failed delivery: no cash is taken, but the driver's share of the fee is still recorded. */
async function failDelivery(prisma: FakeDriversPrisma, service: DriversService, restaurantId: string, driverUserId: string) {
  const order = prisma.seedOrder(restaurantId);
  prisma.seedOrderItem(order.id);
  const delivery = prisma.seedDelivery(order.id, { driverId: driverUserId, status: "ASSIGNED" as never });
  await service.updateDeliveryStatus(driverUserId, delivery.id, "PICKED_UP");
  await service.updateDeliveryStatus(driverUserId, delivery.id, "FAILED", { failureReason: "CUSTOMER_UNREACHABLE" });
  return order;
}

/** What AccountingService.recordCashSettlement leaves behind: settled amounts, plus a handover row. */
function handOver(prisma: FakeDriversPrisma, driverUserId: string, settledAt: Date, orderIds?: string[]) {
  for (const custody of prisma.accounting.driverCashCustodies) {
    if (custody.driverUserId !== driverUserId) continue;
    if (orderIds && !orderIds.includes(custody.orderId)) continue;
    custody.settledAmountMinor = custody.collectedAmountMinor;
    custody.status = "SETTLED";
  }
  prisma.accounting.cashSettlements.push({ id: `handover-${settledAt.getTime()}`, driverUserId, settledAt });
}

test("the three figures are separate: 64.00 collected, 14.00 earned, 64.00 to hand over — not 50.00", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const driver = prisma.seedDriver();
  await completeDelivery(prisma, service, restaurant.id, driver.userId);
  await completeDelivery(prisma, service, restaurant.id, driver.userId);

  const summary = await service.getOwnCashSummary(driver.userId, "ALL");

  assert.equal(summary.cashCollectedMinor, 6400);
  assert.equal(summary.earningsMinor, 1400);
  // Cash is settled GROSS: the whole 64.00 goes back and the 14.00 is paid separately, so the
  // amount owed is not reduced by the driver's own share.
  assert.equal(summary.balance.cashOwedToPlatformMinor, 6400);
  assert.equal(summary.balance.earningsOwedToDriverMinor, 1400);
  assert.equal(summary.deliveredCount, 2);
});

test("the per-order lines add up to the totals and name the store", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant({ name: "Al-Quds Market" });
  const driver = prisma.seedDriver();
  await completeDelivery(prisma, service, restaurant.id, driver.userId, 1000);
  await completeDelivery(prisma, service, restaurant.id, driver.userId, 1300);

  const summary = await service.getOwnCashSummary(driver.userId, "ALL");

  assert.equal(summary.lines.length, 2);
  assert.equal(summary.lines.reduce((sum, line) => sum + line.cashCollectedMinor, 0), summary.cashCollectedMinor);
  assert.equal(summary.lines.reduce((sum, line) => sum + line.earningMinor, 0), summary.earningsMinor);
  assert.ok(summary.lines.every((line) => line.restaurantName === "Al-Quds Market" && line.outcome === "DELIVERED"));
  assert.equal(summary.linesTruncated, false);
});

test("a failed delivery shows an earning and no cash, and is counted as failed", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const driver = prisma.seedDriver();
  await failDelivery(prisma, service, restaurant.id, driver.userId);

  const summary = await service.getOwnCashSummary(driver.userId, "ALL");

  assert.equal(summary.cashCollectedMinor, 0);
  assert.equal(summary.balance.cashOwedToPlatformMinor, 0);
  assert.equal(summary.failedCount, 1);
  assert.equal(summary.deliveredCount, 0);
  assert.equal(summary.lines.length, 1);
  assert.equal(summary.lines[0].outcome, "DELIVERY_FAILED");
  assert.equal(summary.lines[0].cashCollectedMinor, 0);
  assert.ok(summary.lines[0].earningMinor > 0, "the driver is still paid for the attempt");
});

test("SHIFT means since the last handover: settled orders drop out, and the balance follows", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const driver = prisma.seedDriver();
  await completeDelivery(prisma, service, restaurant.id, driver.userId);
  await completeDelivery(prisma, service, restaurant.id, driver.userId);
  // The driver hands over what they hold, an hour from now (after both deliveries were recorded).
  const handoverAt = new Date(Date.now() + 60 * 60 * 1000);
  handOver(prisma, driver.userId, handoverAt);
  // A third order after the handover starts the next shift. Backdating the first two puts them
  // clearly before it.
  for (const custody of prisma.accounting.driverCashCustodies) custody.collectedAt = new Date(handoverAt.getTime() - 10_000);
  for (const earning of prisma.accounting.partnerEarnings) earning.occurredAt = new Date(handoverAt.getTime() - 10_000);
  const third = await completeDelivery(prisma, service, restaurant.id, driver.userId);
  for (const custody of prisma.accounting.driverCashCustodies.filter((row) => row.orderId === third.id)) {
    custody.collectedAt = new Date(handoverAt.getTime() + 10_000);
  }
  for (const earning of prisma.accounting.earningsForOrderRecord(third.id)) {
    earning.occurredAt = new Date(handoverAt.getTime() + 10_000);
  }

  const shift = await service.getOwnCashSummary(driver.userId, "SHIFT");
  const all = await service.getOwnCashSummary(driver.userId, "ALL");

  assert.equal(shift.lastHandoverAt?.getTime(), handoverAt.getTime());
  assert.equal(shift.cashCollectedMinor, 3200, "only the order since the handover");
  assert.equal(shift.lines.length, 1);
  assert.equal(all.cashCollectedMinor, 9600);
  assert.equal(all.cashHandedOverMinor, 6400);
  // Owed is the standing balance, whichever period is on screen.
  assert.equal(shift.balance.cashOwedToPlatformMinor, 3200);
  assert.equal(all.balance.cashOwedToPlatformMinor, 3200);
});

test("a narrow period never hides cash still owed from before it", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const driver = prisma.seedDriver();
  await completeDelivery(prisma, service, restaurant.id, driver.userId);
  await completeDelivery(prisma, service, restaurant.id, driver.userId);
  // One order from the middle of last week that was never handed over.
  const [old] = prisma.accounting.driverCashCustodies;
  old.collectedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

  const today = await service.getOwnCashSummary(driver.userId, "TODAY");

  assert.equal(today.cashCollectedMinor, 3200, "only today's order is 'collected today'");
  assert.equal(today.balance.cashOwedToPlatformMinor, 6400, "but both are still owed");
  assert.equal(today.balance.cashOwedFromBeforePeriodMinor, 3200);
  assert.equal(today.balance.unsettledOrderCount, 2);
  assert.equal(today.balance.oldestUnsettledAt?.getTime(), old.collectedAt.getTime());
});

test("a driver only ever sees their own figures", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const mine = prisma.seedDriver();
  const other = prisma.seedDriver();
  await completeDelivery(prisma, service, restaurant.id, other.userId);

  const summary = await service.getOwnCashSummary(mine.userId, "ALL");

  assert.equal(summary.cashCollectedMinor, 0);
  assert.equal(summary.earningsMinor, 0);
  assert.equal(summary.lines.length, 0);
  assert.equal(summary.balance.cashOwedToPlatformMinor, 0);
});

test("earnings already paid out come off what the platform still owes the driver, not off the cash", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const driver = prisma.seedDriver();
  await completeDelivery(prisma, service, restaurant.id, driver.userId);
  prisma.accounting.partnerSettlements.push({
    id: "payout-1",
    payeeKey: `DRIVER:${driver.userId}`,
    driverUserId: driver.userId,
    amountMinor: 700
  });

  const summary = await service.getOwnCashSummary(driver.userId, "ALL");

  assert.equal(summary.earningsMinor, 700);
  assert.equal(summary.balance.earningsOwedToDriverMinor, 0);
  assert.equal(summary.balance.cashOwedToPlatformMinor, 3200, "the payout does not touch the cash owed");
});

test("the driver profile reports the persisted shift state, so a reopened app can show it", async () => {
  const { prisma, service } = createService();
  const driver = prisma.seedDriver({ isOnline: true });

  assert.equal((await service.getOwnProfile(driver.userId)).isOnline, true);
  await service.setOnlineStatus(driver.userId, false);
  assert.equal((await service.getOwnProfile(driver.userId)).isOnline, false);
});

test("reporting a position is broadcast to admins only, never to an order room the customer can join", async () => {
  const { prisma, realtime, service } = createService();
  const driver = prisma.seedDriver();

  await service.updateLocation(driver.userId, 31.9, 35.2);

  const locationEvents = realtime.emitted.filter((event) => event.event === "driver.location.updated");
  assert.equal(locationEvents.length, 1);
  assert.equal(locationEvents[0].room, "admins");
  assert.deepEqual(
    { ...(locationEvents[0].payload as object), lastLocationAt: undefined },
    { userId: driver.userId, latitude: 31.9, longitude: 35.2, lastLocationAt: undefined }
  );
  assert.ok(!realtime.emitted.some((event) => event.room.startsWith("order:") && event.event.includes("location")));
});

test("going online or offline, and moving a delivery along, are announced to admins", async () => {
  const { prisma, realtime, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const driver = prisma.seedDriver({ isOnline: false });

  await service.setOnlineStatus(driver.userId, true);
  assert.ok(realtime.emitted.some((event) => event.room === "admins" && event.event === "driver.status.changed"));

  const order = prisma.seedOrder(restaurant.id);
  prisma.seedOrderItem(order.id);
  const delivery = prisma.seedDelivery(order.id, { status: "PENDING_ASSIGNMENT" as never });
  await service.acceptDelivery(driver.userId, delivery.id);
  const accepted = realtime.emitted.find((event) => event.room === "admins" && event.event === "delivery.status.changed");
  assert.ok(accepted);
  assert.equal((accepted!.payload as { driverUserId: string }).driverUserId, driver.userId);
});

test("the admin live list shows on-shift drivers and anyone mid-delivery, with their last position", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant({ name: "JOVO MARKET" });
  const reported = new Date();
  const idle = prisma.seedDriver({ isOnline: true, lastLatitude: 31.83, lastLongitude: 35.14, lastLocationAt: reported });
  const noFixYet = prisma.seedDriver({ isOnline: true });
  const offline = prisma.seedDriver({ isOnline: false });
  const pending = prisma.seedDriver({ status: "PENDING" as never, isOnline: true });
  const offlineButDelivering = prisma.seedDriver({ isOnline: false, lastLatitude: 31.9, lastLongitude: 35.2 });
  const order = prisma.seedOrder(restaurant.id);
  prisma.seedOrderItem(order.id);
  prisma.seedDelivery(order.id, { driverId: offlineButDelivering.userId, status: "ON_THE_WAY" as never });

  const list = await service.adminListDriverLocations();
  const ids = list.map((entry) => entry.userId);

  assert.ok(ids.includes(idle.userId) && ids.includes(noFixYet.userId) && ids.includes(offlineButDelivering.userId));
  assert.ok(!ids.includes(offline.userId), "an offline driver with no job is not on the map");
  assert.ok(!ids.includes(pending.userId), "an unapproved driver is not on the map");

  const located = list.find((entry) => entry.userId === idle.userId)!;
  assert.equal(located.latitude, 31.83);
  assert.equal(located.longitude, 35.14);
  assert.equal(located.lastLocationAt?.getTime(), reported.getTime());
  assert.equal(located.activeDelivery, null);
  assert.equal(list.find((entry) => entry.userId === noFixYet.userId)!.latitude, null);
  const delivering = list.find((entry) => entry.userId === offlineButDelivering.userId)!;
  assert.equal(delivering.activeDelivery?.orderId, order.id);
  assert.equal(delivering.activeDelivery?.restaurantName, "JOVO MARKET");
});

test("order tracking returns the assigned driver's position with pickup and destination", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant({ name: "JOVO MARKET", latitude: 31.84, longitude: 35.15 });
  const driver = prisma.seedDriver({ lastLatitude: 31.85, lastLongitude: 35.16, lastLocationAt: new Date() });
  const order = prisma.seedOrder(restaurant.id, { deliveryLatitude: 31.86, deliveryLongitude: 35.17 });
  prisma.seedOrderItem(order.id);
  const delivery = prisma.seedDelivery(order.id, { driverId: driver.userId, status: "PICKED_UP" as never });

  const tracking = await service.adminGetOrderTracking(order.id);

  assert.equal(tracking.deliveryId, delivery.id);
  assert.equal(tracking.deliveryStatus, "PICKED_UP");
  assert.equal(tracking.driver?.userId, driver.userId);
  assert.equal(tracking.driver?.latitude, 31.85);
  assert.deepEqual(tracking.pickup, { name: "JOVO MARKET", latitude: 31.84, longitude: 35.15 });
  assert.deepEqual(tracking.destination, { label: "Home", latitude: 31.86, longitude: 35.17 });
});

test("tracking an order with no driver yet returns no driver rather than an error, and an unknown order is a 404", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const order = prisma.seedOrder(restaurant.id);
  prisma.seedOrderItem(order.id);
  prisma.seedDelivery(order.id, { status: "PENDING_ASSIGNMENT" as never });

  const tracking = await service.adminGetOrderTracking(order.id);
  assert.equal(tracking.driver, null);
  assert.equal(tracking.deliveryStatus, "PENDING_ASSIGNMENT");

  await assert.rejects(
    service.adminGetOrderTracking("00000000-0000-4000-8000-000000000000"),
    (error: unknown) => error instanceof ApiException && error.getStatus() === 404
  );
});

// ---------------------------------------------------------------------------------------------
// The road route on the driver's map

function routingReturning(route: unknown) {
  const calls: { from: unknown; to: unknown }[] = [];
  return { calls, service: { route: async (from: unknown, to: unknown) => (calls.push({ from, to }), route) } };
}

function serviceWithRouting(routing: unknown) {
  const prisma = new FakeDriversPrisma();
  const realtime = new FakeRealtimeGateway();
  return { prisma, service: new DriversService(prisma as never, realtime as never, undefined, routing as never) };
}

test("the route runs from the store to the customer's address, for the driver's own delivery", async () => {
  const road = { points: [[31.838, 35.14], [31.9, 35.2]] as [number, number][], distanceMeters: 13_618, durationSeconds: 1_349 };
  const routing = routingReturning(road);
  const { prisma, service } = serviceWithRouting(routing.service);
  const restaurant = prisma.seedRestaurant({ latitude: 31.83804, longitude: 35.14047 });
  const driver = prisma.seedDriver();
  const order = prisma.seedOrder(restaurant.id, { deliveryLatitude: 31.9038, deliveryLongitude: 35.2034 });
  prisma.seedOrderItem(order.id);
  const delivery = prisma.seedDelivery(order.id, { driverId: driver.userId, status: "ASSIGNED" as never });

  const view = await service.getDeliveryRoute(driver.userId, delivery.id);

  assert.deepEqual(view.route, road);
  assert.equal(view.unavailableReason, null);
  assert.deepEqual(routing.calls[0], {
    from: { latitude: 31.83804, longitude: 35.14047 },
    to: { latitude: 31.9038, longitude: 35.2034 }
  });
});

test("a driver cannot ask for a route on somebody else's delivery", async () => {
  const routing = routingReturning({ points: [], distanceMeters: 1, durationSeconds: 1 });
  const { prisma, service } = serviceWithRouting(routing.service);
  const restaurant = prisma.seedRestaurant({ latitude: 31.8, longitude: 35.1 });
  const owner = prisma.seedDriver();
  const other = prisma.seedDriver();
  const order = prisma.seedOrder(restaurant.id, { deliveryLatitude: 31.9, deliveryLongitude: 35.2 });
  prisma.seedOrderItem(order.id);
  const delivery = prisma.seedDelivery(order.id, { driverId: owner.userId, status: "ASSIGNED" as never });

  await assert.rejects(
    service.getDeliveryRoute(other.userId, delivery.id),
    (error: unknown) => error instanceof ApiException && error.getStatus() === 404
  );
  assert.equal(routing.calls.length, 0, "no routing request is made on their behalf");
});

test("a store or order without coordinates says so instead of asking a routing service about nowhere", async () => {
  const routing = routingReturning({ points: [], distanceMeters: 1, durationSeconds: 1 });
  const { prisma, service } = serviceWithRouting(routing.service);
  const restaurant = prisma.seedRestaurant();
  const driver = prisma.seedDriver();
  const order = prisma.seedOrder(restaurant.id);
  prisma.seedOrderItem(order.id);
  const delivery = prisma.seedDelivery(order.id, { driverId: driver.userId, status: "ASSIGNED" as never });

  const view = await service.getDeliveryRoute(driver.userId, delivery.id);

  assert.equal(view.route, null);
  assert.equal(view.unavailableReason, "NO_COORDINATES");
  assert.equal(routing.calls.length, 0);
});

test("when the routing service has nothing, the reply says unavailable: there is no invented straight line", async () => {
  const { prisma, service } = serviceWithRouting(routingReturning(null).service);
  const restaurant = prisma.seedRestaurant({ latitude: 31.8, longitude: 35.1 });
  const driver = prisma.seedDriver();
  const order = prisma.seedOrder(restaurant.id, { deliveryLatitude: 31.9, deliveryLongitude: 35.2 });
  prisma.seedOrderItem(order.id);
  const delivery = prisma.seedDelivery(order.id, { driverId: driver.userId, status: "ASSIGNED" as never });

  const view = await service.getDeliveryRoute(driver.userId, delivery.id);

  assert.equal(view.route, null);
  assert.equal(view.unavailableReason, "UNAVAILABLE");
});

// ---------------------------------------------------------------------------------------------
// One number to hand over, and the orders behind it

test("the orders behind the amount to hand over are listed, oldest first, whatever period is on screen", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant({ name: "Al-Quds Market" });
  const driver = prisma.seedDriver();
  const first = await completeDelivery(prisma, service, restaurant.id, driver.userId);
  const second = await completeDelivery(prisma, service, restaurant.id, driver.userId);
  // The first order is from last week and was never handed over; the second is from today.
  const weekAgo = new Date(Date.now() - 8 * 86_400_000);
  prisma.accounting.driverCashCustodies.find((row) => row.orderId === first.id)!.collectedAt = weekAgo;
  for (const earning of prisma.accounting.earningsForOrderRecord(first.id)) earning.occurredAt = weekAgo;

  const today = await service.getOwnCashSummary(driver.userId, "TODAY");

  assert.equal(today.balance.cashOwedToPlatformMinor, 6_400);
  assert.deepEqual(today.balance.openOrders.map((line) => line.orderId), [first.id, second.id], "oldest first");
  assert.equal(today.balance.openOrders.reduce((sum, line) => sum + line.cashOwedToPlatformMinor, 0), 6_400,
    "the listed orders add up to exactly the number to hand over");
  assert.ok(today.balance.openOrders.every((line) => line.restaurantName === "Al-Quds Market"));
  assert.equal(today.lines.length, 1, "while the period's own list is just today's order");
  assert.equal(today.balance.openOrdersTruncated, false);
});

test("an order that has been handed over is no longer in the list to hand over", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const driver = prisma.seedDriver();
  const first = await completeDelivery(prisma, service, restaurant.id, driver.userId);
  await completeDelivery(prisma, service, restaurant.id, driver.userId);
  handOver(prisma, driver.userId, new Date(), [first.id]);

  const summary = await service.getOwnCashSummary(driver.userId, "ALL");

  assert.equal(summary.balance.openOrders.length, 1);
  assert.equal(summary.balance.cashOwedToPlatformMinor, 3_200);
  assert.equal(summary.balance.openOrders[0].cashOwedToPlatformMinor, 3_200);
});

test("a driver holding nothing has an empty list and a zero to hand over", async () => {
  const { prisma, service } = createService();
  const driver = prisma.seedDriver();

  const summary = await service.getOwnCashSummary(driver.userId, "SHIFT");

  assert.equal(summary.balance.cashOwedToPlatformMinor, 0);
  assert.deepEqual(summary.balance.openOrders, []);
});

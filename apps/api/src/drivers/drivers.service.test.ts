import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ApiException } from "../common/api.exception";
import { DriverApprovalStatus, OrderStatus } from "../generated/prisma/client";
import { FakeRealtimeGateway } from "../realtime/testing/fake-realtime-gateway";
import { DriversService } from "./drivers.service";
import { FakeDriversPrisma } from "./testing/fake-prisma";

function createService() {
  const prisma = new FakeDriversPrisma();
  const realtime = new FakeRealtimeGateway();
  const service = new DriversService(prisma as never, realtime as never);
  return { prisma, realtime, service };
}

function registerInput(overrides: Record<string, unknown> = {}) {
  return {
    countryCode: "+970" as const,
    phoneNumber: "0591234567",
    fullName: "New Driver",
    password: "Strong@123",
    confirmPassword: "Strong@123",
    ...overrides
  };
}

test("registering a driver creates a DRIVER user and an offline driver profile", async () => {
  const { prisma, service } = createService();
  const result = await service.register(registerInput() as never);

  assert.equal(prisma.users.length, 1);
  assert.equal(prisma.users[0].role, "DRIVER");
  assert.equal(prisma.driverProfiles.length, 1);
  assert.equal(prisma.driverProfiles[0].isOnline, false);
  assert.equal(prisma.driverProfiles[0].userId, result.userId);
});

test("registering with a phone that already has an account is rejected", async () => {
  const { prisma, service } = createService();
  await service.register(registerInput() as never);

  await assert.rejects(service.register(registerInput() as never), hasCode("PHONE_ALREADY_REGISTERED"));
  assert.equal(prisma.users.length, 1);
});

test("registering with mismatched passwords is rejected before touching the database", async () => {
  const { prisma, service } = createService();
  await assert.rejects(
    service.register(registerInput({ confirmPassword: "Different@123" }) as never),
    hasCode("PASSWORDS_DO_NOT_MATCH")
  );
  assert.equal(prisma.users.length, 0);
});

test("a driver can toggle online status", async () => {
  const { prisma, service } = createService();
  const driver = prisma.seedDriver({ isOnline: false });

  const online = await service.setOnlineStatus(driver.userId, true);
  assert.equal(online.isOnline, true);

  const offline = await service.setOnlineStatus(driver.userId, false);
  assert.equal(offline.isOnline, false);
});

test("an offline driver cannot accept a delivery", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const order = prisma.seedOrder(restaurant.id);
  const delivery = prisma.seedDelivery(order.id);
  const driver = prisma.seedDriver({ isOnline: false });

  await assert.rejects(service.acceptDelivery(driver.userId, delivery.id), hasCode("DRIVER_OFFLINE"));
  assert.equal(prisma.deliveries[0].driverId, null);
});

test("an online driver accepts a pending delivery", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const order = prisma.seedOrder(restaurant.id);
  const delivery = prisma.seedDelivery(order.id);
  const driver = prisma.seedDriver({ isOnline: true });

  const accepted = await service.acceptDelivery(driver.userId, delivery.id);
  assert.equal(accepted.status, "ASSIGNED");
  assert.ok(accepted.assignedAt);
  assert.equal(prisma.deliveries[0].driverId, driver.userId);
});

test("a second driver cannot accept a delivery someone else already claimed", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const order = prisma.seedOrder(restaurant.id);
  const delivery = prisma.seedDelivery(order.id);
  const driverA = prisma.seedDriver({ isOnline: true });
  const driverB = prisma.seedDriver({ isOnline: true });

  await service.acceptDelivery(driverA.userId, delivery.id);
  await assert.rejects(service.acceptDelivery(driverB.userId, delivery.id), hasCode("DELIVERY_ALREADY_CLAIMED"));
  assert.equal(prisma.deliveries[0].driverId, driverA.userId);
});

test("a driver holding an active delivery cannot accept a second one", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const firstOrder = prisma.seedOrder(restaurant.id);
  const secondOrder = prisma.seedOrder(restaurant.id);
  const firstDelivery = prisma.seedDelivery(firstOrder.id);
  const secondDelivery = prisma.seedDelivery(secondOrder.id);
  const driver = prisma.seedDriver({ isOnline: true });

  await service.acceptDelivery(driver.userId, firstDelivery.id);
  await assert.rejects(
    service.acceptDelivery(driver.userId, secondDelivery.id),
    hasCode("DELIVERY_DRIVER_HAS_ACTIVE")
  );
  assert.equal(prisma.deliveries.find((delivery) => delivery.id === secondDelivery.id)?.driverId ?? null, null);
});

test("driver stats count completed deliveries and pay a flat 7 ILS each", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const driver = prisma.seedDriver({ isOnline: true });
  // Three delivered, one in progress, one belonging to another driver (must be excluded).
  for (let index = 0; index < 3; index += 1) {
    const order = prisma.seedOrder(restaurant.id);
    prisma.seedDelivery(order.id, { driverId: driver.userId, status: "DELIVERED" as never });
  }
  const activeOrder = prisma.seedOrder(restaurant.id);
  prisma.seedDelivery(activeOrder.id, { driverId: driver.userId, status: "ON_THE_WAY" as never });
  const other = prisma.seedDriver({ isOnline: true });
  const otherOrder = prisma.seedOrder(restaurant.id);
  prisma.seedDelivery(otherOrder.id, { driverId: other.userId, status: "DELIVERED" as never });

  const stats = await service.getOwnStats(driver.userId);
  assert.equal(stats.completedCount, 3);
  assert.equal(stats.activeCount, 1);
  assert.equal(stats.earningsMinor, 2100);
  assert.equal(stats.perDeliveryMinor, 700);
});

test("two drivers accepting the same delivery simultaneously: exactly one succeeds", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const order = prisma.seedOrder(restaurant.id);
  const delivery = prisma.seedDelivery(order.id);
  const driverA = prisma.seedDriver({ isOnline: true });
  const driverB = prisma.seedDriver({ isOnline: true });

  const results = await Promise.allSettled([
    service.acceptDelivery(driverA.userId, delivery.id),
    service.acceptDelivery(driverB.userId, delivery.id)
  ]);

  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.filter((item) => item.status === "rejected").length, 1);
  assert.ok(prisma.deliveries[0].driverId === driverA.userId || prisma.deliveries[0].driverId === driverB.userId);
});

test("an assigned delivery advances through picked-up, on-the-way, and delivered", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const order = prisma.seedOrder(restaurant.id);
  const delivery = prisma.seedDelivery(order.id);
  const driver = prisma.seedDriver({ isOnline: true });
  await service.acceptDelivery(driver.userId, delivery.id);

  const pickedUp = await service.updateDeliveryStatus(driver.userId, delivery.id, "PICKED_UP");
  assert.equal(pickedUp.status, "PICKED_UP");
  assert.ok(pickedUp.pickedUpAt);

  const onTheWay = await service.updateDeliveryStatus(driver.userId, delivery.id, "ON_THE_WAY");
  assert.equal(onTheWay.status, "ON_THE_WAY");

  const delivered = await service.updateDeliveryStatus(driver.userId, delivery.id, "DELIVERED");
  assert.equal(delivered.status, "DELIVERED");
  assert.ok(delivered.deliveredAt);

  const updatedOrder = prisma.orders.find((candidate) => candidate.id === order.id)!;
  assert.equal(updatedOrder.status, OrderStatus.DELIVERED);
  const history = prisma.orderStatusHistories.filter((entry) => entry.orderId === order.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].toStatus, OrderStatus.DELIVERED);
  assert.equal(history[0].changedByUserId, driver.userId);
});

test("out-of-order delivery transitions are rejected, e.g. skipping straight to DELIVERED", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const order = prisma.seedOrder(restaurant.id);
  const delivery = prisma.seedDelivery(order.id);
  const driver = prisma.seedDriver({ isOnline: true });
  await service.acceptDelivery(driver.userId, delivery.id);

  await assert.rejects(
    service.updateDeliveryStatus(driver.userId, delivery.id, "DELIVERED"),
    hasCode("DELIVERY_INVALID_TRANSITION")
  );
});

test("a driver cannot advance a delivery assigned to a different driver", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const order = prisma.seedOrder(restaurant.id);
  const delivery = prisma.seedDelivery(order.id);
  const driverA = prisma.seedDriver({ isOnline: true });
  const driverB = prisma.seedDriver({ isOnline: true });
  await service.acceptDelivery(driverA.userId, delivery.id);

  await assert.rejects(
    service.updateDeliveryStatus(driverB.userId, delivery.id, "PICKED_UP"),
    hasCode("DELIVERY_NOT_FOUND")
  );
});

test("available deliveries only include unclaimed ones, and own deliveries only include the caller's", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const orderA = prisma.seedOrder(restaurant.id);
  const orderB = prisma.seedOrder(restaurant.id);
  const deliveryA = prisma.seedDelivery(orderA.id);
  const deliveryB = prisma.seedDelivery(orderB.id);
  const driver = prisma.seedDriver({ isOnline: true });

  await service.acceptDelivery(driver.userId, deliveryA.id);

  const available = await service.listAvailableDeliveries();
  assert.equal(available.length, 1);
  assert.equal(available[0].id, deliveryB.id);

  const mine = await service.listOwnDeliveries(driver.userId, 1, 20);
  assert.equal(mine.total, 1);
  assert.equal(mine.items[0].id, deliveryA.id);
});

test("a newly registered driver starts PENDING and cannot go online until approved", async () => {
  const { prisma, service } = createService();
  const result = await service.register(registerInput() as never);
  assert.equal(prisma.driverProfiles[0].status, DriverApprovalStatus.PENDING);

  await assert.rejects(service.setOnlineStatus(result.userId, true), hasCode("DRIVER_NOT_APPROVED"));
});

test("an approved driver can go online", async () => {
  const { prisma, service } = createService();
  const driver = prisma.seedDriver({ status: DriverApprovalStatus.APPROVED, isOnline: false });

  const profile = await service.setOnlineStatus(driver.userId, true);
  assert.equal(profile.isOnline, true);
});

test("admin approves a pending driver, records an AuditLog entry, and notifies the driver", async () => {
  const { prisma, realtime, service } = createService();
  const admin = randomUUID();
  const driver = prisma.seedDriver({ status: DriverApprovalStatus.PENDING, isOnline: false });

  const approved = await service.adminApprove(admin, driver.userId);
  assert.equal(approved.status, "APPROVED");

  const auditEntry = prisma.auditLogs.find((entry) => entry.entityId === driver.userId);
  assert.ok(auditEntry);
  assert.equal(auditEntry!.action, "DRIVER_APPROVED");
  assert.equal(auditEntry!.actorUserId, admin);

  const notification = prisma.notifications.find((entry) => entry.userId === driver.userId);
  assert.ok(notification);
  assert.equal(notification!.type, "DRIVER_APPROVED");
  assert.ok(realtime.emitted.some((event) => event.room === `user:${driver.userId}` && event.event === "notification.created"));
});

test("admin rejects a pending driver with a reason, recorded in the AuditLog", async () => {
  const { prisma, service } = createService();
  const admin = randomUUID();
  const driver = prisma.seedDriver({ status: DriverApprovalStatus.PENDING, isOnline: false });

  const rejected = await service.adminReject(admin, driver.userId, "Failed background check");
  assert.equal(rejected.status, "REJECTED");

  const auditEntry = prisma.auditLogs.find((entry) => entry.entityId === driver.userId);
  assert.equal(auditEntry!.reason, "Failed background check");
});

test("admin cannot approve a driver that is not currently pending", async () => {
  const { prisma, service } = createService();
  const admin = randomUUID();
  const driver = prisma.seedDriver({ status: DriverApprovalStatus.APPROVED });

  await assert.rejects(service.adminApprove(admin, driver.userId), hasCode("DRIVER_INVALID_TRANSITION"));
});

test("admin suspends an approved driver, which also forces them offline, then reactivates them", async () => {
  const { prisma, service } = createService();
  const admin = randomUUID();
  const driver = prisma.seedDriver({ status: DriverApprovalStatus.APPROVED, isOnline: true });

  const suspended = await service.adminSuspend(admin, driver.userId, "Customer complaints");
  assert.equal(suspended.status, "SUSPENDED");
  assert.equal(suspended.isOnline, false);

  const reactivated = await service.adminReactivate(admin, driver.userId);
  assert.equal(reactivated.status, "APPROVED");
});

test("adminListDrivers reports completed-delivery counts and the current active delivery", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const completedOrder = prisma.seedOrder(restaurant.id);
  const activeOrder = prisma.seedOrder(restaurant.id);
  const driver = prisma.seedDriver({ status: DriverApprovalStatus.APPROVED });
  prisma.seedDelivery(completedOrder.id, { driverId: driver.userId, status: "DELIVERED" as never });
  const activeDelivery = prisma.seedDelivery(activeOrder.id, { driverId: driver.userId, status: "PICKED_UP" as never });

  const list = await service.adminListDrivers();
  const view = list.find((item) => item.userId === driver.userId)!;
  assert.equal(view.completedDeliveriesCount, 1);
  assert.equal(view.activeDeliveryId, activeDelivery.id);
});

test("a driver cannot advance a delivery whose order has been cancelled", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const order = prisma.seedOrder(restaurant.id);
  const delivery = prisma.seedDelivery(order.id);
  const driver = prisma.seedDriver({ isOnline: true });
  await service.acceptDelivery(driver.userId, delivery.id);
  await service.updateDeliveryStatus(driver.userId, delivery.id, "PICKED_UP");
  await service.updateDeliveryStatus(driver.userId, delivery.id, "ON_THE_WAY");

  // An administrator cancels the order while the driver is en route with the goods.
  prisma.orders[0].status = OrderStatus.CANCELLED;

  // The delivery's own transition table would happily allow ON_THE_WAY -> DELIVERED; only the
  // order-status guard stops it, which is exactly the resurrection this test exists for.
  await assert.rejects(
    service.updateDeliveryStatus(driver.userId, delivery.id, "DELIVERED"),
    hasCode("DELIVERY_ORDER_NOT_ACTIVE")
  );
  assert.equal(prisma.orders[0].status, OrderStatus.CANCELLED);
  assert.equal(prisma.deliveries[0].status, "ON_THE_WAY");
});

test("a driver cannot claim a delivery whose order is no longer awaiting handover", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const order = prisma.seedOrder(restaurant.id, { status: OrderStatus.CANCELLED });
  const delivery = prisma.seedDelivery(order.id);
  const driver = prisma.seedDriver({ isOnline: true });

  await assert.rejects(
    service.acceptDelivery(driver.userId, delivery.id),
    hasCode("DELIVERY_ORDER_NOT_ACTIVE")
  );
  assert.equal(prisma.deliveries[0].driverId, null);
});

test("reporting a failed delivery records the reason, the fault, and moves the order to DELIVERY_FAILED", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const order = prisma.seedOrder(restaurant.id);
  const delivery = prisma.seedDelivery(order.id);
  const driver = prisma.seedDriver({ isOnline: true });
  await service.acceptDelivery(driver.userId, delivery.id);
  await service.updateDeliveryStatus(driver.userId, delivery.id, "PICKED_UP");

  const failed = await service.updateDeliveryStatus(driver.userId, delivery.id, "FAILED", {
    failureReason: "CUSTOMER_UNREACHABLE",
    failureNote: "Phoned three times from the door."
  });

  assert.equal(failed.status, "FAILED");
  const stored = prisma.deliveries[0];
  assert.equal(stored.failureReason, "CUSTOMER_UNREACHABLE");
  assert.equal(stored.faultParty, "CUSTOMER");
  assert.equal(stored.failureNote, "Phoned three times from the door.");
  assert.ok(stored.failedAt);
  // Distinct from CANCELLED, because money still moves on a failed delivery.
  assert.equal(prisma.orders[0].status, OrderStatus.DELIVERY_FAILED);
});

test("a failed delivery is refused without a reason", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const order = prisma.seedOrder(restaurant.id);
  const delivery = prisma.seedDelivery(order.id);
  const driver = prisma.seedDriver({ isOnline: true });
  await service.acceptDelivery(driver.userId, delivery.id);

  await assert.rejects(
    service.updateDeliveryStatus(driver.userId, delivery.id, "FAILED"),
    hasCode("DELIVERY_FAILURE_REASON_REQUIRED")
  );
  assert.equal(prisma.deliveries[0].status, "ASSIGNED");
  assert.equal(prisma.orders[0].status, OrderStatus.READY_FOR_PICKUP);
});

test("driver-related failures are left UNDETERMINED so nobody is charged without review", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const order = prisma.seedOrder(restaurant.id);
  const delivery = prisma.seedDelivery(order.id);
  const driver = prisma.seedDriver({ isOnline: true });
  await service.acceptDelivery(driver.userId, delivery.id);

  await service.updateDeliveryStatus(driver.userId, delivery.id, "FAILED", { failureReason: "DRIVER_ISSUE" });

  assert.equal(prisma.deliveries[0].faultParty, "UNDETERMINED");
});

test("a business error attributes the failure to the business", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const order = prisma.seedOrder(restaurant.id);
  const delivery = prisma.seedDelivery(order.id);
  const driver = prisma.seedDriver({ isOnline: true });
  await service.acceptDelivery(driver.userId, delivery.id);

  await service.updateDeliveryStatus(driver.userId, delivery.id, "FAILED", { failureReason: "BUSINESS_ERROR" });

  assert.equal(prisma.deliveries[0].faultParty, "BUSINESS");
});

test("a terminal delivery cannot be moved again", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const order = prisma.seedOrder(restaurant.id);
  const delivery = prisma.seedDelivery(order.id);
  const driver = prisma.seedDriver({ isOnline: true });
  await service.acceptDelivery(driver.userId, delivery.id);
  await service.updateDeliveryStatus(driver.userId, delivery.id, "FAILED", { failureReason: "CUSTOMER_REFUSED" });

  await assert.rejects(
    service.updateDeliveryStatus(driver.userId, delivery.id, "DELIVERED"),
    hasCode("DELIVERY_INVALID_TRANSITION")
  );
});

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof ApiException && (error.getResponse() as { code?: string }).code === code;
}

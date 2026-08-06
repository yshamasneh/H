import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ApiException } from "../common/api.exception";
import { RestaurantStatus } from "../generated/prisma/client";
import { FakeRealtimeGateway } from "../realtime/testing/fake-realtime-gateway";
import { FakeOrdersPrisma } from "./testing/fake-prisma";
import { OrdersService } from "./orders.service";

function createService() {
  const prisma = new FakeOrdersPrisma();
  const realtime = new FakeRealtimeGateway();
  const service = new OrdersService(prisma as never, realtime as never);
  return { prisma, realtime, service };
}

function baseInput(restaurantId: string, menuItemId: string, overrides: Record<string, unknown> = {}) {
  return {
    restaurantId,
    items: [{ menuItemId, quantity: 2 }],
    deliveryLabel: "Home",
    deliveryAddressLine: "Al-Manara Square, Ramallah",
    paymentMethod: "CASH" as const,
    ...overrides
  };
}

test("server ignores a client-supplied price and uses the real database price", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id, { priceMinor: 1500 });
  const customerId = randomUUID();

  const input = baseInput(restaurant.id, menuItem.id, {
    items: [{ menuItemId: menuItem.id, quantity: 2, priceMinor: 1 }]
  });

  const order = await service.createOrder(customerId, input as never);

  assert.equal(order.items[0].priceMinorSnapshot, 1500);
  assert.equal(order.subtotalMinor, 3000);
});

test("order creation is rejected when the restaurant is not approved", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant({ status: RestaurantStatus.PENDING });
  const menuItem = prisma.seedMenuItem(restaurant.id);

  await assert.rejects(
    service.createOrder(randomUUID(), baseInput(restaurant.id, menuItem.id) as never),
    hasCode("RESTAURANT_NOT_FOUND")
  );
  assert.equal(prisma.orders.length, 0);
});

test("order creation is rejected when the restaurant is closed", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant({ isOpen: false });
  const menuItem = prisma.seedMenuItem(restaurant.id);

  await assert.rejects(
    service.createOrder(randomUUID(), baseInput(restaurant.id, menuItem.id) as never),
    hasCode("RESTAURANT_CLOSED")
  );
  assert.equal(prisma.orders.length, 0);
});

test("order creation is rejected when a requested item is unavailable, with no partial order created", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const availableItem = prisma.seedMenuItem(restaurant.id, { name: "Available" });
  const unavailableItem = prisma.seedMenuItem(restaurant.id, { name: "Unavailable", isAvailable: false });

  const input = {
    restaurantId: restaurant.id,
    items: [
      { menuItemId: availableItem.id, quantity: 1 },
      { menuItemId: unavailableItem.id, quantity: 1 }
    ],
    deliveryLabel: "Home",
    deliveryAddressLine: "Al-Manara Square, Ramallah",
    paymentMethod: "CASH" as const
  };

  await assert.rejects(service.createOrder(randomUUID(), input as never), hasCode("ORDER_ITEM_UNAVAILABLE"));
  assert.equal(prisma.orders.length, 0);
  assert.equal(prisma.orderItems.length, 0);
});

test("order creation is rejected when a requested item belongs to a different restaurant, with no partial order created", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const otherRestaurant = prisma.seedRestaurant({ name: "Other" });
  const ownItem = prisma.seedMenuItem(restaurant.id);
  const foreignItem = prisma.seedMenuItem(otherRestaurant.id);

  const input = {
    restaurantId: restaurant.id,
    items: [
      { menuItemId: ownItem.id, quantity: 1 },
      { menuItemId: foreignItem.id, quantity: 1 }
    ],
    deliveryLabel: "Home",
    deliveryAddressLine: "Al-Manara Square, Ramallah",
    paymentMethod: "CASH" as const
  };

  await assert.rejects(service.createOrder(randomUUID(), input as never), hasCode("ORDER_ITEM_UNAVAILABLE"));
  assert.equal(prisma.orders.length, 0);
});

test("order totals match server-computed subtotal, fees, and total", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const itemA = prisma.seedMenuItem(restaurant.id, { priceMinor: 1000 });
  const itemB = prisma.seedMenuItem(restaurant.id, { priceMinor: 750 });

  const input = {
    restaurantId: restaurant.id,
    items: [
      { menuItemId: itemA.id, quantity: 2 },
      { menuItemId: itemB.id, quantity: 3 }
    ],
    deliveryLabel: "Home",
    deliveryAddressLine: "Al-Manara Square, Ramallah",
    paymentMethod: "CASH" as const
  };

  const order = await service.createOrder(randomUUID(), input as never);

  const expectedSubtotal = 1000 * 2 + 750 * 3;
  assert.equal(order.subtotalMinor, expectedSubtotal);
  assert.equal(order.discountMinor, 0);
  assert.equal(
    order.totalMinor,
    order.subtotalMinor + order.deliveryFeeMinor + order.serviceFeeMinor - order.discountMinor
  );
});

test("customer A cannot read customer B's order", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id);
  const customerA = randomUUID();
  const customerB = randomUUID();

  const order = await service.createOrder(customerA, baseInput(restaurant.id, menuItem.id) as never);

  await assert.rejects(service.getForCustomer(customerB, order.id), hasCode("ORDER_NOT_FOUND"));
  const ownOrder = await service.getForCustomer(customerA, order.id);
  assert.equal(ownOrder.id, order.id);
});

test("restaurant A cannot read restaurant B's incoming orders", async () => {
  const { prisma, service } = createService();
  const restaurantA = prisma.seedRestaurant();
  const restaurantB = prisma.seedRestaurant({ name: "Other" });
  const itemA = prisma.seedMenuItem(restaurantA.id);

  const order = await service.createOrder(randomUUID(), baseInput(restaurantA.id, itemA.id) as never);

  await assert.rejects(service.getForRestaurantOwner(restaurantB.ownerUserId, order.id), hasCode("ORDER_NOT_FOUND"));
  const ownOrder = await service.getForRestaurantOwner(restaurantA.ownerUserId, order.id);
  assert.equal(ownOrder.id, order.id);

  const restaurantBOrders = await service.listForRestaurantOwner(restaurantB.ownerUserId, 1, 20);
  assert.equal(restaurantBOrders.total, 0);
});

test("order item snapshots remain correct even after the underlying menu item's price changes", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id, { priceMinor: 1200, name: "Original Name" });

  const order = await service.createOrder(randomUUID(), baseInput(restaurant.id, menuItem.id) as never);
  assert.equal(order.items[0].priceMinorSnapshot, 1200);
  assert.equal(order.items[0].nameSnapshot, "Original Name");

  const storedMenuItem = prisma.menuItems.find((item) => item.id === menuItem.id)!;
  storedMenuItem.priceMinor = 5000;
  storedMenuItem.name = "Renamed Item";

  const rawOrder = prisma.orders.find((candidate) => candidate.id === order.id)!;
  const refetched = await service.getForCustomer(rawOrder.customerId, order.id);

  assert.equal(refetched.items[0].priceMinorSnapshot, 1200);
  assert.equal(refetched.items[0].nameSnapshot, "Original Name");
});

test("a freshly placed order has one status history entry recording PLACED", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id);

  const order = await service.createOrder(randomUUID(), baseInput(restaurant.id, menuItem.id) as never);

  assert.equal(order.statusHistory.length, 1);
  assert.equal(order.statusHistory[0].fromStatus, null);
  assert.equal(order.statusHistory[0].toStatus, "PLACED");
  assert.equal(order.delivery, null);
});

test("restaurant owner accepts a placed order and it advances through preparing to ready-for-pickup", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id);
  const order = await service.createOrder(randomUUID(), baseInput(restaurant.id, menuItem.id) as never);

  const accepted = await service.updateStatusForRestaurantOwner(restaurant.ownerUserId, order.id, "ACCEPTED", undefined);
  assert.equal(accepted.status, "ACCEPTED");

  const preparing = await service.updateStatusForRestaurantOwner(restaurant.ownerUserId, order.id, "PREPARING", undefined);
  assert.equal(preparing.status, "PREPARING");

  const ready = await service.updateStatusForRestaurantOwner(
    restaurant.ownerUserId,
    order.id,
    "READY_FOR_PICKUP",
    "Bag is on the counter"
  );
  assert.equal(ready.status, "READY_FOR_PICKUP");

  assert.deepEqual(
    ready.statusHistory.map((entry) => entry.toStatus),
    ["PLACED", "ACCEPTED", "PREPARING", "READY_FOR_PICKUP"]
  );
  assert.equal(ready.statusHistory.at(-1)!.note, "Bag is on the counter");
  assert.equal(ready.statusHistory.at(-1)!.changedByUserId, restaurant.ownerUserId);
});

test("restaurant owner rejects a placed order", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id);
  const order = await service.createOrder(randomUUID(), baseInput(restaurant.id, menuItem.id) as never);

  const rejected = await service.updateStatusForRestaurantOwner(
    restaurant.ownerUserId,
    order.id,
    "REJECTED",
    "Out of stock"
  );
  assert.equal(rejected.status, "REJECTED");
});

test("out-of-order transitions are rejected, e.g. PLACED cannot jump straight to READY_FOR_PICKUP", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id);
  const order = await service.createOrder(randomUUID(), baseInput(restaurant.id, menuItem.id) as never);

  await assert.rejects(
    service.updateStatusForRestaurantOwner(restaurant.ownerUserId, order.id, "READY_FOR_PICKUP", undefined),
    hasCode("ORDER_INVALID_TRANSITION")
  );
});

test("a terminal order status cannot transition further", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id);
  const order = await service.createOrder(randomUUID(), baseInput(restaurant.id, menuItem.id) as never);
  await service.updateStatusForRestaurantOwner(restaurant.ownerUserId, order.id, "REJECTED", undefined);

  await assert.rejects(
    service.updateStatusForRestaurantOwner(restaurant.ownerUserId, order.id, "ACCEPTED", undefined),
    hasCode("ORDER_INVALID_TRANSITION")
  );
});

test("restaurant A cannot change the status of restaurant B's order", async () => {
  const { prisma, service } = createService();
  const restaurantA = prisma.seedRestaurant();
  const restaurantB = prisma.seedRestaurant({ name: "Other" });
  const itemA = prisma.seedMenuItem(restaurantA.id);
  const order = await service.createOrder(randomUUID(), baseInput(restaurantA.id, itemA.id) as never);

  await assert.rejects(
    service.updateStatusForRestaurantOwner(restaurantB.ownerUserId, order.id, "ACCEPTED", undefined),
    hasCode("ORDER_NOT_FOUND")
  );

  const untouched = await service.getForRestaurantOwner(restaurantA.ownerUserId, order.id);
  assert.equal(untouched.status, "PLACED");
});

test("customer sees the full status history via GET /orders/:id", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id);
  const customerId = randomUUID();
  const order = await service.createOrder(customerId, baseInput(restaurant.id, menuItem.id) as never);
  await service.updateStatusForRestaurantOwner(restaurant.ownerUserId, order.id, "ACCEPTED", undefined);

  const view = await service.getForCustomer(customerId, order.id);
  assert.equal(view.status, "ACCEPTED");
  assert.deepEqual(
    view.statusHistory.map((entry) => entry.toStatus),
    ["PLACED", "ACCEPTED"]
  );
});

test("placing an order notifies the restaurant owner and emits a realtime event", async () => {
  const { prisma, realtime, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id);

  const order = await service.createOrder(randomUUID(), baseInput(restaurant.id, menuItem.id) as never);

  const notification = prisma.notifications.find((entry) => entry.userId === restaurant.ownerUserId);
  assert.ok(notification);
  assert.equal(notification!.type, "ORDER_PLACED");
  assert.ok(realtime.emitted.some((event) => event.room === `restaurant:${restaurant.id}` && event.event === "order.created"));
  assert.ok(realtime.emitted.some((event) => event.room === "admins" && event.event === "order.created"));
  void order;
});

test("customer cancels their own PLACED order", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id);
  const customerId = randomUUID();
  const order = await service.createOrder(customerId, baseInput(restaurant.id, menuItem.id) as never);

  const cancelled = await service.cancelForCustomer(customerId, order.id);
  assert.equal(cancelled.status, "CANCELLED");

  const restaurantNotification = prisma.notifications.find(
    (entry) => entry.userId === restaurant.ownerUserId && entry.title === "Order cancelled by customer"
  );
  assert.ok(restaurantNotification);
});

test("customer cannot cancel an order the restaurant has already accepted", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id);
  const customerId = randomUUID();
  const order = await service.createOrder(customerId, baseInput(restaurant.id, menuItem.id) as never);
  await service.updateStatusForRestaurantOwner(restaurant.ownerUserId, order.id, "ACCEPTED", undefined);

  await assert.rejects(service.cancelForCustomer(customerId, order.id), hasCode("ORDER_NOT_CANCELLABLE"));
});

test("customer B cannot cancel customer A's order", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id);
  const customerA = randomUUID();
  const order = await service.createOrder(customerA, baseInput(restaurant.id, menuItem.id) as never);

  await assert.rejects(service.cancelForCustomer(randomUUID(), order.id), hasCode("ORDER_NOT_FOUND"));
});

test("admin cancels an ACCEPTED order with a reason, writing an AuditLog entry and notifying both parties", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id);
  const customerId = randomUUID();
  const adminId = randomUUID();
  const order = await service.createOrder(customerId, baseInput(restaurant.id, menuItem.id) as never);
  await service.updateStatusForRestaurantOwner(restaurant.ownerUserId, order.id, "ACCEPTED", undefined);

  const cancelled = await service.adminCancelOrder(adminId, order.id, "Restaurant called in sick, no capacity");
  assert.equal(cancelled.status, "CANCELLED");

  const auditEntry = prisma.auditLogs.find((entry) => entry.entityId === order.id);
  assert.ok(auditEntry);
  assert.equal(auditEntry!.action, "ORDER_CANCELLED_BY_ADMIN");
  assert.equal(auditEntry!.actorUserId, adminId);
  assert.equal(auditEntry!.reason, "Restaurant called in sick, no capacity");

  assert.ok(prisma.notifications.some((entry) => entry.userId === customerId && entry.title === "Your order was cancelled"));
  assert.ok(prisma.notifications.some((entry) => entry.userId === restaurant.ownerUserId));
});

test("admin cannot cancel an already-DELIVERED order", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id);
  const order = await service.createOrder(randomUUID(), baseInput(restaurant.id, menuItem.id) as never);
  // DriversService normally moves an order to DELIVERED as a side effect of completing its delivery;
  // this test only needs the end state, so the order's status is set directly on the fake store.
  const raw = prisma.orders.find((candidate) => candidate.id === order.id)!;
  raw.status = "DELIVERED" as never;

  await assert.rejects(service.adminCancelOrder(randomUUID(), order.id, "too late"), hasCode("ORDER_NOT_CANCELLABLE"));
});

test("adminListOrders filters by status and restaurant", async () => {
  const { prisma, service } = createService();
  const restaurantA = prisma.seedRestaurant();
  const restaurantB = prisma.seedRestaurant({ name: "Other" });
  const itemA = prisma.seedMenuItem(restaurantA.id);
  const itemB = prisma.seedMenuItem(restaurantB.id);
  const orderA = await service.createOrder(randomUUID(), baseInput(restaurantA.id, itemA.id) as never);
  await service.createOrder(randomUUID(), baseInput(restaurantB.id, itemB.id) as never);
  await service.updateStatusForRestaurantOwner(restaurantA.ownerUserId, orderA.id, "ACCEPTED", undefined);

  const acceptedOnly = await service.adminListOrders({ status: "ACCEPTED" } as never, 1, 20);
  assert.equal(acceptedOnly.total, 1);
  assert.equal(acceptedOnly.items[0].id, orderA.id);

  const restaurantAOnly = await service.adminListOrders({ restaurantId: restaurantA.id } as never, 1, 20);
  assert.equal(restaurantAOnly.total, 1);
});

test("adminGetOrder returns any order regardless of ownership", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id);
  const order = await service.createOrder(randomUUID(), baseInput(restaurant.id, menuItem.id) as never);

  const view = await service.adminGetOrder(order.id);
  assert.equal(view.id, order.id);
});

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof ApiException && (error.getResponse() as { code?: string }).code === code;
}

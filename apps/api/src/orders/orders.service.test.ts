import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ApiException } from "../common/api.exception";
import { BusinessType, RestaurantStatus } from "../generated/prisma/client";
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
    deliveryLatitude: 31.9038,
    deliveryLongitude: 35.2034,
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

test("order creation is rejected outside working hours even when the store switch is on", async () => {
  const { prisma, service } = createService();
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  // A one-hour window that starts an hour from now can never contain the current minute.
  const restaurant = prisma.seedRestaurant({ isOpen: true, opensAt: hhmm(current + 60), closesAt: hhmm(current + 120) });
  const menuItem = prisma.seedMenuItem(restaurant.id);

  await assert.rejects(
    service.createOrder(randomUUID(), baseInput(restaurant.id, menuItem.id) as never),
    hasCode("RESTAURANT_CLOSED")
  );
  assert.equal(prisma.orders.length, 0);
});

test("order creation succeeds inside working hours", async () => {
  const { prisma, service } = createService();
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  // A window centred on the current minute always contains it, wrap-around included.
  const restaurant = prisma.seedRestaurant({ isOpen: true, opensAt: hhmm(current - 30), closesAt: hhmm(current + 30) });
  const menuItem = prisma.seedMenuItem(restaurant.id, { priceMinor: 1500 });

  const order = await service.createOrder(randomUUID(), baseInput(restaurant.id, menuItem.id) as never);
  assert.equal(order.subtotalMinor, 3000);
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
    deliveryLatitude: 31.9038,
    deliveryLongitude: 35.2034,
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
    deliveryLatitude: 31.9038,
    deliveryLongitude: 35.2034,
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
    deliveryLatitude: 31.9038,
    deliveryLongitude: 35.2034,
    paymentMethod: "CASH" as const
  };

  const order = await service.createOrder(randomUUID(), input as never);

  const expectedSubtotal = 1000 * 2 + 750 * 3;
  assert.equal(order.subtotalMinor, expectedSubtotal);
  assert.equal(order.discountMinor, 0);
  assert.equal(
    order.totalMinor,
    order.subtotalMinor + order.deliveryFeeMinor - order.discountMinor
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

test("tracked supermarket stock is reserved and product preferences are snapshotted", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const product = prisma.seedMenuItem(restaurant.id, { stockQuantity: 5, unitLabel: "1 L bottle" });

  const order = await service.createOrder(randomUUID(), baseInput(restaurant.id, product.id, {
    items: [{ menuItemId: product.id, quantity: 2, allowSubstitution: true }]
  }) as never);

  assert.equal(prisma.menuItems.find((item) => item.id === product.id)!.stockQuantity, 3);
  assert.equal(order.items[0].unitLabelSnapshot, "1 L bottle");
  assert.equal(order.items[0].allowSubstitution, true);
});

test("an order exceeding tracked product stock is rejected without changing inventory", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const product = prisma.seedMenuItem(restaurant.id, { stockQuantity: 1 });

  await assert.rejects(
    service.createOrder(randomUUID(), baseInput(restaurant.id, product.id) as never),
    hasCode("ORDER_ITEM_OUT_OF_STOCK")
  );
  assert.equal(prisma.menuItems.find((item) => item.id === product.id)!.stockQuantity, 1);
  assert.equal(prisma.orders.length, 0);
});

test("cancelling a placed order restores its tracked product stock", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const product = prisma.seedMenuItem(restaurant.id, { stockQuantity: 4 });
  const customerId = randomUUID();
  const order = await service.createOrder(customerId, baseInput(restaurant.id, product.id) as never);
  assert.equal(prisma.menuItems.find((item) => item.id === product.id)!.stockQuantity, 2);

  await service.cancelForCustomer(customerId, order.id);
  assert.equal(prisma.menuItems.find((item) => item.id === product.id)!.stockQuantity, 4);
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

test("supermarket replacement waits for customer approval, updates totals, and releases the original stock", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant({ businessType: BusinessType.SUPERMARKET });
  const original = prisma.seedMenuItem(restaurant.id, { name: "Original milk", priceMinor: 500, stockQuantity: 10 });
  const replacement = prisma.seedMenuItem(restaurant.id, { name: "Replacement milk", priceMinor: 700, stockQuantity: 10 });
  const customerId = randomUUID();
  const order = await service.createOrder(customerId, baseInput(restaurant.id, original.id, {
    items: [{ menuItemId: original.id, quantity: 2, allowSubstitution: true }]
  }) as never);

  const proposed = await service.proposeFulfillmentAdjustment(
    restaurant.ownerUserId,
    order.id,
    order.items[0].id,
    { replacementMenuItemId: replacement.id, note: "Closest available size" } as never
  );
  assert.equal(proposed.requiresCustomerReview, true);
  assert.equal(proposed.items[0].fulfillmentAdjustment?.status, "PENDING");
  assert.equal(original.stockQuantity, 8);
  assert.equal(replacement.stockQuantity, 8);
  await assert.rejects(
    service.updateStatusForRestaurantOwner(restaurant.ownerUserId, order.id, "ACCEPTED", undefined),
    hasCode("FULFILLMENT_REVIEW_PENDING")
  );

  const approved = await service.decideFulfillmentAdjustment(
    customerId,
    order.id,
    proposed.items[0].fulfillmentAdjustment!.id,
    "APPROVED"
  );
  assert.equal(approved.requiresCustomerReview, false);
  assert.equal(approved.items[0].nameSnapshot, "Original milk");
  assert.equal(approved.items[0].fulfillmentAdjustment?.replacementNameSnapshot, "Replacement milk");
  assert.equal(approved.items[0].lineTotalMinor, 1_400);
  assert.equal(approved.subtotalMinor, 1_400);
  assert.equal(original.stockQuantity, 10);
  assert.equal(replacement.stockQuantity, 8);

  const accepted = await service.updateStatusForRestaurantOwner(restaurant.ownerUserId, order.id, "ACCEPTED", undefined);
  assert.equal(accepted.status, "ACCEPTED");
});

test("a customer can reject a replacement and its reserved stock is restored", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant({ businessType: BusinessType.SUPERMARKET });
  const original = prisma.seedMenuItem(restaurant.id, { stockQuantity: 10 });
  const replacement = prisma.seedMenuItem(restaurant.id, { name: "Alternative", stockQuantity: 6 });
  const customerId = randomUUID();
  const order = await service.createOrder(customerId, baseInput(restaurant.id, original.id, {
    items: [{ menuItemId: original.id, quantity: 2, allowSubstitution: true }]
  }) as never);
  const proposed = await service.proposeFulfillmentAdjustment(
    restaurant.ownerUserId,
    order.id,
    order.items[0].id,
    { replacementMenuItemId: replacement.id } as never
  );

  const rejected = await service.decideFulfillmentAdjustment(
    customerId,
    order.id,
    proposed.items[0].fulfillmentAdjustment!.id,
    "REJECTED"
  );
  assert.equal(rejected.items[0].fulfillmentAdjustment?.status, "REJECTED");
  assert.equal(original.stockQuantity, 8);
  assert.equal(replacement.stockQuantity, 6);
});

test("supermarket cannot substitute a line when the customer declined replacements", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant({ businessType: BusinessType.SUPERMARKET });
  const original = prisma.seedMenuItem(restaurant.id);
  const replacement = prisma.seedMenuItem(restaurant.id, { name: "Alternative" });
  const order = await service.createOrder(randomUUID(), baseInput(restaurant.id, original.id) as never);

  await assert.rejects(
    service.proposeFulfillmentAdjustment(
      restaurant.ownerUserId,
      order.id,
      order.items[0].id,
      { replacementMenuItemId: replacement.id } as never
    ),
    hasCode("SUBSTITUTION_NOT_ALLOWED")
  );
});

test("customer approval applies a variable packed quantity to the cash total", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant({ businessType: BusinessType.SUPERMARKET });
  const produce = prisma.seedMenuItem(restaurant.id, {
    name: "Tomatoes",
    priceMinor: 1_000,
    stockQuantity: 10,
    isVariableWeight: true,
    unitLabel: "kg"
  });
  const customerId = randomUUID();
  const order = await service.createOrder(customerId, baseInput(restaurant.id, produce.id) as never);
  const proposed = await service.proposeFulfillmentAdjustment(
    restaurant.ownerUserId,
    order.id,
    order.items[0].id,
    { actualQuantityMilli: 2_500 } as never
  );
  assert.equal(produce.stockQuantity, 7);
  const approved = await service.decideFulfillmentAdjustment(
    customerId,
    order.id,
    proposed.items[0].fulfillmentAdjustment!.id,
    "APPROVED"
  );

  assert.equal(approved.items[0].lineTotalMinor, 2_500);
  assert.equal(approved.subtotalMinor, 2_500);
  assert.equal(approved.totalMinor, order.totalMinor + 500);
  await service.cancelForCustomer(customerId, order.id);
  assert.equal(produce.stockQuantity, 10);
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

test("the live queue groups orders the way the floor thinks about them, oldest first", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id);
  const first = await service.createOrder(randomUUID(), baseInput(restaurant.id, menuItem.id) as never);
  const second = await service.createOrder(randomUUID(), baseInput(restaurant.id, menuItem.id) as never);
  const third = await service.createOrder(randomUUID(), baseInput(restaurant.id, menuItem.id) as never);

  await service.updateStatusForRestaurantOwner(restaurant.ownerUserId, second.id, "ACCEPTED", undefined);
  await service.updateStatusForRestaurantOwner(restaurant.ownerUserId, third.id, "ACCEPTED", undefined);
  await service.updateStatusForRestaurantOwner(restaurant.ownerUserId, third.id, "PREPARING", undefined);
  await service.updateStatusForRestaurantOwner(restaurant.ownerUserId, third.id, "READY_FOR_PICKUP", undefined);

  const queue = await service.listLiveForBusiness(restaurant.ownerUserId);

  assert.deepEqual(queue.new.map((order) => order.id), [first.id]);
  // ACCEPTED and PREPARING are one operational group.
  assert.deepEqual(queue.inProgress.map((order) => order.id), [second.id]);
  assert.deepEqual(queue.ready.map((order) => order.id), [third.id]);
  assert.equal(queue.business.businessType, "RESTAURANT");
  // The elapsed-time badges are measured against the server's clock, not the tablet's.
  assert.ok(queue.serverTime instanceof Date);
});

test("the live queue never shows another business's orders", async () => {
  const { prisma, service } = createService();
  const mine = prisma.seedRestaurant();
  const theirs = prisma.seedRestaurant({ name: "Other" });
  const theirItem = prisma.seedMenuItem(theirs.id);
  await service.createOrder(randomUUID(), baseInput(theirs.id, theirItem.id) as never);

  const queue = await service.listLiveForBusiness(mine.ownerUserId);

  assert.deepEqual([queue.new.length, queue.inProgress.length, queue.ready.length], [0, 0, 0]);
});

test("a terminal order drops out of the live queue entirely", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id);
  const order = await service.createOrder(randomUUID(), baseInput(restaurant.id, menuItem.id) as never);
  await service.updateStatusForRestaurantOwner(restaurant.ownerUserId, order.id, "REJECTED", "No stock");

  const queue = await service.listLiveForBusiness(restaurant.ownerUserId);

  // This is what stops the alert: the order leaves PLACED, so nothing is left to sound about.
  assert.deepEqual([queue.new.length, queue.inProgress.length, queue.ready.length], [0, 0, 0]);
});

test("an admin cancellation closes the courier task so no driver can complete it", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id);
  const order = await service.createOrder(randomUUID(), baseInput(restaurant.id, menuItem.id) as never);
  await service.updateStatusForRestaurantOwner(restaurant.ownerUserId, order.id, "ACCEPTED", undefined);
  await service.updateStatusForRestaurantOwner(restaurant.ownerUserId, order.id, "PREPARING", undefined);
  await service.updateStatusForRestaurantOwner(restaurant.ownerUserId, order.id, "READY_FOR_PICKUP", undefined);
  assert.equal(prisma.deliveries.length, 1);

  await service.adminCancelOrder(randomUUID(), order.id, "Customer changed their mind");

  // Leaving the delivery open let a driver walk a cancelled order through to DELIVERED.
  assert.equal(prisma.deliveries[0].status, "CANCELLED");
  assert.ok(prisma.deliveries[0].cancelledAt);
});

test("the discount split is persisted so the commission base excludes delivery discounts", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id, { priceMinor: 2500 });
  prisma.seedOffer({ type: "FREE_DELIVERY", restaurantId: null });

  const order = await service.createOrder(randomUUID(), baseInput(restaurant.id, menuItem.id) as never);
  const stored = prisma.orders[0];

  assert.equal(stored.deliveryDiscountMinor, stored.deliveryFeeMinor);
  assert.equal(stored.merchandiseDiscountMinor, 0);
  // The split must always reconcile to the stored total; a DB CHECK enforces the same thing.
  assert.equal(stored.merchandiseDiscountMinor + stored.deliveryDiscountMinor, stored.discountMinor);
  assert.equal(order.deliveryDiscountMinor, stored.deliveryFeeMinor);
});

test("an applied promotion records whether the business or the platform funded it", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id, { priceMinor: 2500 });
  prisma.seedOffer({ type: "ORDER_PERCENTAGE", discountPercent: 10, restaurantId: restaurant.id });

  const order = await service.createOrder(randomUUID(), baseInput(restaurant.id, menuItem.id) as never);

  const promotion = order.appliedPromotions[0];
  assert.ok(promotion);
  // Absorption is keyed to scope, so the snapshot has to carry it rather than re-reading the offer.
  assert.equal(promotion.scope, "BUSINESS");
  assert.equal(promotion.businessId, restaurant.id);
});

test("a platform-wide promotion is recorded as platform-funded", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id, { priceMinor: 2500 });
  prisma.seedOffer({ type: "ORDER_PERCENTAGE", discountPercent: 10, restaurantId: null });

  const order = await service.createOrder(randomUUID(), baseInput(restaurant.id, menuItem.id) as never);

  assert.equal(order.appliedPromotions[0]?.scope, "PLATFORM");
  assert.equal(order.appliedPromotions[0]?.businessId, null);
});

test("no order total includes a service fee", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id, { priceMinor: 2000 });

  const order = await service.createOrder(randomUUID(), baseInput(restaurant.id, menuItem.id) as never);

  assert.equal(order.totalMinor, order.subtotalMinor + order.deliveryFeeMinor - order.discountMinor);
  assert.equal("serviceFeeMinor" in order, false);
});

test("a staff member who is not the owner can work their business's orders", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id);
  const order = await service.createOrder(randomUUID(), baseInput(restaurant.id, menuItem.id) as never);
  const staff = prisma.seedBusinessMember(restaurant.id);

  // Before membership resolution this returned RESTAURANT_NOT_FOUND, because access was looked up
  // by Restaurant.ownerUserId and a staff account is never the owner.
  const listed = await service.listForRestaurantOwner(staff.userId, 1, 20);
  assert.equal(listed.total, 1);

  const accepted = await service.updateStatusForRestaurantOwner(staff.userId, order.id, "ACCEPTED", undefined);
  assert.equal(accepted.status, "ACCEPTED");
  // Attribution records the person who actually acted, not the owner of record.
  assert.equal(accepted.acceptedByUserId, staff.userId);
});

test("a staff member of one business still cannot reach another business's order", async () => {
  const { prisma, service } = createService();
  const restaurantA = prisma.seedRestaurant();
  const restaurantB = prisma.seedRestaurant({ name: "Other" });
  const itemB = prisma.seedMenuItem(restaurantB.id);
  const orderB = await service.createOrder(randomUUID(), baseInput(restaurantB.id, itemB.id) as never);
  const staffA = prisma.seedBusinessMember(restaurantA.id);

  await assert.rejects(
    service.getForRestaurantOwner(staffA.userId, orderB.id),
    hasCode("ORDER_NOT_FOUND")
  );
  await assert.rejects(
    service.updateStatusForRestaurantOwner(staffA.userId, orderB.id, "ACCEPTED", undefined),
    hasCode("ORDER_NOT_FOUND")
  );
});

test("a user with no membership cannot reach any business's orders", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id);
  await service.createOrder(randomUUID(), baseInput(restaurant.id, menuItem.id) as never);

  await assert.rejects(
    service.listForRestaurantOwner(randomUUID(), 1, 20),
    hasCode("RESTAURANT_NOT_FOUND")
  );
});

test("a user belonging to two businesses must say which one, rather than getting an arbitrary pick", async () => {
  const { prisma, service } = createService();
  const restaurantA = prisma.seedRestaurant();
  const restaurantB = prisma.seedRestaurant({ name: "Other" });
  const shared = prisma.seedBusinessMember(restaurantA.id);
  prisma.seedBusinessMember(restaurantB.id, shared.userId);

  // Silently choosing one business would be exactly the ambiguity that leaks data between tenants.
  await assert.rejects(
    service.listForRestaurantOwner(shared.userId, 1, 20),
    hasCode("BUSINESS_CONTEXT_REQUIRED")
  );
});

test("a new order notifies every active member of the business, not only the owner", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id);
  const staff = prisma.seedBusinessMember(restaurant.id);

  await service.createOrder(randomUUID(), baseInput(restaurant.id, menuItem.id) as never);

  const notified = prisma.notifications
    .filter((entry) => entry.type === "ORDER_PLACED")
    .map((entry) => entry.userId)
    .sort();
  assert.deepEqual(notified, [restaurant.ownerUserId, staff.userId].sort());
});

test("accepting an order records who accepted it and when, in the same atomic write", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id);
  const order = await service.createOrder(randomUUID(), baseInput(restaurant.id, menuItem.id) as never);

  assert.equal(order.acceptedByUserId, null);
  assert.equal(order.acceptedAt, null);

  const accepted = await service.updateStatusForRestaurantOwner(
    restaurant.ownerUserId,
    order.id,
    "ACCEPTED",
    undefined
  );

  assert.equal(accepted.acceptedByUserId, restaurant.ownerUserId);
  assert.ok(accepted.acceptedAt instanceof Date);
  // The stored row carries the attribution, not just the returned view.
  assert.equal(prisma.orders[0].acceptedByUserId, restaurant.ownerUserId);
});

test("rejecting an order leaves the acceptance attribution empty", async () => {
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

  assert.equal(rejected.acceptedByUserId, null);
  assert.equal(rejected.acceptedAt, null);
});

test("advancing an accepted order preserves the original acceptance attribution", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id);
  const order = await service.createOrder(randomUUID(), baseInput(restaurant.id, menuItem.id) as never);
  const accepted = await service.updateStatusForRestaurantOwner(
    restaurant.ownerUserId,
    order.id,
    "ACCEPTED",
    undefined
  );

  const preparing = await service.updateStatusForRestaurantOwner(
    restaurant.ownerUserId,
    order.id,
    "PREPARING",
    undefined
  );

  assert.equal(preparing.acceptedByUserId, restaurant.ownerUserId);
  assert.deepEqual(preparing.acceptedAt, accepted.acceptedAt);
});

test("a second acceptance of the same order loses the race and cannot overwrite the first", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id);
  const order = await service.createOrder(randomUUID(), baseInput(restaurant.id, menuItem.id) as never);
  const accepted = await service.updateStatusForRestaurantOwner(
    restaurant.ownerUserId,
    order.id,
    "ACCEPTED",
    undefined
  );

  await assert.rejects(
    service.updateStatusForRestaurantOwner(restaurant.ownerUserId, order.id, "ACCEPTED", undefined),
    hasCode("ORDER_INVALID_TRANSITION")
  );
  assert.deepEqual(prisma.orders[0].acceptedAt, accepted.acceptedAt);
});

test("customer-facing order views never expose the name of the staff member who accepted", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const menuItem = prisma.seedMenuItem(restaurant.id);
  const customerId = randomUUID();
  const order = await service.createOrder(customerId, baseInput(restaurant.id, menuItem.id) as never);
  await service.updateStatusForRestaurantOwner(restaurant.ownerUserId, order.id, "ACCEPTED", undefined);

  const customerView = await service.getForCustomer(customerId, order.id);
  assert.equal("acceptedByFullName" in customerView, false);
  // The timestamp is fine to share with the customer; the staff member's name is not.
  assert.ok(customerView.acceptedAt instanceof Date);

  const businessView = await service.getForRestaurantOwner(restaurant.ownerUserId, order.id);
  assert.equal("acceptedByFullName" in businessView, true);
});

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof ApiException && (error.getResponse() as { code?: string }).code === code;
}

/** Wraps a minute-of-day (which may be negative or over 1440) into an "HH:mm" string. */
function hhmm(totalMinutes: number): string {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ApiException } from "../common/api.exception";
import { BusinessType } from "../generated/prisma/client";
import { FakeRealtimeGateway } from "../realtime/testing/fake-realtime-gateway";
import { FakeOrdersPrisma } from "./testing/fake-prisma";
import { OrdersService } from "./orders.service";

/**
 * Audit finding C-1 — the customer-facing "restaurants are coming soon" launch gate is enforced
 * in the mobile UI only. The ordering service (`OrdersService.createOrder` / `quoteOrder` via
 * `calculateOrderQuote`) checks a business is APPROVED, open, and has a location, but it never
 * checks `businessType`. A caller with a valid customer token can therefore place a real order at
 * a `businessType: RESTAURANT` business through `POST /api/v1/orders`, bypassing the launch gate.
 *
 * These tests were added by the audit to DOCUMENT the current behaviour without changing any
 * application code. The `characterises …` tests pass today and prove the gap is real; the
 * `todo` tests describe the behaviour a fix should introduce and are ready-made regression tests
 * that will start asserting real protection the moment `businessType` gating is added.
 */

function createService() {
  const prisma = new FakeOrdersPrisma();
  const realtime = new FakeRealtimeGateway();
  const service = new OrdersService(prisma as never, realtime as never);
  return { prisma, service };
}

function customerOrderInput(restaurantId: string, menuItemId: string) {
  return {
    restaurantId,
    items: [{ menuItemId, quantity: 1 }],
    deliveryLabel: "Home",
    deliveryAddressLine: "Al-Manara Square, Ramallah",
    deliveryLatitude: 31.9038,
    deliveryLongitude: 35.2034,
    paymentMethod: "CASH" as const
  };
}

function hasCode(code: string) {
  return (error: unknown) =>
    error instanceof ApiException && (error.getResponse() as { code?: string }).code === code;
}

test("characterises C-1: a customer can place an order at a RESTAURANT-type business (launch gate is UI-only)", async () => {
  const { prisma, service } = createService();
  // The DEFAULT seeded business is already businessType: RESTAURANT, approved and open — which is
  // exactly the situation the "coming soon" card is meant to hide from customers.
  const restaurant = prisma.seedRestaurant({ businessType: BusinessType.RESTAURANT });
  const menuItem = prisma.seedMenuItem(restaurant.id, { priceMinor: 2500 });

  const order = await service.createOrder(randomUUID(), customerOrderInput(restaurant.id, menuItem.id) as never);

  // The order goes through with no business-type objection — this IS the vulnerability.
  assert.equal(order.status, "PLACED");
  assert.equal(order.restaurant.id, restaurant.id);
  assert.equal(prisma.orders.length, 1);
});

test("characterises C-1: /orders/quote also prices a RESTAURANT-type business without objection", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant({ businessType: BusinessType.RESTAURANT });
  const menuItem = prisma.seedMenuItem(restaurant.id, { priceMinor: 2500 });

  const quote = await service.quoteOrder(customerOrderInput(restaurant.id, menuItem.id) as never);

  assert.equal(quote.subtotalMinor, 2500);
});

test(
  "C-1 fix (todo): placing an order at a RESTAURANT-type business should be rejected while restaurant ordering is disabled",
  { todo: "no businessType gate exists yet in calculateOrderQuote — see audit report C-1" },
  async () => {
    const { prisma, service } = createService();
    const restaurant = prisma.seedRestaurant({ businessType: BusinessType.RESTAURANT });
    const menuItem = prisma.seedMenuItem(restaurant.id);

    // Desired behaviour once the launch gate is enforced server-side (e.g. a
    // RESTAURANT_ORDERING_DISABLED / 409 guard behind a RESTAURANT_ORDERING_ENABLED flag).
    await assert.rejects(
      service.createOrder(randomUUID(), customerOrderInput(restaurant.id, menuItem.id) as never),
      hasCode("RESTAURANT_ORDERING_DISABLED")
    );
    assert.equal(prisma.orders.length, 0);
  }
);

test("control: a SUPERMARKET-type business remains orderable (the vertical that is actually live)", async () => {
  const { prisma, service } = createService();
  const supermarket = prisma.seedRestaurant({ businessType: BusinessType.SUPERMARKET });
  const product = prisma.seedMenuItem(supermarket.id, { priceMinor: 2500 });

  const order = await service.createOrder(randomUUID(), customerOrderInput(supermarket.id, product.id) as never);

  assert.equal(order.status, "PLACED");
});

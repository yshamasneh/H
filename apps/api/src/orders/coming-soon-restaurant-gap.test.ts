import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { ApiException } from "../common/api.exception";
import { BusinessType } from "../generated/prisma/client";
import { FakeRealtimeGateway } from "../realtime/testing/fake-realtime-gateway";
import { FakeOrdersPrisma } from "./testing/fake-prisma";
import { OrdersService } from "./orders.service";

/**
 * Audit finding C-1 — the customer-facing "restaurants are coming soon" launch gate used to be
 * enforced in the mobile UI only. `OrdersService.createOrder` / `quoteOrder` (via
 * `calculateOrderQuote`) checked a business was APPROVED, open, and had a location, but never
 * checked `businessType`, so a caller with a valid customer token could place a real order at a
 * `businessType: RESTAURANT` business through `POST /api/v1/orders`, bypassing the launch gate.
 *
 * Fixed by gating `calculateOrderQuote` on `RESTAURANT_ORDERING_ENABLED` (default false — see
 * config/environment.ts). These tests now assert the closed gap instead of documenting it; the
 * public browsing/menu side of the same fix lives in
 * restaurants/restaurants.public-gate.test.ts.
 */

function createService(restaurantOrderingEnabled: boolean) {
  const prisma = new FakeOrdersPrisma();
  const realtime = new FakeRealtimeGateway();
  const config = new ConfigService({ RESTAURANT_ORDERING_ENABLED: restaurantOrderingEnabled });
  const service = new OrdersService(prisma as never, realtime as never, config);
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

test("fixed C-1: while the flag is off (the real default), placing an order at a RESTAURANT-type business is rejected", async () => {
  const { prisma, service } = createService(false);
  // The DEFAULT seeded business is businessType: RESTAURANT, approved and open — exactly the
  // situation the "coming soon" card is meant to hide from customers.
  const restaurant = prisma.seedRestaurant({ businessType: BusinessType.RESTAURANT });
  const menuItem = prisma.seedMenuItem(restaurant.id, { priceMinor: 2500 });

  await assert.rejects(
    service.createOrder(randomUUID(), customerOrderInput(restaurant.id, menuItem.id) as never),
    hasCode("RESTAURANT_ORDERING_DISABLED")
  );
  assert.equal(prisma.orders.length, 0);
});

test("fixed C-1: while the flag is off, /orders/quote also rejects a RESTAURANT-type business", async () => {
  const { prisma, service } = createService(false);
  const restaurant = prisma.seedRestaurant({ businessType: BusinessType.RESTAURANT });
  const menuItem = prisma.seedMenuItem(restaurant.id, { priceMinor: 2500 });

  await assert.rejects(
    service.quoteOrder(customerOrderInput(restaurant.id, menuItem.id) as never),
    hasCode("RESTAURANT_ORDERING_DISABLED")
  );
});

test("flipping RESTAURANT_ORDERING_ENABLED on restores restaurant ordering, with no rebuild", async () => {
  const { prisma, service } = createService(true);
  const restaurant = prisma.seedRestaurant({ businessType: BusinessType.RESTAURANT });
  const menuItem = prisma.seedMenuItem(restaurant.id, { priceMinor: 2500 });

  const order = await service.createOrder(randomUUID(), customerOrderInput(restaurant.id, menuItem.id) as never);
  assert.equal(order.status, "PLACED");
  assert.equal(order.restaurant.id, restaurant.id);
});

test("control: a SUPERMARKET-type business remains orderable while the flag is off (the vertical that is actually live)", async () => {
  const { prisma, service } = createService(false);
  const supermarket = prisma.seedRestaurant({ businessType: BusinessType.SUPERMARKET });
  const product = prisma.seedMenuItem(supermarket.id, { priceMinor: 2500 });

  const order = await service.createOrder(randomUUID(), customerOrderInput(supermarket.id, product.id) as never);

  assert.equal(order.status, "PLACED");
});

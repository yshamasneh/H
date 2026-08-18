import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { ApiException } from "../common/api.exception";
import { BusinessType } from "../generated/prisma/client";
import { FakeRealtimeGateway } from "../realtime/testing/fake-realtime-gateway";
import { RestaurantsService } from "./restaurants.service";
import { FakeRestaurantPrisma } from "./testing/fake-prisma";

/**
 * Audit findings C-1/C-2 — the customer-facing "restaurants are coming soon" launch gate used to
 * be enforced in the mobile UI only; the public restaurant browsing/menu endpoints were fully live
 * and unauthenticated. These tests cover the RESTAURANT_ORDERING_ENABLED gate added to close that
 * gap in RestaurantsService's public methods. The order-creation side of the same gate is covered
 * in orders/coming-soon-restaurant-gap.test.ts.
 */

function createService(restaurantOrderingEnabled: boolean) {
  const prisma = new FakeRestaurantPrisma();
  const realtime = new FakeRealtimeGateway();
  const config = new ConfigService({ RESTAURANT_ORDERING_ENABLED: restaurantOrderingEnabled });
  const service = new RestaurantsService(prisma as never, realtime as never, config);
  return { prisma, service };
}

function hasCode(code: string) {
  return (error: unknown) => error instanceof ApiException && (error.getResponse() as { code?: string }).code === code;
}

test("while the flag is off (the real default), public restaurant listing returns an empty page, not an error", async () => {
  const { prisma, service } = createService(false);
  prisma.seedApprovedOpenRestaurant({ businessType: BusinessType.RESTAURANT });

  const page = await service.listPublicRestaurants(1, 20);
  assert.deepEqual(page, { items: [], page: 1, pageSize: 20, total: 0 });
});

test("while the flag is off, a single restaurant's public profile and menu are rejected with a clear, distinct code", async () => {
  const { prisma, service } = createService(false);
  const restaurant = prisma.seedApprovedOpenRestaurant({ businessType: BusinessType.RESTAURANT });

  await assert.rejects(service.getPublicRestaurant(restaurant.id), hasCode("RESTAURANT_ORDERING_DISABLED"));
  await assert.rejects(service.getPublicMenu(restaurant.id), hasCode("RESTAURANT_ORDERING_DISABLED"));
});

test("while the flag is off, supermarket browsing is completely unaffected", async () => {
  const { prisma, service } = createService(false);
  const supermarket = prisma.seedApprovedOpenRestaurant({ businessType: BusinessType.SUPERMARKET, name: "JOVO MARKET" });

  const supermarkets = await service.listPublicSupermarkets(1, 20);
  assert.deepEqual(supermarkets.items.map((item) => item.id), [supermarket.id]);
});

test("flipping the flag on restores restaurant browsing and menu access, with no rebuild", async () => {
  const { prisma, service } = createService(true);
  const restaurant = prisma.seedApprovedOpenRestaurant({ businessType: BusinessType.RESTAURANT });

  const page = await service.listPublicRestaurants(1, 20);
  assert.deepEqual(page.items.map((item) => item.id), [restaurant.id]);

  const profile = await service.getPublicRestaurant(restaurant.id);
  assert.equal(profile.id, restaurant.id);

  const menu = await service.getPublicMenu(restaurant.id);
  assert.equal(menu.restaurant.id, restaurant.id);
});

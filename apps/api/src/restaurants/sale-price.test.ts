import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiException } from "../common/api.exception";
import { FakeRealtimeGateway } from "../realtime/testing/fake-realtime-gateway";
import { ConfigService } from "@nestjs/config";
import { MenuService } from "./menu.service";
import { assertValidSalePrice, chargedUnitPriceMinor, isOnSale, salePercentOff } from "./sale-price";
import { RestaurantsService } from "./restaurants.service";
import { FakeRestaurantPrisma } from "./testing/fake-prisma";

const code = (expected: string) => (error: unknown) =>
  error instanceof ApiException && (error.getResponse() as { code: string }).code === expected;

test("the percentage is calculated from the two prices and is never 0 or 100 for a real sale", () => {
  assert.equal(salePercentOff(2000, 1000), 50, "20.00 reduced to 10.00 saves 50%");
  assert.equal(salePercentOff(1500, 1200), 20);
  assert.equal(salePercentOff(1999, 1499), 25, "25.01% rounds to 25");
  assert.equal(salePercentOff(10_000, 9_999), 1, "a real reduction is never shown as 0%");
  assert.equal(salePercentOff(1000, 1), 99, "and a near-free price is never shown as 100%");
  assert.equal(salePercentOff(1000, 1000), 0, "no reduction, no percentage");
  assert.equal(salePercentOff(1000, 1200), 0, "a price rise is not a sale");
});

test("the charged price is the sale price when there is one", () => {
  assert.equal(chargedUnitPriceMinor({ priceMinor: 2000, salePriceMinor: 1000 }), 1000);
  assert.equal(chargedUnitPriceMinor({ priceMinor: 2000, salePriceMinor: null }), 2000);
  assert.equal(chargedUnitPriceMinor({ priceMinor: 2000 }), 2000);
  assert.equal(isOnSale({ priceMinor: 2000, salePriceMinor: 1000 }), true);
  assert.equal(isOnSale({ priceMinor: 2000, salePriceMinor: null }), false);
});

test("a sale price must be a reduction", () => {
  assert.doesNotThrow(() => assertValidSalePrice(2000, 1999));
  assert.doesNotThrow(() => assertValidSalePrice(2000, null));
  assert.doesNotThrow(() => assertValidSalePrice(2000, undefined));
  assert.throws(() => assertValidSalePrice(2000, 2000), code("SALE_PRICE_NOT_BELOW_PRICE"));
  assert.throws(() => assertValidSalePrice(2000, 2500), code("SALE_PRICE_NOT_BELOW_PRICE"));
  assert.throws(() => assertValidSalePrice(2000, 0), code("SALE_PRICE_INVALID"));
});

function createMenu() {
  const prisma = new FakeRestaurantPrisma();
  const menu = new MenuService(prisma as never);
  const restaurants = new RestaurantsService(
    prisma as never,
    new FakeRealtimeGateway() as never,
    new ConfigService({ RESTAURANT_ORDERING_ENABLED: true })
  );
  return { prisma, menu, restaurants };
}

let categoryCounter = 0;
async function seedItem(menu: MenuService, extra: Record<string, unknown> = {}) {
  // A fresh category each time: names are unique within a store.
  const category = await menu.createCategory("store-1", { name: `Snacks ${(categoryCounter += 1)}` });
  return menu.createItem("store-1", { categoryId: category.id, name: "Chips", priceMinor: 2000, ...extra } as never);
}

test("a product can be created on sale, and the sale shows on the owner's view", async () => {
  const { menu } = createMenu();
  const item = await seedItem(menu, { salePriceMinor: 1500 });
  assert.equal(item.priceMinor, 2000);
  assert.equal(item.salePriceMinor, 1500);
});

test("creating or editing a sale that is not below the regular price is refused with a clear code", async () => {
  const { menu } = createMenu();
  await assert.rejects(seedItem(menu, { salePriceMinor: 2000 }), code("SALE_PRICE_NOT_BELOW_PRICE"));

  const item = await seedItem(menu);
  await assert.rejects(
    menu.updateItem("store-1", item.id, { salePriceMinor: 2500 }, { canManagePrices: true }),
    code("SALE_PRICE_NOT_BELOW_PRICE")
  );
});

test("lowering the regular price to or below a running sale is refused, not silently accepted", async () => {
  const { menu } = createMenu();
  const item = await seedItem(menu, { salePriceMinor: 1500 });
  await assert.rejects(
    menu.updateItem("store-1", item.id, { priceMinor: 1500 }, { canManagePrices: true }),
    code("SALE_PRICE_NOT_BELOW_PRICE")
  );
  // Lowering it in the same request as the sale is fine when the pair is valid.
  const both = await menu.updateItem("store-1", item.id, { priceMinor: 1800, salePriceMinor: 1200 }, { canManagePrices: true });
  assert.deepEqual([both.priceMinor, both.salePriceMinor], [1800, 1200]);
});

test("a sale is ended by setting it to null, and raising the regular price leaves it running", async () => {
  const { menu } = createMenu();
  const item = await seedItem(menu, { salePriceMinor: 1500 });
  const raised = await menu.updateItem("store-1", item.id, { priceMinor: 2400 }, { canManagePrices: true });
  assert.equal(raised.salePriceMinor, 1500);
  const ended = await menu.updateItem("store-1", item.id, { salePriceMinor: null }, { canManagePrices: true });
  assert.equal(ended.salePriceMinor, null);
});

test("starting, changing or ending a sale needs the price permission", async () => {
  const { menu } = createMenu();
  const item = await seedItem(menu, { salePriceMinor: 1500 });
  for (const salePriceMinor of [1000, null]) {
    await assert.rejects(
      menu.updateItem("store-1", item.id, { salePriceMinor }, { canManagePrices: false }),
      code("FORBIDDEN_PERMISSION")
    );
  }
  // Re-sending the sale price it already has is not a change, so a full edit form may include it.
  await assert.doesNotReject(menu.updateItem("store-1", item.id, { name: "Crisps", salePriceMinor: 1500 }, { canManagePrices: false }));
});

test("customers see the sale price as the effective price, and a sale item carries no offer", async () => {
  const { prisma, menu, restaurants } = createMenu();
  const store = prisma.seedApprovedOpenRestaurant();
  const category = await menu.createCategory(store.id, { name: "Snacks" });
  const sale = await menu.createItem(store.id, { categoryId: category.id, name: "On sale", priceMinor: 2000, salePriceMinor: 1000 });
  const regular = await menu.createItem(store.id, { categoryId: category.id, name: "Regular", priceMinor: 2000 });
  for (const target of [sale, regular]) {
    prisma.offers.push({
      id: `offer-${target.id}`, type: "PRODUCT_PERCENTAGE", restaurantId: store.id, menuItemId: target.id,
      title: "10% off", discountPercent: 10, minimumSubtotalMinor: 0, maxDiscountMinor: null,
      startsAt: new Date(0), endsAt: null, isActive: true
    });
  }
  const view = await restaurants.getPublicMenu(store.id);
  const items = view.categories.flatMap((entry: { items: { id: string }[] }) => entry.items) as {
    id: string; priceMinor: number; salePriceMinor: number | null; effectivePriceMinor: number; offer: unknown;
  }[];
  const seenSale = items.find((entry) => entry.id === sale.id)!;
  const seenRegular = items.find((entry) => entry.id === regular.id)!;

  assert.equal(seenSale.priceMinor, 2000);
  assert.equal(seenSale.salePriceMinor, 1000);
  assert.equal(seenSale.effectivePriceMinor, 1000);
  assert.equal(seenSale.offer, null, "the sale is the promotion; no second markdown is advertised");
  assert.equal(seenRegular.salePriceMinor, null);
  assert.equal(seenRegular.effectivePriceMinor, 1800, "a regular product still gets its 10% offer");
});

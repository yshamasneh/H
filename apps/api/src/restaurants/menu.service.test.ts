import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiException } from "../common/api.exception";
import { RestaurantStatus } from "../generated/prisma/client";
import { FakeRealtimeGateway } from "../realtime/testing/fake-realtime-gateway";
import { MenuService } from "./menu.service";
import { RestaurantsService } from "./restaurants.service";
import { FakeRestaurantPrisma } from "./testing/fake-prisma";

function createServices() {
  const prisma = new FakeRestaurantPrisma();
  const menu = new MenuService(prisma as never);
  const restaurants = new RestaurantsService(prisma as never, new FakeRealtimeGateway() as never);
  return { prisma, menu, restaurants };
}

test("a restaurant owner can create and update their own category and item", async () => {
  const { menu } = createServices();
  const restaurantA = "restaurant-a";

  const category = await menu.createCategory(restaurantA, { name: "Sandwiches" });
  const item = await menu.createItem(restaurantA, {
    categoryId: category.id,
    name: "Falafel Sandwich",
    priceMinor: 1500
  });

  const updatedItem = await menu.updateItem(restaurantA, item.id, { priceMinor: 1800 });
  assert.equal(updatedItem.priceMinor, 1800);

  const updatedCategory = await menu.updateCategory(restaurantA, category.id, { name: "Wraps" });
  assert.equal(updatedCategory.name, "Wraps");
});

test("restaurant A cannot update restaurant B's menu category", async () => {
  const { menu } = createServices();
  const categoryB = await menu.createCategory("restaurant-b", { name: "Desserts" });

  await assert.rejects(
    menu.updateCategory("restaurant-a", categoryB.id, { name: "Hijacked" }),
    hasCode("MENU_CATEGORY_NOT_FOUND")
  );
});

test("restaurant A cannot update restaurant B's menu item", async () => {
  const { menu } = createServices();
  const categoryB = await menu.createCategory("restaurant-b", { name: "Desserts" });
  const itemB = await menu.createItem("restaurant-b", { categoryId: categoryB.id, name: "Baklava", priceMinor: 900 });

  await assert.rejects(
    menu.updateItem("restaurant-a", itemB.id, { priceMinor: 1 }),
    hasCode("MENU_ITEM_NOT_FOUND")
  );
  await assert.rejects(
    menu.setItemAvailability("restaurant-a", itemB.id, false),
    hasCode("MENU_ITEM_NOT_FOUND")
  );
});

test("restaurant A cannot attach a new item to restaurant B's category", async () => {
  const { menu } = createServices();
  const categoryB = await menu.createCategory("restaurant-b", { name: "Desserts" });

  await assert.rejects(
    menu.createItem("restaurant-a", { categoryId: categoryB.id, name: "Stolen Item", priceMinor: 100 }),
    hasCode("MENU_CATEGORY_NOT_FOUND")
  );
});

test("restaurant A cannot move its own item into restaurant B's category", async () => {
  const { menu } = createServices();
  const categoryA = await menu.createCategory("restaurant-a", { name: "Mains" });
  const itemA = await menu.createItem("restaurant-a", { categoryId: categoryA.id, name: "Shawarma", priceMinor: 2000 });
  const categoryB = await menu.createCategory("restaurant-b", { name: "Desserts" });

  await assert.rejects(
    menu.updateItem("restaurant-a", itemA.id, { categoryId: categoryB.id }),
    hasCode("MENU_CATEGORY_NOT_FOUND")
  );
});

test("public menu only includes active categories and available items", async () => {
  const { prisma, menu, restaurants } = createServices();
  const restaurant = prisma.seedApprovedOpenRestaurant();

  const visibleCategory = await menu.createCategory(restaurant.id, { name: "Mains" });
  const hiddenCategory = await menu.createCategory(restaurant.id, { name: "Retired" });
  await menu.updateCategory(restaurant.id, hiddenCategory.id, { isActive: false });

  const availableItem = await menu.createItem(restaurant.id, {
    categoryId: visibleCategory.id,
    name: "Shawarma",
    priceMinor: 2000
  });
  const soldOutItem = await menu.createItem(restaurant.id, {
    categoryId: visibleCategory.id,
    name: "Sold Out Item",
    priceMinor: 1200
  });
  await menu.setItemAvailability(restaurant.id, soldOutItem.id, false);
  await menu.createItem(restaurant.id, {
    categoryId: hiddenCategory.id,
    name: "In A Hidden Category",
    priceMinor: 500
  });

  const publicMenu = await restaurants.getPublicMenu(restaurant.id);
  assert.equal(publicMenu.categories.length, 1);
  assert.equal(publicMenu.categories[0].id, visibleCategory.id);
  assert.equal(publicMenu.categories[0].items.length, 1);
  assert.equal(publicMenu.categories[0].items[0].id, availableItem.id);
});

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof ApiException && (error.getResponse() as { code?: string }).code === code;
}

import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { ApiException } from "../common/api.exception";
import { PERMISSIONS_KEY } from "../common/decorators/require-permission.decorator";
import { ROLES_KEY } from "../common/decorators/roles.decorator";
import { BusinessType, RestaurantStatus, UserRole } from "../generated/prisma/client";
import { FakeRealtimeGateway } from "../realtime/testing/fake-realtime-gateway";
import { AdminRestaurantsController } from "./admin-restaurants.controller";
import { MenuService } from "./menu.service";
import { RestaurantsService } from "./restaurants.service";
import { FakeRestaurantPrisma } from "./testing/fake-prisma";

/**
 * P3 — an admin can perform full product CRUD on ANY store from the super-admin panel, not just a
 * store owner on their own. The write endpoints live on AdminRestaurantsController and delegate to
 * the same store-scoped MenuService the owner portal uses, but target a store by id. Access is the
 * class-level ADMIN role + MANAGE_BUSINESSES permission, enforced server-side by the guards
 * (covered in permissions.guard.test.ts); the metadata test below pins that guarding to the
 * controller so a non-admin can never reach these routes for a store they do not own.
 */

function createController() {
  const prisma = new FakeRestaurantPrisma();
  const menu = new MenuService(prisma as never);
  const config = new ConfigService({ RESTAURANT_ORDERING_ENABLED: true });
  const restaurants = new RestaurantsService(prisma as never, new FakeRealtimeGateway() as never, config);
  const controller = new AdminRestaurantsController(restaurants, menu);
  return { prisma, controller };
}

function hasCode(code: string) {
  return (error: unknown) => error instanceof ApiException && (error.getResponse() as { code?: string }).code === code;
}

test("an admin can create, edit, and delete a product for a store they do not own", async () => {
  const { prisma, controller } = createController();
  const store = prisma.seedApprovedOpenRestaurant({ businessType: BusinessType.RESTAURANT });

  const category = await controller.createCategory(store.id, { name: "Mains" });
  const item = await controller.createItem(store.id, {
    categoryId: category.id,
    name: "Mansaf",
    priceMinor: 4500
  } as never);
  assert.equal(item.name, "Mansaf");

  // The admin holds full price control, so a price edit is accepted (a store's own staff would need
  // MANAGE_PRICES for the same change).
  const updated = await controller.updateItem(store.id, item.id, { priceMinor: 5000 } as never);
  assert.equal(updated.priceMinor, 5000);

  const listed = await controller.listItems(store.id);
  assert.equal(listed.length, 1);

  const deleted = await controller.deleteItem(store.id, item.id);
  assert.match(deleted.message, /deleted/i);
  assert.equal((await controller.listItems(store.id)).length, 0);
});

test("an admin can set a supermarket product's cost price and toggle its availability", async () => {
  const { prisma, controller } = createController();
  const store = prisma.seedApprovedOpenRestaurant({ businessType: BusinessType.SUPERMARKET, name: "JOVO MARKET" });

  const category = await controller.createCategory(store.id, { name: "Dairy" });
  const item = await controller.createItem(store.id, {
    categoryId: category.id,
    name: "Milk 1L",
    priceMinor: 700,
    costPriceMinor: 500
  } as never);
  assert.equal(item.costPriceMinor, 500);

  const soldOut = await controller.setItemAvailability(store.id, item.id, { isAvailable: false } as never);
  assert.equal(soldOut.isAvailable, false);
});

test("admin product management on a non-existent store is a clean 404, not a foreign-key error", async () => {
  const { controller } = createController();
  await assert.rejects(
    controller.createCategory(randomUUID(), { name: "Ghost" }),
    hasCode("RESTAURANT_NOT_FOUND")
  );
});

test("a supermarket product still cannot be created without a cost price, even by an admin", async () => {
  const { prisma, controller } = createController();
  const store = prisma.seedApprovedOpenRestaurant({ businessType: BusinessType.SUPERMARKET });
  const category = await controller.createCategory(store.id, { name: "Produce" });

  await assert.rejects(
    controller.createItem(store.id, { categoryId: category.id, name: "Tomatoes", priceMinor: 300 } as never),
    hasCode("SUPERMARKET_COST_PRICE_REQUIRED")
  );
});

test("the admin product endpoints are locked behind the ADMIN role and MANAGE_BUSINESSES, so non-admins are refused server-side", () => {
  // Guarding is declared once at the class level and inherited by every route, including the new
  // product-CRUD ones. This is the negative test: without the ADMIN role a non-admin (e.g. a store
  // owner) is rejected by RolesGuard before any handler runs, and PermissionsGuard then requires the
  // platform MANAGE_BUSINESSES permission (see permissions.guard.test.ts for the guard behaviour).
  const roles = Reflect.getMetadata(ROLES_KEY, AdminRestaurantsController);
  const permissions = Reflect.getMetadata(PERMISSIONS_KEY, AdminRestaurantsController);
  assert.deepEqual(roles, [UserRole.ADMIN]);
  assert.deepEqual(permissions, ["MANAGE_BUSINESSES"]);
});

test("a store status does not block admin catalogue management (a pending store can still be stocked)", async () => {
  const { prisma, controller } = createController();
  const store = prisma.seedApprovedOpenRestaurant({ status: RestaurantStatus.PENDING, isOpen: false });

  const category = await controller.createCategory(store.id, { name: "Prep" });
  const item = await controller.createItem(store.id, {
    categoryId: category.id,
    name: "Pre-launch item",
    priceMinor: 1000
  } as never);
  assert.equal(item.name, "Pre-launch item");
});

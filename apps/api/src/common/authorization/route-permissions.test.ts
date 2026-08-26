import assert from "node:assert/strict";
import { test } from "node:test";
import { AdminAccountingController } from "../../accounting/admin-accounting.controller";
import { BusinessAccountingController } from "../../accounting/business-accounting.controller";
import { AdminAuditLogController } from "../../admin/admin-audit-log.controller";
import { AdminDashboardController } from "../../admin/admin-dashboard.controller";
import { AdminUsersController } from "../../admin/admin-users.controller";
import { AdminDriversController } from "../../drivers/admin-drivers.controller";
import { DriverPortalController } from "../../drivers/driver-portal.controller";
import { InventoryController } from "../../inventory/inventory.controller";
import { AdminOffersController } from "../../offers/admin-offers.controller";
import { AdminOrdersController } from "../../orders/admin-orders.controller";
import { OrdersController } from "../../orders/orders.controller";
import { RestaurantOrdersController } from "../../orders/restaurant-orders.controller";
import { AdminRestaurantsController } from "../../restaurants/admin-restaurants.controller";
import { RestaurantPortalController } from "../../restaurants/restaurant-portal.controller";
import { PERMISSIONS_KEY } from "../decorators/require-permission.decorator";
import { PermissionsGuard } from "../guards/permissions.guard";
import { allPermissions, type Permission } from "./permissions";

/**
 * These assertions lock the wiring between a route and the permission that protects it. A guard
 * that is correct in isolation still leaves a route open if the decorator is missing, and that is
 * the failure mode a unit test of the guard cannot catch.
 */

type Ctor = new (...args: never[]) => object;

function classPermissions(controller: Ctor): Permission[] | undefined {
  return Reflect.getMetadata(PERMISSIONS_KEY, controller) as Permission[] | undefined;
}

function methodPermissions(controller: Ctor, method: string): Permission[] | undefined {
  const handler = (controller.prototype as Record<string, unknown>)[method];
  return Reflect.getMetadata(PERMISSIONS_KEY, handler as object) as Permission[] | undefined;
}

function guards(controller: Ctor): unknown[] {
  return (Reflect.getMetadata("__guards__", controller) as unknown[] | undefined) ?? [];
}

function usesPermissionsGuard(controller: Ctor): boolean {
  return guards(controller).includes(PermissionsGuard);
}

test("every platform administration controller is protected by a permission", () => {
  const expected: [Ctor, Permission][] = [
    [AdminUsersController, "MANAGE_USERS"],
    [AdminAuditLogController, "VIEW_AUDIT_LOG"],
    [AdminDriversController, "MANAGE_DRIVERS"],
    [AdminOffersController, "MANAGE_OFFERS"],
    [AdminRestaurantsController, "MANAGE_BUSINESSES"],
    [AdminOrdersController, "VIEW_ALL_ORDERS"]
  ];

  for (const [controller, permission] of expected) {
    assert.ok(usesPermissionsGuard(controller), `${controller.name} must apply PermissionsGuard`);
    assert.deepEqual(
      classPermissions(controller),
      [permission],
      `${controller.name} must require ${permission}`
    );
  }
});

test("cancelling any order platform-wide requires a write permission, not just the read one", () => {
  assert.deepEqual(methodPermissions(AdminOrdersController, "cancel"), ["MANAGE_ALL_ORDERS"]);
});

test("business catalogue writes require the matching permission and reads stay open to staff", () => {
  assert.ok(usesPermissionsGuard(RestaurantPortalController));

  const expected: [string, Permission[]][] = [
    ["updateProfile", ["MANAGE_BUSINESS_SETTINGS"]],
    // Closing the store and marking an item sold out are shift-level operational acts: whoever
    // can accept orders must be able to stop the flow without waiting for the owner.
    ["setOpenStatus", ["MANAGE_ORDERS"]],
    ["setItemAvailability", ["MANAGE_ORDERS"]],
    ["createCategory", ["MANAGE_MENU"]],
    ["updateCategory", ["MANAGE_MENU"]],
    ["createItem", ["MANAGE_PRODUCTS", "MANAGE_PRICES"]],
    ["updateItem", ["MANAGE_PRODUCTS"]]
  ];
  for (const [method, permissions] of expected) {
    assert.deepEqual(methodPermissions(RestaurantPortalController, method), permissions, method);
  }

  // Reading the profile and menu must remain available to every member, or staff cannot work.
  for (const method of ["getProfile", "listCategories", "listItems"]) {
    assert.equal(methodPermissions(RestaurantPortalController, method), undefined, method);
  }
});

test("acting on a business order requires MANAGE_ORDERS while viewing requires only VIEW_ORDERS", () => {
  assert.ok(usesPermissionsGuard(RestaurantOrdersController));
  assert.deepEqual(classPermissions(RestaurantOrdersController), ["VIEW_ORDERS"]);
  assert.deepEqual(methodPermissions(RestaurantOrdersController, "updateStatus"), ["MANAGE_ORDERS"]);
  assert.deepEqual(methodPermissions(RestaurantOrdersController, "proposeFulfillment"), ["MANAGE_ORDERS"]);
});

test("reading the books and moving money are separate authorities", () => {
  // The accounting controller is the most financially sensitive surface on the platform: it can
  // accept a driver's cash, pay a partner, approve a cost, and change the rates every future
  // order is valued against. VIEW_ACCOUNTING gets someone through the door and nothing more —
  // every write names its own permission, and these assertions are what stop one going missing.
  assert.ok(usesPermissionsGuard(AdminAccountingController), "AdminAccountingController must apply PermissionsGuard");
  assert.deepEqual(classPermissions(AdminAccountingController), ["VIEW_ACCOUNTING"]);

  const expected: [string, Permission[]][] = [
    ["recordCashSettlement", ["RECEIVE_DRIVER_CASH"]],
    ["decideOperatingCost", ["APPROVE_OPERATING_COSTS"]],
    ["recordPartnerSettlement", ["MANAGE_SETTLEMENTS"]],
    ["recordAdjustment", ["MANAGE_SETTLEMENTS"]],
    ["generateSubscriptions", ["MANAGE_ACCOUNTING_SETTINGS"]],
    ["createRateSet", ["MANAGE_ACCOUNTING_SETTINGS"]]
  ];
  for (const [method, permissions] of expected) {
    assert.deepEqual(methodPermissions(AdminAccountingController, method), permissions, method);
  }

  // Reads inherit the class-level VIEW_ACCOUNTING and must not silently carry a write permission.
  for (const method of ["getOverview", "listBalances", "listDriverCash", "listRateSets"]) {
    assert.equal(methodPermissions(AdminAccountingController, method), undefined, method);
  }
});

test("a business may propose an operating cost but never decide one", () => {
  // The supermarket side reports and requests; the platform approves. A business-scoped route
  // holding APPROVE_OPERATING_COSTS would let a partner sign off its own rent.
  assert.ok(usesPermissionsGuard(BusinessAccountingController));
  assert.deepEqual(classPermissions(BusinessAccountingController), ["PROPOSE_OPERATING_COSTS"]);

  for (const method of ["list", "propose"]) {
    assert.equal(methodPermissions(BusinessAccountingController, method), undefined, method);
  }
});

test("stock, supplier, and purchasing routes require MANAGE_INVENTORY", () => {
  assert.ok(usesPermissionsGuard(InventoryController));
  assert.deepEqual(classPermissions(InventoryController), ["MANAGE_INVENTORY"]);
});

test("customer and driver routes carry no permission requirements", () => {
  for (const controller of [OrdersController, DriverPortalController]) {
    assert.equal(usesPermissionsGuard(controller), false, `${controller.name} needs no permissions`);
    assert.equal(classPermissions(controller), undefined, controller.name);
  }
});

test("the platform overview stays reachable by any administrator", () => {
  // Deliberately role-gated only: it is the admin landing page, not a privileged capability.
  assert.equal(classPermissions(AdminDashboardController), undefined);
});

test("every permission a route requires exists in the catalogue", () => {
  const controllers: Ctor[] = [
    AdminUsersController,
    AdminAuditLogController,
    AdminDriversController,
    AdminOffersController,
    AdminRestaurantsController,
    AdminOrdersController,
    AdminAccountingController,
    BusinessAccountingController,
    RestaurantPortalController,
    RestaurantOrdersController,
    InventoryController
  ];
  const known = new Set<string>(allPermissions);

  for (const controller of controllers) {
    const declared = [
      ...(classPermissions(controller) ?? []),
      ...Object.getOwnPropertyNames(controller.prototype).flatMap(
        (method) => methodPermissions(controller, method) ?? []
      )
    ];
    for (const permission of declared) {
      assert.ok(known.has(permission), `${controller.name} requires unknown permission ${permission}`);
    }
  }
});

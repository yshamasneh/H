import assert from "node:assert/strict";
import { test } from "node:test";
import type { Permission } from "./api";
import { adminCan } from "./store-permissions";

const holding = (...held: Permission[]) => (permission: Permission) => held.includes(permission);

test("an admin who manages businesses gets the store's whole workspace except changing orders", () => {
  const can = holding("MANAGE_BUSINESSES");
  for (const permission of ["VIEW_ORDERS", "MANAGE_PRODUCTS", "MANAGE_PRICES", "MANAGE_INVENTORY", "MANAGE_BUSINESS_SETTINGS", "MANAGE_BUSINESS_STAFF"] as const) {
    assert.equal(adminCan(permission, can), true, permission);
  }
  assert.equal(adminCan("MANAGE_ORDERS", can), false);
});

test("changing a store's orders also needs MANAGE_ALL_ORDERS, as the admin order routes require", () => {
  assert.equal(adminCan("MANAGE_ORDERS", holding("MANAGE_BUSINESSES", "MANAGE_ALL_ORDERS")), true);
  assert.equal(adminCan("MANAGE_ORDERS", holding("MANAGE_ALL_ORDERS")), false);
});

test("an admin without MANAGE_BUSINESSES is offered nothing in a store", () => {
  const can = holding("VIEW_ALL_ORDERS", "MANAGE_ALL_ORDERS", "VIEW_ACCOUNTING");
  for (const permission of ["VIEW_ORDERS", "MANAGE_ORDERS", "MANAGE_PRODUCTS", "MANAGE_INVENTORY"] as const) {
    assert.equal(adminCan(permission, can), false, permission);
  }
});

test("proposing an operating cost stays the store's own act, even for a super admin", () => {
  assert.equal(adminCan("PROPOSE_OPERATING_COSTS", () => true), false);
});

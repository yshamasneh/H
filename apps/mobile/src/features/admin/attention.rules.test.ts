import assert from "node:assert/strict";
import { test } from "node:test";
import { attentionItems } from "./attention.rules";

const everything = { isSuperAdmin: true, permissions: [] };
const dashboard = { pendingRestaurantApprovals: 1, pendingDriverApprovals: 2, ordersAwaitingAcceptance: 3 };
const books = { cashOutstandingMinor: 10_600, pendingOperatingCostCount: 1, ledgerImbalanceMinor: 0, costDataIncompleteCount: 0 };

test("everything waiting is listed with the screen that handles it", () => {
  assert.deepEqual(
    attentionItems(dashboard, books, everything).map((item) => [item.key, item.value, item.destination]),
    [
      ["ordersAwaiting", 3, "orders-placed"],
      ["pendingStores", 1, "stores-pending"],
      ["pendingDrivers", 2, "drivers-pending"],
      ["pendingCosts", 1, "costs"],
      ["driverCash", 10_600, "driver-cash"]
    ]
  );
});

test("problems come first and point to the web console's books", () => {
  const items = attentionItems(dashboard, { ...books, ledgerImbalanceMinor: 7 }, everything);
  assert.deepEqual([items[0].key, items[0].tone, items[0].destination], ["ledgerImbalance", "problem", "web-accounting"]);
});

test("zero counts vanish, and an account only sees what it could act on", () => {
  assert.deepEqual(attentionItems({ pendingRestaurantApprovals: 0 }, null, everything), []);
  const driversOnly = { isSuperAdmin: false, permissions: ["MANAGE_DRIVERS"] };
  assert.deepEqual(attentionItems(dashboard, books, driversOnly).map((item) => item.key), ["pendingDrivers"]);
  assert.deepEqual(attentionItems(dashboard, books, null), []);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Permission } from "./api";
import { attentionItems } from "./dashboard-attention";

const everything = () => true;
const inputs = {
  ordersAwaitingAcceptance: 3,
  pendingRestaurantApprovals: 1,
  pendingDriverApprovals: 2,
  accounting: { cashOutstandingMinor: 32_050, pendingOperatingCostCount: 1, ledgerImbalanceMinor: 0, costDataIncompleteCount: 0 }
};

test("everything waiting is listed with where to deal with it", () => {
  const items = attentionItems(inputs, everything);
  assert.deepEqual(
    items.map((item) => [item.key, item.value, item.to]),
    [
      ["ordersAwaiting", 3, "/orders?status=PLACED"],
      ["pendingStores", 1, "/restaurants?status=PENDING"],
      ["pendingDrivers", 2, "/drivers"],
      ["pendingCosts", 1, "/accounting?tab=costs"],
      ["driverCash", 32_050, "/accounting?tab=cash"]
    ]
  );
  assert.equal(items.find((item) => item.key === "driverCash")?.isMoney, true);
});

test("zero counts are not shown, so an empty list means all clear", () => {
  const items = attentionItems(
    {
      ordersAwaitingAcceptance: 0,
      pendingRestaurantApprovals: 0,
      pendingDriverApprovals: 0,
      accounting: { cashOutstandingMinor: 0, pendingOperatingCostCount: 0, ledgerImbalanceMinor: 0, costDataIncompleteCount: 0 }
    },
    everything
  );
  assert.deepEqual(items, []);
});

test("a ledger that does not balance comes first, as a problem, whichever way it is off", () => {
  const items = attentionItems({ ...inputs, accounting: { ...inputs.accounting, ledgerImbalanceMinor: -5, costDataIncompleteCount: 2 } }, everything);
  assert.deepEqual(items.slice(0, 2).map((item) => [item.key, item.tone]), [["ledgerImbalance", "problem"], ["costData", "problem"]]);
});

test("an account only sees what it could act on", () => {
  const driversOnly = (permission: Permission) => permission === "MANAGE_DRIVERS";
  assert.deepEqual(attentionItems(inputs, driversOnly).map((item) => item.key), ["pendingDrivers"]);
  // No accounting overview (the account cannot read the books): no money items at all.
  assert.deepEqual(
    attentionItems({ ...inputs, accounting: null }, everything).map((item) => item.key),
    ["ordersAwaiting", "pendingStores", "pendingDrivers"]
  );
});

test("an older API without the new counts simply shows fewer items", () => {
  assert.deepEqual(attentionItems({ pendingRestaurantApprovals: 1 }, everything).map((item) => item.key), ["pendingStores"]);
});

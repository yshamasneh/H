import assert from "node:assert/strict";
import { test } from "node:test";
import { isPackingStatus, nextPickedValue, packLineState, packProgress, withPicked, type PackLine } from "./pack-checklist";

const line = (id: string, isPicked: boolean, adjustment: PackLine["fulfillmentAdjustment"] = null): PackLine => ({
  id,
  isPicked,
  fulfillmentAdjustment: adjustment
});
const approvedReplacement = { status: "APPROVED", replacementMenuItemId: "m2" } as const;
const reweighed = { status: "APPROVED", replacementMenuItemId: null } as const;
const declined = { status: "REJECTED", replacementMenuItemId: "m3" } as const;
const pending = { status: "PENDING", replacementMenuItemId: "m4" } as const;

test("a line is 'todo' until the server says it is picked", () => {
  assert.equal(packLineState(line("a", false)), "todo");
  assert.equal(packLineState(line("a", true)), "picked");
});

test("an approved replacement is a different state from a plain pick, so it cannot look like one", () => {
  assert.equal(packLineState(line("a", false, approvedReplacement)), "todo");
  assert.equal(packLineState(line("a", true, approvedReplacement)), "pickedReplacement");
});

test("a re-weighed line, or one whose replacement the customer declined, packs as an ordinary line", () => {
  assert.equal(packLineState(line("a", true, reweighed)), "picked");
  assert.equal(packLineState(line("a", true, declined)), "picked");
});

test("a line waiting for the customer is never packed, even if the server has a stale flag on it", () => {
  assert.equal(packLineState(line("a", false, pending)), "awaitingCustomer");
  assert.equal(packLineState(line("a", true, pending)), "awaitingCustomer");
});

test("progress counts packed lines and is complete only when every line is", () => {
  const lines = [line("a", true), line("b", true, approvedReplacement), line("c", false)];
  const partial = packProgress(lines);
  assert.deepEqual(partial, { total: 3, packed: 2, remainingIds: ["c"], complete: false });
  assert.equal(packProgress(withPicked(lines, "c", true)).complete, true);
});

test("a line waiting on the customer keeps the order from being complete", () => {
  const progress = packProgress([line("a", true), line("b", true, pending)]);
  assert.equal(progress.complete, false);
  assert.deepEqual(progress.remainingIds, ["b"]);
});

test("an order with no lines is not complete", () => {
  assert.equal(packProgress([]).complete, false);
});

test("tapping asks the server for the opposite value, and nothing for a line waiting on the customer", () => {
  assert.equal(nextPickedValue(line("a", false)), true);
  assert.equal(nextPickedValue(line("a", true)), false);
  assert.equal(nextPickedValue(line("a", false, pending)), null);
});

test("withPicked changes only the named line and never mutates the input", () => {
  const lines = [line("a", false), line("b", false)];
  const next = withPicked(lines, "b", true);
  assert.deepEqual(next.map((entry) => entry.isPicked), [false, true]);
  assert.deepEqual(lines.map((entry) => entry.isPicked), [false, false]);
  assert.deepEqual(withPicked(lines, "ghost", true).map((entry) => entry.isPicked), [false, false]);
});

test("only ACCEPTED and PREPARING orders are being packed", () => {
  assert.equal(isPackingStatus("ACCEPTED"), true);
  assert.equal(isPackingStatus("PREPARING"), true);
  for (const status of ["PLACED", "READY_FOR_PICKUP", "DELIVERED", "REJECTED", "CANCELLED", "DELIVERY_FAILED"] as const) {
    assert.equal(isPackingStatus(status), false, status);
  }
});

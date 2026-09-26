import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isPackingStatus,
  nextPickedValue,
  packLineState,
  packProgress,
  parsePackingEvent,
  trimQuantity,
  withPicked,
  type PackLine
} from "./packChecklist";

const line = (id: string, isPicked: boolean, adjustment: PackLine["fulfillmentAdjustment"] = null): PackLine => ({
  id,
  isPicked,
  fulfillmentAdjustment: adjustment
});
const approvedReplacement = { status: "APPROVED", replacementMenuItemId: "m2" } as const;
const reweighed = { status: "APPROVED", replacementMenuItemId: null } as const;
const declined = { status: "REJECTED", replacementMenuItemId: "m3" } as const;
const pending = { status: "PENDING", replacementMenuItemId: "m4" } as const;

test("a line is 'todo' until the server says it is picked; a server without the field reads as unpicked", () => {
  assert.equal(packLineState(line("a", false)), "todo");
  assert.equal(packLineState(line("a", true)), "picked");
  assert.equal(packLineState({ id: "a", fulfillmentAdjustment: null }), "todo");
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

test("progress is complete only when every line is packed, and a waiting line blocks it", () => {
  const lines = [line("a", true), line("b", true, approvedReplacement), line("c", false)];
  assert.deepEqual(packProgress(lines), { total: 3, packed: 2, remainingIds: ["c"], complete: false });
  assert.equal(packProgress(withPicked(lines, "c", true)).complete, true);
  assert.equal(packProgress([line("a", true), line("b", true, pending)]).complete, false);
  assert.equal(packProgress([]).complete, false);
});

test("tapping asks the server for the opposite value, and nothing for a line waiting on the customer", () => {
  assert.equal(nextPickedValue(line("a", false)), true);
  assert.equal(nextPickedValue(line("a", true)), false);
  assert.equal(nextPickedValue(line("a", false, pending)), null);
});

test("withPicked changes only the named line and never mutates the input", () => {
  const lines = [line("a", false), line("b", false)];
  assert.deepEqual(withPicked(lines, "b", true).map((entry) => entry.isPicked), [false, true]);
  assert.deepEqual(lines.map((entry) => entry.isPicked), [false, false]);
  assert.deepEqual(withPicked(lines, "ghost", true).map((entry) => entry.isPicked), [false, false]);
});

test("a packing socket event is only accepted in its exact shape", () => {
  assert.deepEqual(parsePackingEvent({ orderId: "o", orderItemId: "i", isPicked: true }), { orderId: "o", orderItemId: "i", isPicked: true });
  for (const bad of [null, undefined, "x", 3, {}, { orderId: "o", orderItemId: "i" }, { orderId: "o", orderItemId: 1, isPicked: true }, { orderId: "o", orderItemId: "i", isPicked: "true" }]) {
    assert.equal(parsePackingEvent(bad), null, JSON.stringify(bad));
  }
});

test("only ACCEPTED and PREPARING orders are being packed", () => {
  assert.equal(isPackingStatus("ACCEPTED"), true);
  assert.equal(isPackingStatus("PREPARING"), true);
  for (const status of ["PLACED", "READY_FOR_PICKUP", "DELIVERED", "REJECTED", "CANCELLED", "DELIVERY_FAILED"]) {
    assert.equal(isPackingStatus(status), false, status);
  }
});

test("quantities are trimmed without trailing zeros", () => {
  assert.equal(trimQuantity(2), "2");
  assert.equal(trimQuantity(1.5), "1.5");
  assert.equal(trimQuantity(1.2340001), "1.234");
});

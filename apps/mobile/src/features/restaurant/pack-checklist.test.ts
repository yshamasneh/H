import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isPackingStatus,
  packLineState,
  packProgress,
  packedStorageKey,
  parsePicked,
  serializePicked,
  togglePicked,
  type PackLine
} from "./pack-checklist";

const plain: PackLine = { id: "plain", fulfillmentAdjustment: null };
const replaced: PackLine = { id: "replaced", fulfillmentAdjustment: { status: "APPROVED", replacementMenuItemId: "m2" } };
const reweighed: PackLine = { id: "reweighed", fulfillmentAdjustment: { status: "APPROVED", replacementMenuItemId: null } };
const declined: PackLine = { id: "declined", fulfillmentAdjustment: { status: "REJECTED", replacementMenuItemId: "m3" } };
const waiting: PackLine = { id: "waiting", fulfillmentAdjustment: { status: "PENDING", replacementMenuItemId: "m4" } };
const none = new Set<string>();

test("a line is 'todo' until it is ticked, then 'picked'", () => {
  assert.equal(packLineState(plain, none), "todo");
  assert.equal(packLineState(plain, new Set(["plain"])), "picked");
});

test("an approved replacement is a different state from a plain pick, so it cannot look like one", () => {
  assert.equal(packLineState(replaced, none), "todo");
  assert.equal(packLineState(replaced, new Set(["replaced"])), "pickedReplacement");
});

test("a re-weighed line, or one whose replacement the customer declined, packs as an ordinary line", () => {
  assert.equal(packLineState(reweighed, new Set(["reweighed"])), "picked");
  assert.equal(packLineState(declined, new Set(["declined"])), "picked");
});

test("a line waiting for the customer is never packed, even if its id is in the stored set", () => {
  assert.equal(packLineState(waiting, none), "awaitingCustomer");
  assert.equal(packLineState(waiting, new Set(["waiting"])), "awaitingCustomer");
});

test("progress counts packed lines and is complete only when every line is", () => {
  const lines = [plain, replaced, reweighed];
  assert.deepEqual(packProgress(lines, none), { total: 3, packed: 0, remainingIds: ["plain", "replaced", "reweighed"], complete: false });
  const partial = packProgress(lines, new Set(["plain", "replaced"]));
  assert.equal(partial.packed, 2);
  assert.deepEqual(partial.remainingIds, ["reweighed"]);
  assert.equal(partial.complete, false);
  assert.equal(packProgress(lines, new Set(["plain", "replaced", "reweighed"])).complete, true);
});

test("a line waiting on the customer keeps the order from being complete", () => {
  const progress = packProgress([plain, waiting], new Set(["plain", "waiting"]));
  assert.equal(progress.complete, false);
  assert.deepEqual(progress.remainingIds, ["waiting"]);
});

test("an order with no lines is not complete", () => {
  assert.equal(packProgress([], none).complete, false);
});

test("toggling flips a line and returns a new set without mutating the old one", () => {
  const start = new Set<string>();
  const ticked = togglePicked([plain], start, "plain");
  assert.deepEqual([...ticked], ["plain"]);
  assert.equal(start.size, 0);
  assert.deepEqual([...togglePicked([plain], ticked, "plain")], []);
});

test("a line waiting for the customer cannot be ticked, and an unknown id is ignored", () => {
  assert.deepEqual([...togglePicked([waiting], none, "waiting")], []);
  assert.deepEqual([...togglePicked([plain], none, "ghost")], []);
});

test("only ACCEPTED and PREPARING orders are being packed", () => {
  assert.equal(isPackingStatus("ACCEPTED"), true);
  assert.equal(isPackingStatus("PREPARING"), true);
  for (const status of ["PLACED", "READY_FOR_PICKUP", "DELIVERED", "REJECTED", "CANCELLED", "DELIVERY_FAILED"] as const) {
    assert.equal(isPackingStatus(status), false, status);
  }
});

test("stored progress round-trips, and ignores ids that are no longer on the order", () => {
  const raw = serializePicked(new Set(["a", "b", "gone"]));
  assert.deepEqual([...parsePicked(raw, ["a", "b", "c"])].sort(), ["a", "b"]);
});

test("corrupt, empty or foreign stored progress reads as nothing packed", () => {
  assert.equal(parsePicked(null, ["a"]).size, 0);
  assert.equal(parsePicked("", ["a"]).size, 0);
  assert.equal(parsePicked("{not json", ["a"]).size, 0);
  assert.equal(parsePicked('{"a":true}', ["a"]).size, 0);
  assert.equal(parsePicked("[1,2,null]", ["a"]).size, 0);
});

test("each order has its own storage key", () => {
  assert.notEqual(packedStorageKey("order-1"), packedStorageKey("order-2"));
});

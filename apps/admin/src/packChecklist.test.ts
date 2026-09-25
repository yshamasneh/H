import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  clearPicked,
  isPackingStatus,
  loadPicked,
  packLineState,
  packProgress,
  packedStorageKey,
  parsePicked,
  savePicked,
  togglePicked,
  trimQuantity,
  type PackLine
} from "./packChecklist";

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

test("progress is complete only when every line is packed, and a waiting line blocks it", () => {
  const lines = [plain, replaced, reweighed];
  assert.equal(packProgress(lines, none).complete, false);
  assert.deepEqual(packProgress(lines, new Set(["plain", "replaced"])).remainingIds, ["reweighed"]);
  assert.equal(packProgress(lines, new Set(["plain", "replaced", "reweighed"])).complete, true);
  assert.equal(packProgress([plain, waiting], new Set(["plain", "waiting"])).complete, false);
  assert.equal(packProgress([], none).complete, false);
});

test("toggling flips a line without mutating the old set; waiting lines and unknown ids are ignored", () => {
  const start = new Set<string>();
  const ticked = togglePicked([plain], start, "plain");
  assert.deepEqual([...ticked], ["plain"]);
  assert.equal(start.size, 0);
  assert.deepEqual([...togglePicked([plain], ticked, "plain")], []);
  assert.deepEqual([...togglePicked([waiting], none, "waiting")], []);
  assert.deepEqual([...togglePicked([plain], none, "ghost")], []);
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

test("corrupt, empty or foreign stored progress reads as nothing packed; stale ids are dropped", () => {
  assert.equal(parsePicked(null, ["a"]).size, 0);
  assert.equal(parsePicked("{not json", ["a"]).size, 0);
  assert.equal(parsePicked('{"a":true}', ["a"]).size, 0);
  assert.deepEqual([...parsePicked('["a","gone"]', ["a", "b"])], ["a"]);
});

// --- browser persistence, against a stand-in localStorage --------------------------------------

function installStorage(overrides: Partial<Storage> = {}) {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    ...overrides
  };
  return data;
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

test("progress is saved per order, reloaded, and cleared", () => {
  const data = installStorage();
  savePicked("order-1", new Set(["a", "b"]));
  assert.ok(data.has(packedStorageKey("order-1")));
  assert.deepEqual([...loadPicked("order-1", ["a", "b", "c"])].sort(), ["a", "b"]);
  assert.equal(loadPicked("order-2", ["a"]).size, 0, "another order is unaffected");
  clearPicked("order-1");
  assert.equal(loadPicked("order-1", ["a", "b"]).size, 0);
});

test("with no localStorage, or one that throws, packing still works in memory", () => {
  assert.equal(loadPicked("order-1", ["a"]).size, 0);
  assert.doesNotThrow(() => savePicked("order-1", new Set(["a"])));
  assert.doesNotThrow(() => clearPicked("order-1"));

  installStorage({
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
    removeItem: () => { throw new Error("blocked"); }
  });
  assert.equal(loadPicked("order-1", ["a"]).size, 0);
  assert.doesNotThrow(() => savePicked("order-1", new Set(["a"])));
  assert.doesNotThrow(() => clearPicked("order-1"));
});

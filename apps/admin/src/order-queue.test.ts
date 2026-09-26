import assert from "node:assert/strict";
import test from "node:test";
import type { BusinessOrder } from "./api.business";
import { ageLabel, alertRepeatMs, escalateAfterMs, oldestAgeMs, popupOrder, pruneSetAside, queueSections } from "./order-queue";

function order(id: string, status: string, createdAt = "2026-09-26T10:00:00.000Z"): BusinessOrder {
  return { id, status, createdAt, items: [] } as unknown as BusinessOrder;
}

test("the board has one section per real store status, in workflow order", () => {
  const sections = queueSections({
    new: [order("n1", "PLACED")],
    inProgress: [order("a1", "ACCEPTED"), order("p1", "PREPARING"), order("a2", "ACCEPTED")],
    ready: [order("r1", "READY_FOR_PICKUP")]
  });
  assert.deepEqual(
    sections.map((section) => [section.status, section.orders.map((entry) => entry.id)]),
    [
      ["PLACED", ["n1"]],
      ["ACCEPTED", ["a1", "a2"]],
      ["PREPARING", ["p1"]],
      ["READY_FOR_PICKUP", ["r1"]]
    ]
  );
});

test("empty sections are still present, so the counts row never shifts under a finger", () => {
  const sections = queueSections({ new: [], inProgress: [], ready: [] });
  assert.equal(sections.length, 4);
  assert.ok(sections.every((section) => section.orders.length === 0));
});

test("the popup shows the oldest new order, skipping ones set aside on this device", () => {
  const newOrders = [order("old", "PLACED"), order("mid", "PLACED"), order("young", "PLACED")];
  assert.equal(popupOrder(newOrders, new Set())?.order.id, "old");
  assert.equal(popupOrder(newOrders, new Set())?.othersWaiting, 2);
  assert.equal(popupOrder(newOrders, new Set(["old"]))?.order.id, "mid");
  assert.equal(popupOrder(newOrders, new Set(["old", "mid", "young"])), null);
  assert.equal(popupOrder([], new Set()), null, "nothing new on the server means no popup, whatever this device clicked");
});

test("set-aside ids are forgotten once the order is no longer new", () => {
  assert.deepEqual([...pruneSetAside(new Set(["gone", "still"]), [order("still", "PLACED")])], ["still"]);
});

test("the alert repeats faster once the oldest new order is overdue", () => {
  assert.ok(alertRepeatMs(escalateAfterMs + 1) < alertRepeatMs(0));
  assert.ok(alertRepeatMs(0) > 2_300, "the gap is longer than the sound itself");
});

test("oldest age is measured from the earliest order", () => {
  const now = new Date("2026-09-26T10:05:00.000Z").getTime();
  assert.equal(oldestAgeMs([order("a", "PLACED", "2026-09-26T10:04:00.000Z"), order("b", "PLACED")], now), 5 * 60_000);
  assert.equal(oldestAgeMs([], now), 0);
});

test("ages read as minutes, then hours, then days", () => {
  assert.deepEqual(ageLabel(59 * 60_000), { key: "liveOrders.elapsed", count: 59 });
  assert.deepEqual(ageLabel(125 * 60_000), { key: "liveOrders.elapsedHours", count: 2 });
  assert.deepEqual(ageLabel(25_272 * 60_000), { key: "liveOrders.elapsedDays", count: 17 });
});

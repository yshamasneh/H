import assert from "node:assert/strict";
import { test } from "node:test";
import { carryingDays, expectedHandoverMinor, handoverDifferenceMinor } from "./cash-handover";

const lines = [
  { custodyId: "a", outstandingMinor: 2400 },
  { custodyId: "b", outstandingMinor: 5400 },
  { custodyId: "c", outstandingMinor: 2800 }
];

test("with nothing ticked the whole balance is expected; with orders ticked, only those", () => {
  assert.equal(expectedHandoverMinor(10_600, lines, new Set()), 10_600);
  assert.equal(expectedHandoverMinor(10_600, lines, new Set(["a", "c"])), 5200);
  assert.equal(expectedHandoverMinor(10_600, lines, new Set(["b"])), 5400);
});

test("the difference is counted minus expected, and unknown until something is counted", () => {
  assert.equal(handoverDifferenceMinor(null, 5200), null);
  assert.equal(handoverDifferenceMinor(5200, 5200), 0);
  assert.equal(handoverDifferenceMinor(5000, 5200), -200);
  assert.equal(handoverDifferenceMinor(5300, 5200), 100);
});

test("carrying days count whole days since the oldest unsettled collection", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  assert.equal(carryingDays(null, now), 0);
  assert.equal(carryingDays("2026-09-28T08:00:00Z", now), 0);
  assert.equal(carryingDays("2026-09-27T11:59:00Z", now), 1);
  assert.equal(carryingDays("2026-09-25T12:00:00Z", now), 3);
  assert.equal(carryingDays("2026-09-29T00:00:00Z", now), 0);
});

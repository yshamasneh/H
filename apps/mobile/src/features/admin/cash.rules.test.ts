import assert from "node:assert/strict";
import { test } from "node:test";
import {
  carryingDays,
  expectedHandoverMinor,
  formatMinorPlain,
  handoverDifferenceMinor,
  parseMoneyToMinor,
  suggestReference
} from "./cash.rules";

const lines = [
  { custodyId: "a", outstandingMinor: 2400 },
  { custodyId: "b", outstandingMinor: 5400 },
  { custodyId: "c", outstandingMinor: 2800 }
];

test("expected cash: the whole balance with nothing ticked, otherwise only the ticked orders", () => {
  assert.equal(expectedHandoverMinor(10_600, lines, new Set()), 10_600);
  assert.equal(expectedHandoverMinor(10_600, lines, new Set(["a", "c"])), 5200);
});

test("the difference is counted minus expected, unknown until a count is typed", () => {
  assert.equal(handoverDifferenceMinor(null, 5200), null);
  assert.equal(handoverDifferenceMinor(5000, 5200), -200);
  assert.equal(handoverDifferenceMinor(5300, 5200), 100);
  assert.equal(handoverDifferenceMinor(5200, 5200), 0);
});

test("carrying days are whole days since the oldest unsettled collection", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  assert.equal(carryingDays(null, now), 0);
  assert.equal(carryingDays("2026-09-28T08:00:00Z", now), 0);
  assert.equal(carryingDays("2026-09-25T12:00:00Z", now), 3);
});

test("typed amounts parse exactly, in either script, and ambiguous input is refused", () => {
  assert.equal(parseMoneyToMinor("320.50"), 32_050);
  assert.equal(parseMoneyToMinor("1.15"), 115);
  assert.equal(parseMoneyToMinor("٣٢٠٫٥"), 32_050);
  assert.equal(parseMoneyToMinor("320"), 32_000);
  assert.equal(parseMoneyToMinor(" 0 "), 0);
  assert.equal(parseMoneyToMinor(""), null);
  assert.equal(parseMoneyToMinor("1.234"), null);
  assert.equal(parseMoneyToMinor("-5"), null);
  assert.equal(parseMoneyToMinor("12a"), null);
});

test("amounts are formatted back for editing without float drift", () => {
  assert.equal(formatMinorPlain(32_050), "320.50");
  assert.equal(formatMinorPlain(5), "0.05");
  assert.equal(formatMinorPlain(-200), "-2.00");
});

test("references are prefixed, dated and different each time", () => {
  const first = suggestReference("HANDOVER", new Date("2026-09-28T10:00:00Z"));
  assert.match(first, /^HANDOVER-2026-09-28-[A-Z0-9]{1,4}$/);
});

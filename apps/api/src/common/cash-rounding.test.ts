import assert from "node:assert/strict";
import { test } from "node:test";
import { cashDue, cashRoundingMinor, roundCashUpMinor } from "./cash-rounding";

test("a total is rounded UP to the next whole shekel: 23.40 becomes 24.00", () => {
  assert.equal(roundCashUpMinor(2_340), 2_400);
  assert.equal(cashRoundingMinor(2_340), 60);
});

test("a whole-shekel total is left alone, and one agora over goes up a full shekel", () => {
  assert.equal(roundCashUpMinor(2_400), 2_400);
  assert.equal(cashRoundingMinor(2_400), 0);
  assert.equal(roundCashUpMinor(2_401), 2_500);
  assert.equal(cashRoundingMinor(2_401), 99);
});

test("rounding never takes money off the customer: it is never below the exact total and never a shekel or more above it", () => {
  for (let total = 1; total <= 5_000; total += 1) {
    const rounded = roundCashUpMinor(total);
    assert.ok(rounded >= total, `${total} -> ${rounded}`);
    assert.ok(rounded - total < 100, `${total} -> ${rounded}`);
    assert.equal(rounded % 100, 0);
    assert.equal(rounded - total, cashRoundingMinor(total));
  }
});

test("a nothing-to-collect total stays nothing", () => {
  assert.deepEqual(cashDue(0), { cashDueMinor: 0, cashRoundingMinor: 0 });
  assert.equal(roundCashUpMinor(-50), 0);
});

test("cash is whole minor units: a fractional amount is a bug, not something to round quietly", () => {
  assert.throws(() => roundCashUpMinor(23.4), /whole minor units/);
});

test("cashDue returns both figures consistently", () => {
  assert.deepEqual(cashDue(3_205), { cashDueMinor: 3_300, cashRoundingMinor: 95 });
});

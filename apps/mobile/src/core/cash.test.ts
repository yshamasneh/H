import assert from "node:assert/strict";
import { test } from "node:test";
import { cashDueMinorOf, cashRoundingMinorOf } from "./cash";

test("the phone displays the server's rounded cash due and never works it out itself", () => {
  const order = { totalMinor: 2_340, cashDueMinor: 2_400, cashRoundingMinor: 60 };
  assert.equal(cashDueMinorOf(order), 2_400);
  assert.equal(cashRoundingMinorOf(order), 60);
});

test("an API older than cash rounding sends nothing extra, and the exact total is the amount due", () => {
  const order = { totalMinor: 2_340 };
  assert.equal(cashDueMinorOf(order), 2_340);
  assert.equal(cashRoundingMinorOf(order), 0);
});

test("a rounding figure that is missing is derived from the two amounts the server did send", () => {
  assert.equal(cashRoundingMinorOf({ totalMinor: 2_340, cashDueMinor: 2_400 }), 60);
});

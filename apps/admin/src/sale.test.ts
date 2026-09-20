import assert from "node:assert/strict";
import test from "node:test";
import { isBelowCost, parseSaleInput, salePercentOff } from "./sale";

test("a blank sale field means no sale", () => {
  assert.deepEqual(parseSaleInput("20.00", ""), { ok: true, saleMinor: null });
  assert.deepEqual(parseSaleInput("20.00", "   "), { ok: true, saleMinor: null });
});

test("a valid sale is converted to minor units exactly", () => {
  assert.deepEqual(parseSaleInput("20.00", "10"), { ok: true, saleMinor: 1000 });
  assert.deepEqual(parseSaleInput("20", "14.99"), { ok: true, saleMinor: 1499 });
  assert.deepEqual(parseSaleInput("1.15", "1.14"), { ok: true, saleMinor: 114 });
  assert.deepEqual(parseSaleInput("٢٠", "١٠"), { ok: true, saleMinor: 1000 }, "Arabic-Indic digits");
});

test("a sale that is not below the regular price is refused", () => {
  assert.deepEqual(parseSaleInput("20.00", "20.00"), { ok: false, error: "notBelowPrice" });
  assert.deepEqual(parseSaleInput("20.00", "25"), { ok: false, error: "notBelowPrice" });
  assert.deepEqual(parseSaleInput("20.00", "19.99"), { ok: true, saleMinor: 1999 });
});

test("junk, zero and negative sale prices are refused", () => {
  for (const bad of ["abc", "0", "0.00", "-5", "1.234"]) {
    assert.deepEqual(parseSaleInput("20", bad), { ok: false, error: "invalid" }, bad);
  }
  assert.deepEqual(parseSaleInput("", "5"), { ok: false, error: "priceInvalid" });
});

test("the percentage comes from the two prices and is never 0 or 100 for a real sale", () => {
  assert.equal(salePercentOff(2000, 1000), 50);
  assert.equal(salePercentOff(1500, 1200), 20);
  assert.equal(salePercentOff(1999, 1499), 25);
  assert.equal(salePercentOff(10_000, 9_999), 1);
  assert.equal(salePercentOff(1000, 1), 99);
  assert.equal(salePercentOff(1000, 1000), 0);
  // Changing either price changes the figure; nothing is stored.
  assert.notEqual(salePercentOff(2000, 1000), salePercentOff(2000, 1500));
  assert.notEqual(salePercentOff(2000, 1000), salePercentOff(4000, 1000));
});

test("a sale below cost is flagged", () => {
  assert.equal(isBelowCost(1000, 1200), true);
  assert.equal(isBelowCost(1200, 1200), false);
  assert.equal(isBelowCost(null, 1200), false);
  assert.equal(isBelowCost(1000, null), false);
});

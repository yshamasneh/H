import assert from "node:assert/strict";
import { test } from "node:test";
import { hasReduction, isSale, salePercentOff } from "./sale";

test("the badge percentage is calculated from the two prices", () => {
  assert.equal(salePercentOff(2000, 1000), 50, "20.00 reduced to 10.00 is 50%");
  assert.equal(salePercentOff(1500, 1200), 20);
  assert.equal(salePercentOff(1999, 1499), 25);
});

test("it updates whenever either price changes", () => {
  assert.equal(salePercentOff(2000, 1000), 50);
  assert.equal(salePercentOff(2000, 1500), 25, "sale price raised");
  assert.equal(salePercentOff(4000, 1000), 75, "regular price raised");
});

test("it is never 0% for a real reduction, never 100%, and 0 when there is no sale", () => {
  assert.equal(salePercentOff(10_000, 9_999), 1);
  assert.equal(salePercentOff(1000, 1), 99);
  assert.equal(salePercentOff(1000, 1000), 0);
  assert.equal(salePercentOff(1000, 1500), 0);
  assert.equal(salePercentOff(0, 0), 0);
});

test("a sale is the store's own reduced price, distinct from an offer-derived one", () => {
  assert.equal(isSale({ priceMinor: 2000, salePriceMinor: 1000 }), true);
  assert.equal(isSale({ priceMinor: 2000, salePriceMinor: null }), false);
  assert.equal(isSale({ priceMinor: 2000 }), false);
  assert.equal(hasReduction(2000, 1800), true, "an offer reduces the price too");
  assert.equal(hasReduction(2000, 2000), false);
});

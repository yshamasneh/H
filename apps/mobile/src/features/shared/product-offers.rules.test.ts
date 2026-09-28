import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isOnOffer,
  matchesOfferSearch,
  offerAttention,
  offerPercent,
  offerPriceForPercent,
  offerSavingMinor,
  offerSummary,
  parseOfferPrice,
  selectOfferRows,
  type OfferItem
} from "./product-offers.rules";

function item(overrides: Partial<OfferItem>): OfferItem {
  return {
    id: "p",
    categoryId: "dairy",
    name: "Product",
    priceMinor: 2000,
    salePriceMinor: null,
    costPriceMinor: null,
    imageUrl: null,
    sku: null,
    barcode: null,
    brand: null,
    unitLabel: "item",
    isAvailable: true,
    ...overrides
  };
}

test("the discount is worked out from the two prices", () => {
  assert.equal(offerPercent(item({ priceMinor: 2000, salePriceMinor: 1000 })), 50);
  assert.equal(offerPercent(item({ priceMinor: 2000, salePriceMinor: 1500 })), 25);
  assert.equal(offerPercent(item({ priceMinor: 10_000, salePriceMinor: 7000 })), 30);
  assert.equal(offerSavingMinor(item({ priceMinor: 2000, salePriceMinor: 1500 })), 500);
});

test("no offer, an equal price or a higher price is not a discount", () => {
  assert.equal(offerPercent(item({ salePriceMinor: null })), 0);
  assert.equal(offerPercent(item({ priceMinor: 2000, salePriceMinor: 2000 })), 0);
  assert.equal(offerPercent(item({ priceMinor: 2000, salePriceMinor: 2500 })), 0);
  assert.equal(isOnOffer(item({ priceMinor: 2000, salePriceMinor: 2000 })), false);
  assert.equal(offerPercent(item({ priceMinor: 0, salePriceMinor: 0 })), 0);
});

test("the manager types only the offer price; the percentage follows", () => {
  assert.deepEqual(parseOfferPrice(2000, "10"), { ok: true, saleMinor: 1000, percent: 50, savingMinor: 1000 });
  assert.deepEqual(parseOfferPrice(2000, "15"), { ok: true, saleMinor: 1500, percent: 25, savingMinor: 500 });
  assert.deepEqual(parseOfferPrice(10_000, "70"), { ok: true, saleMinor: 7000, percent: 30, savingMinor: 3000 });
  assert.deepEqual(parseOfferPrice(2000, "١٢٫٥"), { ok: true, saleMinor: 1250, percent: 38, savingMinor: 750 });
  // Editing the price changes the percentage.
  assert.equal((parseOfferPrice(2000, "18") as { percent: number }).percent, 10);
});

test("invalid offer prices are refused with a reason, including a bad regular price", () => {
  assert.deepEqual(parseOfferPrice(2000, ""), { ok: false, error: "empty" });
  assert.deepEqual(parseOfferPrice(2000, "abc"), { ok: false, error: "invalid" });
  assert.deepEqual(parseOfferPrice(2000, "0"), { ok: false, error: "invalid" });
  assert.deepEqual(parseOfferPrice(2000, "20"), { ok: false, error: "notBelowPrice" });
  assert.deepEqual(parseOfferPrice(2000, "25"), { ok: false, error: "notBelowPrice" });
  assert.deepEqual(parseOfferPrice(0, "10"), { ok: false, error: "regularInvalid" });
});

test("quick percentage chips give an offer price strictly below the regular price", () => {
  assert.equal(offerPriceForPercent(2000, 50), 1000);
  assert.equal(offerPriceForPercent(1999, 25), 1499);
  assert.equal(offerPriceForPercent(2, 10), 1);
  assert.equal(offerPriceForPercent(0, 10), null);
  assert.equal(offerPriceForPercent(2000, 0), null);
});

test("offers needing attention: sold below cost, or on offer while hidden from customers", () => {
  assert.deepEqual(offerAttention(item({ salePriceMinor: 900, costPriceMinor: 1000 })), ["belowCost"]);
  assert.deepEqual(offerAttention(item({ salePriceMinor: 1500, isAvailable: false })), ["hidden"]);
  assert.deepEqual(offerAttention(item({ salePriceMinor: 1500, costPriceMinor: 1000 })), []);
  assert.deepEqual(offerAttention(item({ salePriceMinor: null, costPriceMinor: 5000 })), []);
});

test("search matches name, SKU, barcode, brand and category, in any order, Arabic-aware", () => {
  const milk = item({ name: "حليب المراعي 1 لتر", sku: "MLK-1", barcode: "6281007030013", brand: "Almarai" });
  assert.equal(matchesOfferSearch(milk, "ألبان", "مراعي حليب"), true);
  assert.equal(matchesOfferSearch(milk, "ألبان", "mlk"), true);
  assert.equal(matchesOfferSearch(milk, "ألبان", "6281007"), true);
  assert.equal(matchesOfferSearch(milk, "ألبان", "almarai"), true);
  assert.equal(matchesOfferSearch(milk, "ألبان", "البان"), true);
  assert.equal(matchesOfferSearch(milk, "ألبان", "خبز"), false);
});

test("rows put running offers first, biggest discount first, and filter as asked", () => {
  const rows = [
    item({ id: "a", name: "Apple", salePriceMinor: null }),
    item({ id: "b", name: "Bread", salePriceMinor: 1500 }),
    item({ id: "c", name: "Cheese", salePriceMinor: 1000 }),
    item({ id: "d", name: "Dates", salePriceMinor: 1800, isAvailable: false })
  ];
  const names = new Map([["dairy", "Dairy"]]);
  const pick = (filter: "all" | "onSale" | "notOnSale" | "attention", search = "") =>
    selectOfferRows(rows, { search, categoryId: "", filter, categoryNames: names }).map((row) => row.id);
  assert.deepEqual(pick("all"), ["c", "b", "d", "a"]);
  assert.deepEqual(pick("onSale"), ["c", "b", "d"]);
  assert.deepEqual(pick("notOnSale"), ["a"]);
  assert.deepEqual(pick("attention"), ["d"]);
  assert.deepEqual(pick("all", "dairy"), ["c", "b", "d", "a"]);
  assert.deepEqual(offerSummary(rows), { products: 4, onOffer: 3, attention: 1, biggestPercent: 50 });
});

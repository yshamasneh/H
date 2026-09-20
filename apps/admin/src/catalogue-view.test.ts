import assert from "node:assert/strict";
import test from "node:test";
import type { MenuItemOwner } from "./api.business";
import { categoryCounts, emptyFilter, filterProducts, hiddenCount, normalizeSearch, onSaleCount, paginate } from "./catalogue-view";

const item = (over: Partial<MenuItemOwner>): MenuItemOwner => ({
  id: over.id ?? "i",
  categoryId: "c1",
  name: "Item",
  description: null,
  priceMinor: 100,
  salePriceMinor: over.salePriceMinor ?? null,
  costPriceMinor: null,
  imageUrl: null,
  sku: null,
  brand: null,
  unitLabel: "item",
  stockQuantity: null,
  reorderLevel: null,
  barcode: null,
  isFeatured: false,
  isVariableWeight: false,
  isAvailable: true,
  ...over
});

const items = [
  item({ id: "1", name: "Falafel Sandwich", categoryId: "c1", sku: "FS-1" }),
  item({ id: "2", name: "Hummus", categoryId: "c2", brand: "Al-Jood", isAvailable: false }),
  item({ id: "3", name: "ماء معدني", categoryId: "c2", barcode: "6281000123" }),
  item({ id: "4", name: "Cola", categoryId: "c3", isAvailable: false })
];
const ids = (list: MenuItemOwner[]) => list.map((entry) => entry.id);

test("search matches name, SKU, barcode and brand, ignoring case", () => {
  assert.deepEqual(ids(filterProducts(items, { ...emptyFilter, search: "FALAFEL" })), ["1"]);
  assert.deepEqual(ids(filterProducts(items, { ...emptyFilter, search: "fs-1" })), ["1"]);
  assert.deepEqual(ids(filterProducts(items, { ...emptyFilter, search: "62810001" })), ["3"]);
  assert.deepEqual(ids(filterProducts(items, { ...emptyFilter, search: "jood" })), ["2"]);
  assert.deepEqual(ids(filterProducts(items, emptyFilter)), ["1", "2", "3", "4"]);
});

test("Arabic search ignores diacritics and alef / ta-marbuta variants", () => {
  assert.equal(normalizeSearch("مَاء"), normalizeSearch("ماء"));
  assert.equal(normalizeSearch("أحمد"), normalizeSearch("احمد"));
  assert.equal(normalizeSearch("مدرسة"), normalizeSearch("مدرسه"));
  assert.deepEqual(ids(filterProducts(items, { ...emptyFilter, search: "مَاء" })), ["3"]);
});

test("the visibility filter separates visible products from hidden ones", () => {
  assert.deepEqual(ids(filterProducts(items, { ...emptyFilter, visibility: "HIDDEN" })), ["2", "4"]);
  assert.deepEqual(ids(filterProducts(items, { ...emptyFilter, visibility: "VISIBLE" })), ["1", "3"]);
  assert.equal(hiddenCount(items), 2);
});

test("filters combine", () => {
  assert.deepEqual(ids(filterProducts(items, { ...emptyFilter, categoryId: "c2", visibility: "HIDDEN" })), ["2"]);
  assert.deepEqual(ids(filterProducts(items, { ...emptyFilter, search: "hum", categoryId: "c1" })), []);
});

test("category counts include hidden products, which still belong to their category", () => {
  const counts = categoryCounts(items);
  assert.deepEqual(counts.get("c1"), { total: 1, visible: 1, hidden: 0 });
  assert.deepEqual(counts.get("c2"), { total: 2, visible: 1, hidden: 1 });
  assert.deepEqual(counts.get("c3"), { total: 1, visible: 0, hidden: 1 });
  assert.equal(counts.get("empty"), undefined);
});

test("pagination slices pages and clamps a bad page number", () => {
  const rows = Array.from({ length: 5 }, (_, index) => index);
  assert.deepEqual(paginate(rows, 1, 2), [0, 1]);
  assert.deepEqual(paginate(rows, 3, 2), [4]);
  assert.deepEqual(paginate(rows, 0, 2), [0, 1]);
  assert.deepEqual(paginate(rows, 9, 2), []);
});

test("the on-sale filter shows only products with a sale running, and counts them", () => {
  const withSales = [...items, item({ id: "5", name: "Juice", salePriceMinor: 50 }), item({ id: "6", name: "Tea", salePriceMinor: 70, isAvailable: false })];
  assert.deepEqual(ids(filterProducts(withSales, { ...emptyFilter, onSaleOnly: true })), ["5", "6"]);
  assert.deepEqual(ids(filterProducts(withSales, { ...emptyFilter, onSaleOnly: true, visibility: "VISIBLE" })), ["5"]);
  assert.equal(onSaleCount(withSales), 2);
});

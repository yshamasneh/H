import assert from "node:assert/strict";
import { test } from "node:test";
import { categorySummaries, hiddenAcrossCategories, productsInCategory } from "./catalogue-browse";

const categories = [
  { id: "canned", name: "معلبات", isActive: true, sortOrder: 2 },
  { id: "dairy", name: "ألبان", isActive: true, sortOrder: 1 },
  { id: "empty", name: "منظفات", isActive: false, sortOrder: 3 }
];
const items = [
  { id: "1", name: "لبنة", categoryId: "dairy", isAvailable: true },
  { id: "2", name: "حليب", categoryId: "dairy", isAvailable: false },
  { id: "3", name: "جبنة", categoryId: "dairy", isAvailable: true },
  { id: "4", name: "فول", categoryId: "canned", isAvailable: false },
  { id: "5", name: "تونة", categoryId: "canned", isAvailable: true }
];

test("lists every category in store order with its product, available and hidden counts", () => {
    assert.deepEqual(categorySummaries(categories, items).map((summary) => [summary.category.id, summary.total, summary.available, summary.hidden]), [
      ["dairy", 3, 2, 1],
      ["canned", 2, 1, 1],
      ["empty", 0, 0, 0]
    ]);
  });

test("splits one category into Available and Hidden, each sorted by name", () => {
    assert.deepEqual(productsInCategory(items, "dairy", "AVAILABLE").map((item) => item.name), ["جبنة", "لبنة"]);
    assert.deepEqual(productsInCategory(items, "dairy", "HIDDEN").map((item) => item.name), ["حليب"]);
  });

test("gathers hidden products from every category, in category order", () => {
    assert.deepEqual(hiddenAcrossCategories(items, categories).map((item) => item.id), ["2", "4"]);
  });

test("a product hidden in one view appears hidden in every view (one source of truth)", () => {
    const afterHiding = items.map((item) => (item.id === "5" ? { ...item, isAvailable: false } : item));
    assert.deepEqual(productsInCategory(afterHiding, "canned", "AVAILABLE"), []);
    assert.deepEqual(productsInCategory(afterHiding, "canned", "HIDDEN").map((item) => item.id), ["5", "4"], "sorted by name: تونة before فول");
    assert.ok(hiddenAcrossCategories(afterHiding, categories).some((item) => item.id === "5"));
    assert.equal(categorySummaries(categories, afterHiding).find((summary) => summary.category.id === "canned")?.hidden, 2);
  });

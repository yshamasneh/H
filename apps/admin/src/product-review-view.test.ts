import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewQueueItem } from "./api.products";
import { approvalSummary, editBody, queryForFilter, toggleAll, toggleOne } from "./product-review-view";

const item = (id: string, reviewStatus: ReviewQueueItem["reviewStatus"] = "PENDING_REVIEW"): ReviewQueueItem => ({
  id, restaurantId: "s1", restaurantName: "JOVO MARKET", categoryId: "c1", categoryName: "Dairy", name: "Milk", description: null,
  brand: null, barcode: "0072940001234", sku: null, priceMinor: 500, imageUrl: null, isAvailable: true, reviewStatus, reviewedAt: null
});

test("the filter maps to the API query; ALL sends no status", () => {
  assert.deepEqual(queryForFilter("PENDING_REVIEW", " milk ", 2), { reviewStatus: "PENDING_REVIEW", search: "milk", page: 2, pageSize: 50 });
  assert.equal(queryForFilter("ALL", "", 1).reviewStatus, undefined);
  assert.equal(queryForFilter("ALL", "  ", 1).search, undefined);
});

test("select-all picks only pending products and toggles back to none", () => {
  const items = [item("a"), item("b"), item("c", "APPROVED")];
  const all = toggleAll(new Set(), items);
  assert.deepEqual([...all].sort(), ["a", "b"]);
  assert.equal(toggleAll(all, items).size, 0);
  assert.deepEqual([...toggleOne(new Set(["a"]), "b")].sort(), ["a", "b"]);
  assert.deepEqual([...toggleOne(new Set(["a"]), "a")], []);
});

test("the edit body carries only changed fields, and refuses an unreadable price", () => {
  const base = item("a");
  assert.deepEqual(editBody(base, { name: "Milk", description: "", brand: "", categoryId: "c1", price: "5" }), {});
  assert.deepEqual(editBody(base, { name: "حليب", description: "طازج", brand: "Al-Juneidi", categoryId: "c2", price: "5.50" }), {
    name: "حليب", description: "طازج", brand: "Al-Juneidi", categoryId: "c2", priceMinor: 550
  });
  assert.equal(editBody(base, { name: "Milk", description: "", brand: "", categoryId: "c1", price: "abc" }), null);
  assert.equal(editBody(base, { name: "Milk", description: "", brand: "", categoryId: "c1", price: "0" }), null);
});

test("the approval summary counts approved, refused and skipped", () => {
  assert.deepEqual(approvalSummary({ approved: ["a"], alreadyApproved: ["b"], notFound: ["c"], refused: [{ id: "d", matches: ["vodka"] }] }), { approved: 1, refused: 1, skipped: 2 });
});

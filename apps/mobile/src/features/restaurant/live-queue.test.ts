import assert from "node:assert/strict";
import { test } from "node:test";
import type { OrderDetail } from "../../core/api";
import { ageLabel, alertRepeatMs, escalateAfterMs, popupOrder, pruneSetAside, queueSections } from "./live-queue.rules";
import { filterProducts, matchesSearch, normalizeSearch } from "./product-search";

function order(id: string, status: string): OrderDetail {
  return { id, status, createdAt: "2026-09-26T10:00:00.000Z", items: [] } as unknown as OrderDetail;
}

test("orders are split into the four store sections by their real status", () => {
  const sections = queueSections({
    new: [order("n", "PLACED")],
    inProgress: [order("a", "ACCEPTED"), order("p", "PREPARING")],
    ready: [order("r", "READY_FOR_PICKUP")]
  });
  assert.deepEqual(sections.map((section) => [section.status, section.orders.map((entry) => entry.id)]), [
    ["PLACED", ["n"]],
    ["ACCEPTED", ["a"]],
    ["PREPARING", ["p"]],
    ["READY_FOR_PICKUP", ["r"]]
  ]);
});

test("the popup follows the server's NEW list, skipping orders set aside on this phone", () => {
  const newOrders = [order("old", "PLACED"), order("young", "PLACED")];
  assert.equal(popupOrder(newOrders, new Set())?.order.id, "old");
  assert.equal(popupOrder(newOrders, new Set(["old"]))?.order.id, "young");
  assert.equal(popupOrder([], new Set()), null);
  assert.deepEqual([...pruneSetAside(new Set(["old", "gone"]), newOrders)], ["old"]);
});

test("the alert repeats faster once an order is overdue, never faster than the sound", () => {
  assert.ok(alertRepeatMs(escalateAfterMs + 1) < alertRepeatMs(0));
  assert.ok(alertRepeatMs(escalateAfterMs + 1) > 2_300);
});

test("ages read as minutes, hours, then days", () => {
  assert.deepEqual(ageLabel(5 * 60_000), { key: "live.ageMinutes", count: 5 });
  assert.deepEqual(ageLabel(3 * 3_600_000), { key: "live.ageHours", count: 3 });
  assert.deepEqual(ageLabel(50 * 3_600_000), { key: "live.ageDays", count: 2 });
});

test("product search narrows on partial words, in any order, across name, barcode and brand", () => {
  const milk = { name: "حليب المراعي كامل الدسم", sku: null, barcode: "6281007", brand: "Almarai" };
  assert.ok(matchesSearch(milk, "حل"));
  assert.ok(matchesSearch(milk, "مراعي حليب"));
  assert.ok(matchesSearch(milk, "almarai 628"));
  assert.ok(!matchesSearch(milk, "حليب لبن"));
  assert.equal(filterProducts([milk], "  ").length, 1);
});

test("product search ignores the Arabic spellings people type inconsistently", () => {
  assert.equal(normalizeSearch("مَاءُ"), normalizeSearch("ماء"));
  assert.equal(normalizeSearch("أرز"), normalizeSearch("ارز"));
  assert.equal(normalizeSearch("ٱلمراعي"), normalizeSearch("المراعي"));
  assert.equal(normalizeSearch("قهوة"), normalizeSearch("قهوه"));
  assert.equal(normalizeSearch("مستشفى"), normalizeSearch("مستشفي"));
});

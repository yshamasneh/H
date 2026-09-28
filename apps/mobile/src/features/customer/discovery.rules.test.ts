import assert from "node:assert/strict";
import { test } from "node:test";
import type { OrderDetail } from "../../core/api";
import { buyAgainItems } from "./discovery.rules";

function line(menuItemId: string, name: string, adjustment: Record<string, unknown> | null = null) {
  return { id: `${menuItemId}-line`, menuItemId, nameSnapshot: name, imageUrl: `https://img/${menuItemId}`, fulfillmentAdjustment: adjustment };
}

function order(status: string, createdAt: string, items: ReturnType<typeof line>[]): OrderDetail {
  return { id: createdAt, status, createdAt, restaurant: { id: "s1", name: "JOVO MARKET" }, items } as unknown as OrderDetail;
}

test("buy again lists delivered products, newest order first, once each", () => {
  const items = buyAgainItems([
    order("DELIVERED", "2026-09-01T10:00:00Z", [line("milk", "Milk"), line("bread", "Bread")]),
    order("DELIVERED", "2026-09-20T10:00:00Z", [line("eggs", "Eggs"), line("milk", "Milk")]),
    order("CANCELLED", "2026-09-25T10:00:00Z", [line("chips", "Chips")]),
    order("DELIVERY_FAILED", "2026-09-26T10:00:00Z", [line("cola", "Cola")])
  ]);
  assert.deepEqual(items.map((item) => item.productId), ["eggs", "milk", "bread"]);
  assert.equal(items[0].imageUrl, "https://img/eggs");
  assert.equal(items[0].storeId, "s1");
});

test("an approved substitution offers what was actually delivered", () => {
  const items = buyAgainItems([
    order("DELIVERED", "2026-09-20T10:00:00Z", [
      line("labneh", "Labneh", { status: "APPROVED", replacementMenuItemId: "yogurt", replacementNameSnapshot: "Yogurt", replacementImageUrl: null }),
      line("rice", "Rice", { status: "APPROVED", replacementMenuItemId: null, replacementNameSnapshot: null }),
      line("oil", "Oil", { status: "REJECTED", replacementMenuItemId: "ghee", replacementNameSnapshot: "Ghee" })
    ])
  ]);
  assert.deepEqual(items.map((item) => [item.productId, item.name]), [["yogurt", "Yogurt"], ["rice", "Rice"], ["oil", "Oil"]]);
});

test("the list is capped", () => {
  const many = Array.from({ length: 15 }, (_, index) => line(`p${index}`, `P${index}`));
  assert.equal(buyAgainItems([order("DELIVERED", "2026-09-20T10:00:00Z", many)], 10).length, 10);
  assert.deepEqual(buyAgainItems([]), []);
});

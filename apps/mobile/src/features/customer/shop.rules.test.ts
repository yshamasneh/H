import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cart } from "./cart";
import { canAddMore, cartSavingsMinor, formatShekel, quantityInCart, stockState } from "./shop.rules";

const cart: Cart = {
  restaurantId: "store",
  restaurantName: "JOVO MARKET",
  items: [
    { menuItemId: "labneh", name: "Labneh", priceMinor: 999, quantity: 2, unitLabel: "item", allowSubstitution: true, regularPriceMinor: 1250 },
    { menuItemId: "bread", name: "Bread", priceMinor: 425, quantity: 3, unitLabel: "item", allowSubstitution: false, regularPriceMinor: null }
  ]
};

test("prices are formatted from whole agorot", () => {
  assert.equal(formatShekel(2340), "23.40 ILS");
  assert.equal(formatShekel(5), "0.05 ILS");
  assert.equal(formatShekel(115), "1.15 ILS");
  assert.equal(formatShekel(0), "0.00 ILS");
  assert.equal(formatShekel(-455), "-4.55 ILS");
});

test("stock reads as untracked, in stock, low with a count, or out", () => {
  assert.deepEqual(stockState(null), { kind: "untracked" });
  assert.deepEqual(stockState(40), { kind: "in" });
  assert.deepEqual(stockState(5), { kind: "low", left: 5 });
  assert.deepEqual(stockState(1), { kind: "low", left: 1 });
  assert.deepEqual(stockState(0), { kind: "out" });
});

test("the basket quantity of a product, only for the same store", () => {
  assert.equal(quantityInCart(cart, "labneh"), 2);
  assert.equal(quantityInCart(cart, "labneh", "store"), 2);
  assert.equal(quantityInCart(cart, "labneh", "other-store"), 0);
  assert.equal(quantityInCart(cart, "milk"), 0);
  assert.equal(quantityInCart(null, "labneh"), 0);
});

test("more can be added up to a counted stock level, and freely when stock is not counted", () => {
  assert.equal(canAddMore(null, 99), true);
  assert.equal(canAddMore(3, 2), true);
  assert.equal(canAddMore(3, 3), false);
  assert.equal(canAddMore(0, 0), false);
});

test("basket savings add up only the sale lines", () => {
  // (12.50 - 9.99) x 2 = 5.02
  assert.equal(cartSavingsMinor(cart), 502);
  assert.equal(cartSavingsMinor(null), 0);
});

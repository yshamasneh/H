import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addCartItem,
  cartBelongsToRestaurant,
  cartItemCount,
  cartSubtotalMinor,
  removeCartItem,
  setCartItemSubstitution,
  setCartItemQuantity,
  startCart
} from "./cart";

const restaurant = { id: "r1", name: "Falafel House" };
const sandwich = { id: "i1", name: "Falafel Sandwich", priceMinor: 1500 };
const hummus = { id: "i2", name: "Hummus", priceMinor: 1000 };

test("starting a cart creates a single line with quantity 1", () => {
  const cart = startCart(restaurant, sandwich);
  assert.equal(cart.restaurantId, "r1");
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].quantity, 1);
});

test("adding the same item again increments its quantity instead of duplicating", () => {
  let cart = startCart(restaurant, sandwich);
  cart = addCartItem(cart, sandwich);
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].quantity, 2);
});

test("adding a different item appends a new line", () => {
  let cart = startCart(restaurant, sandwich);
  cart = addCartItem(cart, hummus);
  assert.equal(cart.items.length, 2);
});

test("setting quantity to zero removes the line", () => {
  let cart = startCart(restaurant, sandwich);
  cart = addCartItem(cart, hummus);
  const updated = setCartItemQuantity(cart, sandwich.id, 0);
  assert.ok(updated);
  assert.equal(updated!.items.length, 1);
  assert.equal(updated!.items[0].menuItemId, hummus.id);
});

test("removing the last item collapses the cart to null", () => {
  const cart = startCart(restaurant, sandwich);
  const updated = removeCartItem(cart, sandwich.id);
  assert.equal(updated, null);
});

test("subtotal and item count sum quantities correctly", () => {
  let cart = startCart(restaurant, sandwich);
  cart = addCartItem(cart, sandwich);
  cart = addCartItem(cart, hummus);
  assert.equal(cartSubtotalMinor(cart), 1500 * 2 + 1000);
  assert.equal(cartItemCount(cart), 3);
});

test("an empty cart belongs to any restaurant, a non-empty cart only to its own", () => {
  assert.equal(cartBelongsToRestaurant(null, "r1"), true);
  const cart = startCart(restaurant, sandwich);
  assert.equal(cartBelongsToRestaurant(cart, "r1"), true);
  assert.equal(cartBelongsToRestaurant(cart, "r2"), false);
});

test("a grocery line keeps its unit and substitution preference", () => {
  const cart = startCart(restaurant, { ...sandwich, unitLabel: "1 kg", allowSubstitution: true });
  assert.equal(cart.items[0].unitLabel, "1 kg");
  assert.equal(cart.items[0].allowSubstitution, true);

  const updated = setCartItemSubstitution(cart, sandwich.id, false);
  assert.equal(updated.items[0].allowSubstitution, false);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cartStorageKey,
  createCartRepository,
  deserializeCart,
  serializeCart,
  type KeyValueStore
} from "./cart-storage";
import type { Cart } from "../features/customer/cart";

const sampleCart: Cart = {
  restaurantId: "store-1",
  restaurantName: "JOVO MARKET",
  items: [
    { menuItemId: "m1", name: "Milk", priceMinor: 750, quantity: 2, unitLabel: "carton", allowSubstitution: true },
    { menuItemId: "m2", name: "Bread", priceMinor: 400, quantity: 1, unitLabel: "loaf", allowSubstitution: false }
  ]
};

function memoryStore(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  const store: KeyValueStore = {
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => {
      map.set(key, value);
    },
    removeItem: async (key) => {
      map.delete(key);
    }
  };
  return { map, store };
}

test("a cart survives a simulated restart (save → fresh load → same items)", async () => {
  const { store } = memoryStore();
  const writer = createCartRepository(store);
  await writer.save(sampleCart);

  // A brand-new repository over the same backing store == a fresh app launch.
  const reader = createCartRepository(store);
  const loaded = await reader.load();
  assert.deepEqual(loaded, sampleCart);
});

test("save(null) clears the persisted cart (used on placed order / logout)", async () => {
  const { store, map } = memoryStore();
  const repo = createCartRepository(store);
  await repo.save(sampleCart);
  assert.ok(map.has(cartStorageKey));

  await repo.save(null);
  assert.equal(map.has(cartStorageKey), false);
  assert.equal(await repo.load(), null);
});

test("clear() removes the persisted cart", async () => {
  const { store, map } = memoryStore();
  const repo = createCartRepository(store);
  await repo.save(sampleCart);
  await repo.clear();
  assert.equal(map.has(cartStorageKey), false);
});

test("an emptied cart is treated as no cart and clears storage", async () => {
  const { map, store } = memoryStore();
  const repo = createCartRepository(store);
  await repo.save({ ...sampleCart, items: [] });
  assert.equal(map.has(cartStorageKey), false);
});

test("corrupt stored data does not crash and loads as an empty cart", async () => {
  const warnings: string[] = [];
  const { store } = memoryStore({ [cartStorageKey]: "{not valid json" });
  const repo = createCartRepository(store, (message) => warnings.push(message));
  const loaded = await repo.load();
  assert.equal(loaded, null);
  assert.equal(warnings.length, 1);
});

test("well-formed JSON of the wrong shape is rejected", async () => {
  assert.equal(deserializeCart(JSON.stringify({ restaurantId: "x" })), null);
  assert.equal(deserializeCart(JSON.stringify({ restaurantId: "x", restaurantName: "y", items: "nope" })), null);
  assert.equal(
    deserializeCart(JSON.stringify({ restaurantId: "x", restaurantName: "y", items: [{ menuItemId: 1 }] })),
    null
  );
  assert.equal(deserializeCart(null), null);
  assert.equal(deserializeCart(""), null);
});

test("serialize → deserialize is a faithful round trip", () => {
  assert.deepEqual(deserializeCart(serializeCart(sampleCart)), sampleCart);
});

test("a large cart (25 Arabic-named items) round-trips with no loss or truncation", async () => {
  // ~4.6KB serialized — well past SecureStore's 2KB cap, which is exactly why the cart is
  // backed by AsyncStorage (no such limit). This asserts the serialize/deserialize + repo
  // layer carries every item faithfully at that size.
  const bigCart: Cart = {
    restaurantId: "clzxstore0000000000000001",
    restaurantName: "جوّو ماركت",
    items: Array.from({ length: 25 }, (_, index) => ({
      menuItemId: `clzx${String(index).padStart(20, "a")}`,
      name: `حليب طازج كامل الدسم ${index} لتر`,
      priceMinor: 750 + index,
      quantity: (index % 5) + 1,
      unitLabel: "كرتونة",
      allowSubstitution: index % 2 === 0
    }))
  };
  assert.ok(Buffer.byteLength(serializeCart(bigCart), "utf8") > 2048, "test cart should exceed the old 2KB cap");

  const { store } = memoryStore();
  await createCartRepository(store).save(bigCart);
  const loaded = await createCartRepository(store).load();

  assert.deepEqual(loaded, bigCart);
  assert.equal(loaded?.items.length, 25);
});

test("a storage write failure is swallowed (a lost cart must never crash the app)", async () => {
  const warnings: string[] = [];
  const store: KeyValueStore = {
    getItem: async () => null,
    setItem: async () => {
      throw new Error("disk full");
    },
    removeItem: async () => {}
  };
  const repo = createCartRepository(store, (message) => warnings.push(message));
  await assert.doesNotReject(repo.save(sampleCart));
  assert.equal(warnings.length, 1);
});

test("a storage read failure degrades to an empty cart", async () => {
  const store: KeyValueStore = {
    getItem: async () => {
      throw new Error("read error");
    },
    setItem: async () => {},
    removeItem: async () => {}
  };
  const repo = createCartRepository(store);
  assert.equal(await repo.load(), null);
});

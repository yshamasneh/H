import type { Cart, CartItem } from "../features/customer/cart";

/**
 * Persistence for the customer cart (M-3: the cart used to live only in React state and
 * was lost on app kill/restart). The serialize/deserialize/validate logic lives here as a
 * pure module over a small key-value interface so it can be unit-tested with an in-memory
 * store (cart-storage.test.ts); the native SecureStore/web backing lives in kv-storage.ts.
 */

export const cartStorageKey = "wasel_customer_cart";

/** The minimal key-value surface the cart repository needs from whatever backs it. */
export type KeyValueStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export function serializeCart(cart: Cart): string {
  return JSON.stringify(cart);
}

/**
 * Parses a stored cart, returning null for anything that is not a well-formed cart.
 * Corrupt or partially-written data must never crash boot — it degrades to "no cart".
 */
export function deserializeCart(raw: string | null): Cart | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate.restaurantId !== "string" ||
    typeof candidate.restaurantName !== "string" ||
    !Array.isArray(candidate.items)
  ) {
    return null;
  }
  const items: CartItem[] = [];
  for (const entry of candidate.items) {
    if (!entry || typeof entry !== "object") return null;
    const line = entry as Record<string, unknown>;
    if (
      typeof line.menuItemId !== "string" ||
      typeof line.name !== "string" ||
      typeof line.priceMinor !== "number" ||
      typeof line.quantity !== "number" ||
      line.quantity <= 0 ||
      typeof line.unitLabel !== "string" ||
      typeof line.allowSubstitution !== "boolean"
    ) {
      return null;
    }
    items.push({
      menuItemId: line.menuItemId,
      name: line.name,
      priceMinor: line.priceMinor,
      quantity: line.quantity,
      unitLabel: line.unitLabel,
      allowSubstitution: line.allowSubstitution
    });
  }
  if (items.length === 0) return null;
  return { restaurantId: candidate.restaurantId, restaurantName: candidate.restaurantName, items };
}

export type CartRepository = {
  load: () => Promise<Cart | null>;
  save: (cart: Cart | null) => Promise<void>;
  clear: () => Promise<void>;
};

/**
 * Builds a cart repository over any KeyValueStore. `save(null)` clears storage, so App.tsx
 * can persist with a single effect keyed on the cart state. All reads/writes are
 * fail-soft: a storage error never propagates into the UI (a lost cart is recoverable, a
 * crash is not), and an unreadable payload is treated as an empty cart.
 */
export function createCartRepository(
  store: KeyValueStore,
  onWarn: (message: string, error: unknown) => void = () => {}
): CartRepository {
  return {
    async load() {
      let raw: string | null;
      try {
        raw = await store.getItem(cartStorageKey);
      } catch (error) {
        onWarn("Failed to read the saved cart; starting empty.", error);
        return null;
      }
      const cart = deserializeCart(raw);
      if (raw && !cart) onWarn("Discarded a corrupt saved cart.", raw);
      return cart;
    },
    async save(cart) {
      try {
        if (!cart || cart.items.length === 0) {
          await store.removeItem(cartStorageKey);
          return;
        }
        await store.setItem(cartStorageKey, serializeCart(cart));
      } catch (error) {
        onWarn("Failed to persist the cart.", error);
      }
    },
    async clear() {
      try {
        await store.removeItem(cartStorageKey);
      } catch (error) {
        onWarn("Failed to clear the saved cart.", error);
      }
    }
  };
}

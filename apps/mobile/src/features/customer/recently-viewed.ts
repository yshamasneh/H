import type { KeyValueStore } from "../../core/cart-storage";

/**
 * Products this customer has recently opened, kept on the device only, so the storefront can offer
 * a quick way back to them. Deliberately stores no price: a remembered price would go stale, so
 * the card shows the picture and name and the product page loads the current price when opened.
 */

export type RecentlyViewedProduct = {
  id: string;
  storeId: string;
  name: string;
  imageUrl: string | null;
  viewedAt: number;
};

export const recentlyViewedLimit = 12;

const storageKey = (userId: string) => `jovo-recently-viewed:${userId}`;

/** The list after viewing `product`: most recent first, no duplicates, capped. */
export function withViewed(list: RecentlyViewedProduct[], product: Omit<RecentlyViewedProduct, "viewedAt">, now: number): RecentlyViewedProduct[] {
  return [{ ...product, viewedAt: now }, ...list.filter((entry) => entry.id !== product.id)].slice(0, recentlyViewedLimit);
}

/** Reads the stored list, tolerating anything malformed (a corrupt entry is dropped, never thrown). */
export function parseRecentlyViewed(raw: string | null): RecentlyViewedProduct[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (entry): entry is RecentlyViewedProduct =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as RecentlyViewedProduct).id === "string" &&
          typeof (entry as RecentlyViewedProduct).storeId === "string" &&
          typeof (entry as RecentlyViewedProduct).name === "string"
      )
      .map((entry) => ({ ...entry, imageUrl: entry.imageUrl ?? null, viewedAt: Number(entry.viewedAt) || 0 }))
      .slice(0, recentlyViewedLimit);
  } catch {
    return [];
  }
}

export async function loadRecentlyViewed(store: KeyValueStore, userId: string): Promise<RecentlyViewedProduct[]> {
  try {
    return parseRecentlyViewed(await store.getItem(storageKey(userId)));
  } catch {
    return [];
  }
}

/** Records a view. A storage failure only means the shortcut is missing later; it never surfaces. */
export async function recordRecentlyViewed(
  store: KeyValueStore,
  userId: string,
  product: Omit<RecentlyViewedProduct, "viewedAt">,
  now: number = Date.now()
): Promise<void> {
  try {
    const current = await loadRecentlyViewed(store, userId);
    await store.setItem(storageKey(userId), JSON.stringify(withViewed(current, product, now)));
  } catch {
    // ignored: see above
  }
}

import type { Cart } from "./cart";

/**
 * Display rules shared by every customer shopping screen, so a price, a stock level and a basket
 * quantity read the same on the home storefront, the catalogue, the product page and the basket.
 * Nothing here changes what is charged: the order API re-prices every line itself.
 */

/**
 * Agorot as "12.50 ILS", from integers only. The screens used `(minor / 100).toFixed(2)`, which is
 * a float division; this can never drift by an agora however the division rounds.
 */
export function formatShekel(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const absolute = Math.abs(Math.round(minor));
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")} ILS`;
}

/** At or below this many units left, the customer is told how many remain. */
export const lowStockThreshold = 5;

export type StockState =
  | { kind: "untracked" }
  | { kind: "in" }
  | { kind: "low"; left: number }
  | { kind: "out" };

/** How a product's stock reads to a customer. `null` stock means the store does not count it. */
export function stockState(stockQuantity: number | null | undefined): StockState {
  if (stockQuantity === null || stockQuantity === undefined) return { kind: "untracked" };
  if (stockQuantity <= 0) return { kind: "out" };
  if (stockQuantity <= lowStockThreshold) return { kind: "low", left: stockQuantity };
  return { kind: "in" };
}

/** How many of a product are already in the basket (0 when none, or the basket is another store's). */
export function quantityInCart(cart: Cart | null, productId: string, storeId?: string): number {
  if (!cart || (storeId && cart.restaurantId !== storeId)) return 0;
  return cart.items.find((line) => line.menuItemId === productId)?.quantity ?? 0;
}

/**
 * Whether one more can be added: never past a counted stock level. The server still validates on
 * checkout; this only keeps the + button from offering what the store has already said it lacks.
 */
export function canAddMore(stockQuantity: number | null | undefined, inCart: number): boolean {
  if (stockQuantity === null || stockQuantity === undefined) return true;
  return inCart < stockQuantity;
}

/** What the sale prices in the basket save against the regular prices, in agorot (display only). */
export function cartSavingsMinor(cart: Cart | null): number {
  if (!cart) return 0;
  return cart.items.reduce(
    (sum, line) => sum + (line.regularPriceMinor && line.regularPriceMinor > line.priceMinor ? (line.regularPriceMinor - line.priceMinor) * line.quantity : 0),
    0
  );
}

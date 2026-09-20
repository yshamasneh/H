import { ApiException } from "../common/api.exception";

/**
 * The sale price rules, in one place.
 *
 * A product's `salePriceMinor` is the price customers pay while a sale is on (null = no sale). It is
 * only ever a *reduction*: strictly below the regular price. The database has a CHECK for the same
 * thing, but that would surface as an opaque 500; this gives the operator a message they can act on.
 */

/** What one unit costs the customer right now: the sale price when there is one, else the regular price. */
export function chargedUnitPriceMinor(item: { priceMinor: number; salePriceMinor?: number | null }): number {
  return item.salePriceMinor != null ? item.salePriceMinor : item.priceMinor;
}

export function isOnSale(item: { priceMinor: number; salePriceMinor?: number | null }): boolean {
  return item.salePriceMinor != null && item.salePriceMinor < item.priceMinor;
}

/**
 * Whole-number percentage saved, from the two prices. Rounded to nearest but never 0 for a real
 * reduction (a 0% badge would look like a bug) and never 100 (a price of zero is not a sale).
 * The customer app computes the same figure from the same two prices; this is the reference.
 */
export function salePercentOff(regularMinor: number, saleMinor: number): number {
  if (regularMinor <= 0 || saleMinor >= regularMinor) return 0;
  const exact = ((regularMinor - saleMinor) * 100) / regularMinor;
  return Math.min(99, Math.max(1, Math.round(exact)));
}

/** Refuse a sale price that is not below the regular price it would replace. */
export function assertValidSalePrice(priceMinor: number, salePriceMinor: number | null | undefined): void {
  if (salePriceMinor == null) return;
  if (salePriceMinor < 1) {
    throw new ApiException(400, "SALE_PRICE_INVALID", "The sale price must be greater than zero.");
  }
  if (salePriceMinor >= priceMinor) {
    throw new ApiException(
      400,
      "SALE_PRICE_NOT_BELOW_PRICE",
      "The sale price must be lower than the regular price. Lower the sale price, or clear it.",
      { priceMinor, salePriceMinor }
    );
  }
}

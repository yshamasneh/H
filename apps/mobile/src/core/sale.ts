/**
 * Sale-price display maths for the customer app.
 *
 * The percentage is never stored or typed: it is worked out here from the two prices every time a
 * product is drawn, so it cannot go stale when either price changes. The API and the admin console
 * use the identical formula (`salePercentOff`), so a badge, an admin list row and an order all agree.
 */

/** Whole-number percentage saved. Never 0 for a real reduction, never 100, and 0 when there is no sale. */
export function salePercentOff(regularMinor: number, effectiveMinor: number): number {
  if (regularMinor <= 0 || effectiveMinor >= regularMinor) return 0;
  return Math.min(99, Math.max(1, Math.round(((regularMinor - effectiveMinor) * 100) / regularMinor)));
}

/** True when the customer pays less than the regular price. */
export function hasReduction(regularMinor: number, effectiveMinor: number): boolean {
  return effectiveMinor < regularMinor;
}

/**
 * A *sale* — the store's own reduced price — as opposed to a promotional offer, which has its own
 * label. Only sales get the percentage sticker on the picture.
 */
export function isSale(item: { priceMinor: number; salePriceMinor?: number | null }): boolean {
  return item.salePriceMinor != null && item.salePriceMinor < item.priceMinor;
}

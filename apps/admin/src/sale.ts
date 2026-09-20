import { parseMoneyToMinor, parsePositiveMoneyToMinor } from "./money";

/**
 * Sale-price form rules. A sale is only ever a reduction: strictly below the regular price. The API
 * enforces the same rule (and a database CHECK backs it); checking here puts the message next to the
 * field instead of after a round trip.
 */

export type SaleError = "invalid" | "priceInvalid" | "notBelowPrice";

export type SaleResult = { ok: true; saleMinor: number | null } | { ok: false; error: SaleError };

/** Blank means "no sale" (ends one that is running). */
export function parseSaleInput(priceText: string, saleText: string): SaleResult {
  if (!saleText.trim()) return { ok: true, saleMinor: null };
  const saleMinor = parsePositiveMoneyToMinor(saleText);
  if (saleMinor === null) return { ok: false, error: "invalid" };
  const priceMinor = parseMoneyToMinor(priceText);
  if (priceMinor === null) return { ok: false, error: "priceInvalid" };
  if (saleMinor >= priceMinor) return { ok: false, error: "notBelowPrice" };
  return { ok: true, saleMinor };
}

/**
 * Whole-number percentage saved, from the two prices — never typed by hand, so it cannot go stale
 * when either price changes. Never 0 for a real reduction and never 100 (a price of zero is not a
 * sale). The customer app and the API compute it identically.
 */
export function salePercentOff(regularMinor: number, saleMinor: number): number {
  if (regularMinor <= 0 || saleMinor >= regularMinor) return 0;
  return Math.min(99, Math.max(1, Math.round(((regularMinor - saleMinor) * 100) / regularMinor)));
}

/** A sale below what the goods cost is a loss on every sale: worth a warning, not a block. */
export function isBelowCost(saleMinor: number | null, costMinor: number | null): boolean {
  return saleMinor !== null && costMinor !== null && saleMinor < costMinor;
}

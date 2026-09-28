import type { MenuItemOwner } from "../../core/api";
import { parseMoneyToMinor } from "../../core/money";
import { salePercentOff } from "../../core/sale";
import { normalizeSearch } from "../restaurant/product-search";

/**
 * The rules behind the mobile product offers screens — the twin of the admin console's
 * apps/admin/src/offers-view.ts. An "offer" is the store's own sale price on a product
 * (`MenuItem.salePriceMinor`), the one mechanism the customer's sale sticker and checkout already
 * read. The manager types only the offer price; the discount is always worked out from the prices.
 */

export type OfferFilter = "all" | "onSale" | "notOnSale" | "attention";

export type OfferItem = Pick<
  MenuItemOwner,
  "id" | "categoryId" | "name" | "priceMinor" | "salePriceMinor" | "costPriceMinor" | "imageUrl" | "sku" | "barcode" | "brand" | "unitLabel" | "isAvailable"
>;

export function isOnOffer(item: Pick<OfferItem, "priceMinor" | "salePriceMinor">): boolean {
  return item.salePriceMinor != null && item.salePriceMinor < item.priceMinor;
}

/** The discount a customer sees, from the two prices (never typed). 0 without an offer. */
export function offerPercent(item: Pick<OfferItem, "priceMinor" | "salePriceMinor">): number {
  return isOnOffer(item) ? salePercentOff(item.priceMinor, item.salePriceMinor!) : 0;
}

/** What one unit saves the customer, in agorot. 0 without an offer. */
export function offerSavingMinor(item: Pick<OfferItem, "priceMinor" | "salePriceMinor">): number {
  return isOnOffer(item) ? item.priceMinor - item.salePriceMinor! : 0;
}

export type OfferAttention = "belowCost" | "hidden";

/** Sold below what the goods cost, or on offer while hidden from customers. */
export function offerAttention(item: OfferItem): OfferAttention[] {
  if (!isOnOffer(item)) return [];
  const reasons: OfferAttention[] = [];
  if (item.costPriceMinor != null && item.salePriceMinor! < item.costPriceMinor) reasons.push("belowCost");
  if (!item.isAvailable) reasons.push("hidden");
  return reasons;
}

/** Every typed word must appear in the name, SKU, barcode, brand or category, in any order. */
export function matchesOfferSearch(item: OfferItem, categoryName: string | undefined, search: string): boolean {
  const words = normalizeSearch(search).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [item.name, item.sku, item.barcode, item.brand, categoryName]
    .filter((field): field is string => Boolean(field))
    .map(normalizeSearch)
    .join(" ");
  return words.every((word) => haystack.includes(word));
}

export function matchesOfferFilter(item: OfferItem, filter: OfferFilter): boolean {
  switch (filter) {
    case "onSale":
      return isOnOffer(item);
    case "notOnSale":
      return !isOnOffer(item);
    case "attention":
      return offerAttention(item).length > 0;
    default:
      return true;
  }
}

/** Products on offer first (biggest discount first), then the rest alphabetically. */
export function selectOfferRows<T extends OfferItem>(
  items: T[],
  options: { search: string; categoryId: string; filter: OfferFilter; categoryNames: Map<string, string> }
): T[] {
  return items
    .filter((item) => !options.categoryId || item.categoryId === options.categoryId)
    .filter((item) => matchesOfferFilter(item, options.filter))
    .filter((item) => matchesOfferSearch(item, options.categoryNames.get(item.categoryId), options.search))
    .sort((left, right) => {
      const onLeft = isOnOffer(left);
      const onRight = isOnOffer(right);
      if (onLeft !== onRight) return onLeft ? -1 : 1;
      if (onLeft && onRight) {
        const byPercent = offerPercent(right) - offerPercent(left);
        if (byPercent !== 0) return byPercent;
      }
      return left.name.localeCompare(right.name);
    });
}

export type OfferSummary = { products: number; onOffer: number; attention: number; biggestPercent: number };

export function offerSummary(items: OfferItem[]): OfferSummary {
  let onOffer = 0;
  let attention = 0;
  let biggestPercent = 0;
  for (const item of items) {
    if (!isOnOffer(item)) continue;
    onOffer += 1;
    if (offerAttention(item).length > 0) attention += 1;
    biggestPercent = Math.max(biggestPercent, offerPercent(item));
  }
  return { products: items.length, onOffer, attention, biggestPercent };
}

export type OfferPriceError = "empty" | "invalid" | "notBelowPrice" | "regularInvalid";

export type OfferPriceResult =
  | { ok: true; saleMinor: number; percent: number; savingMinor: number }
  | { ok: false; error: OfferPriceError };

/**
 * Checks the typed offer price against the regular price and works out the discount. The offer
 * must be above zero and strictly below the regular price — the rule the API and database enforce.
 */
export function parseOfferPrice(regularMinor: number, text: string): OfferPriceResult {
  if (!Number.isInteger(regularMinor) || regularMinor <= 0) return { ok: false, error: "regularInvalid" };
  if (!text.trim()) return { ok: false, error: "empty" };
  const saleMinor = parseMoneyToMinor(text);
  if (saleMinor === null || saleMinor <= 0) return { ok: false, error: "invalid" };
  if (saleMinor >= regularMinor) return { ok: false, error: "notBelowPrice" };
  return { ok: true, saleMinor, percent: salePercentOff(regularMinor, saleMinor), savingMinor: regularMinor - saleMinor };
}

/** The offer price for a wanted discount (quick chips): nearest agora, ≥ 1, strictly below the price. */
export function offerPriceForPercent(regularMinor: number, percent: number): number | null {
  if (!Number.isInteger(regularMinor) || regularMinor <= 1 || percent <= 0 || percent >= 100) return null;
  const price = Math.round((regularMinor * (100 - percent)) / 100);
  return Math.min(regularMinor - 1, Math.max(1, price));
}

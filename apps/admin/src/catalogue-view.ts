import type { MenuItemOwner } from "./api.business";

/**
 * How the catalogue screen decides what to show. Kept out of the component so the rules — what a
 * search matches, what "hidden" means, what a category holds — can be tested.
 *
 * "Hidden" is the one state a product can be in that removes it from customers: the API's public
 * queries only ever return products with `isAvailable`, and an order for an unavailable product is
 * refused. The product itself, and every order that ever included it, stays in the database.
 */

export type Visibility = "ALL" | "VISIBLE" | "HIDDEN";

export type ProductFilter = {
  search: string;
  categoryId: string;
  visibility: Visibility;
  /** Only products with a sale price running. */
  onSaleOnly: boolean;
};

export const emptyFilter: ProductFilter = { search: "", categoryId: "", visibility: "ALL", onSaleOnly: false };

const arabicDiacritics = /[ً-ٰٟـ]/g;

/**
 * Lower-case, trim, and fold the Arabic variations a person will not type consistently: diacritics
 * and tatweel are dropped, and the alef forms, alef maqsura and ta marbuta are collapsed, so a
 * search for "ماء" finds "ماء" however the catalogue happened to spell it. The folds are a superset
 * of the API's trigram normalizer (apps/api/src/common/arabic-normalize.ts), so a product the
 * customer app finds by a spelling is also found here by it.
 */
export function normalizeSearch(value: string): string {
  return value
    .normalize("NFKC")
    .replace(arabicDiacritics, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLocaleLowerCase()
    .trim();
}

/**
 * Every typed word has to appear somewhere in the product's name, SKU, barcode or brand, in any
 * order and as any part of a word. So "حليب 1" finds "حليب المراعي 1 لتر", "مراعي حليب" finds it
 * too, and the list narrows with each character typed — nobody has to finish a word.
 */
export function matchesSearch(item: Pick<MenuItemOwner, "name" | "sku" | "barcode" | "brand">, search: string): boolean {
  const words = searchWords(search);
  if (words.length === 0) return true;
  const haystack = [item.name, item.sku, item.barcode, item.brand]
    .filter((field): field is string => Boolean(field))
    .map(normalizeSearch)
    .join(" ");
  return words.every((word) => haystack.includes(word));
}

function searchWords(search: string): string[] {
  return normalizeSearch(search).split(/\s+/).filter(Boolean);
}

export function filterProducts(items: MenuItemOwner[], filter: ProductFilter): MenuItemOwner[] {
  return items.filter(
    (item) =>
      matchesSearch(item, filter.search) &&
      (!filter.categoryId || item.categoryId === filter.categoryId) &&
      (filter.visibility === "ALL" || (filter.visibility === "VISIBLE") === item.isAvailable) &&
      (!filter.onSaleOnly || item.salePriceMinor !== null)
  );
}

export type CategoryCount = { total: number; visible: number; hidden: number };

/** What each category holds. A hidden product still belongs to its category and still counts. */
export function categoryCounts(items: Pick<MenuItemOwner, "categoryId" | "isAvailable">[]): Map<string, CategoryCount> {
  const counts = new Map<string, CategoryCount>();
  for (const item of items) {
    const entry = counts.get(item.categoryId) ?? { total: 0, visible: 0, hidden: 0 };
    entry.total += 1;
    if (item.isAvailable) entry.visible += 1;
    else entry.hidden += 1;
    counts.set(item.categoryId, entry);
  }
  return counts;
}

export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (Math.max(1, page) - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

export function onSaleCount(items: Pick<MenuItemOwner, "salePriceMinor">[]): number {
  return items.reduce((sum, item) => sum + (item.salePriceMinor !== null ? 1 : 0), 0);
}

export function hiddenCount(items: Pick<MenuItemOwner, "isAvailable">[]): number {
  return items.reduce((sum, item) => sum + (item.isAvailable ? 0 : 1), 0);
}

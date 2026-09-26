import type { MenuItemOwner } from "../../core/api";

/**
 * Instant, Arabic-aware product search for the store's own catalogue.
 *
 * The owner's product list is already on the device (one request loads every product), so matching
 * locally is what makes it instant: the list narrows on every character, with no request and no
 * debounce. The folding is the same as the admin console's (apps/admin/src/catalogue-view.ts) and a
 * superset of the API's trigram normalizer (apps/api/src/common/arabic-normalize.ts): diacritics and
 * tatweel dropped; alef forms, alef maqsura and ta marbuta collapsed.
 */
const arabicDiacritics = /[ً-ٰٟـ]/g;

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

/** Every typed word must appear somewhere in the name, SKU, barcode or brand, in any order. */
export function matchesSearch(item: Pick<MenuItemOwner, "name" | "sku" | "barcode" | "brand">, search: string): boolean {
  const words = normalizeSearch(search).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [item.name, item.sku, item.barcode, item.brand]
    .filter((field): field is string => Boolean(field))
    .map(normalizeSearch)
    .join(" ");
  return words.every((word) => haystack.includes(word));
}

export function filterProducts<T extends Pick<MenuItemOwner, "name" | "sku" | "barcode" | "brand">>(items: T[], search: string): T[] {
  return search.trim() ? items.filter((item) => matchesSearch(item, search)) : items;
}

import type { MenuCategoryOwner, MenuItemOwner } from "../../core/api";

/**
 * How the store's product list is browsed once it runs to thousands of products: categories first,
 * then one category's products split into Available and Hidden, plus a separate list of every hidden
 * product across all categories. All of it derives from the one product list already on the device,
 * so hiding a product in one view moves it in every other view at the same moment.
 *
 * The same rules drive the admin console (apps/admin/src/catalogue-view.ts).
 */
export type BrowseTab = "AVAILABLE" | "HIDDEN";

export type CategorySummary = {
  category: Pick<MenuCategoryOwner, "id" | "name" | "isActive" | "sortOrder">;
  total: number;
  available: number;
  hidden: number;
};

type Product = Pick<MenuItemOwner, "id" | "name" | "categoryId" | "isAvailable">;

/** Every category in the store's own order, with what it holds; empty categories still appear. */
export function categorySummaries(
  categories: CategorySummary["category"][],
  items: Pick<MenuItemOwner, "categoryId" | "isAvailable">[]
): CategorySummary[] {
  const counts = new Map<string, { total: number; hidden: number }>();
  for (const item of items) {
    const entry = counts.get(item.categoryId) ?? { total: 0, hidden: 0 };
    entry.total += 1;
    if (!item.isAvailable) entry.hidden += 1;
    counts.set(item.categoryId, entry);
  }
  return [...categories]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((category) => {
      const { total, hidden } = counts.get(category.id) ?? { total: 0, hidden: 0 };
      return { category, total, available: total - hidden, hidden };
    });
}

/** One category's products on one tab, by name. */
export function productsInCategory<T extends Product>(items: T[], categoryId: string, tab: BrowseTab): T[] {
  return items
    .filter((item) => item.categoryId === categoryId && item.isAvailable === (tab === "AVAILABLE"))
    .sort(byName);
}

/** Every hidden product, grouped by category in the store's category order, then by name. */
export function hiddenAcrossCategories<T extends Product>(items: T[], categories: Pick<MenuCategoryOwner, "id" | "sortOrder">[]): T[] {
  const order = new Map(categories.map((category) => [category.id, category.sortOrder]));
  return items
    .filter((item) => !item.isAvailable)
    .sort((a, b) => (order.get(a.categoryId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.categoryId) ?? Number.MAX_SAFE_INTEGER) || byName(a, b));
}

function byName(a: Pick<MenuItemOwner, "name">, b: Pick<MenuItemOwner, "name">): number {
  return a.name.localeCompare(b.name, "ar");
}

import type { OrderDetail } from "../../core/api";

/**
 * "Buy again" for the storefront: products this customer actually received, most recent first.
 *
 * Only DELIVERED orders count (a cancelled or failed order is not something they bought), one
 * entry per product, and a line the store substituted points at what was really delivered only
 * when the substitute is a known product; otherwise the originally ordered product is offered. No
 * price is carried: the product page shows the current one.
 */
export type BuyAgainItem = { productId: string; storeId: string; name: string; imageUrl: string | null };

export function buyAgainItems(orders: OrderDetail[], limit = 10): BuyAgainItem[] {
  const seen = new Set<string>();
  const items: BuyAgainItem[] = [];
  const delivered = orders
    .filter((order) => order.status === "DELIVERED")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  for (const order of delivered) {
    for (const line of order.items) {
      const adjustment = line.fulfillmentAdjustment;
      const substituted = adjustment?.status === "APPROVED" && adjustment.replacementMenuItemId;
      const productId = substituted ? adjustment.replacementMenuItemId! : line.menuItemId;
      if (!productId || seen.has(productId)) continue;
      seen.add(productId);
      items.push({
        productId,
        storeId: order.restaurant.id,
        name: substituted && adjustment.replacementNameSnapshot ? adjustment.replacementNameSnapshot : line.nameSnapshot,
        imageUrl: substituted ? adjustment.replacementImageUrl ?? null : line.imageUrl ?? null
      });
      if (items.length >= limit) return items;
    }
  }
  return items;
}

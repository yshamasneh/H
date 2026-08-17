import { listSupermarkets, type RestaurantSummary } from "../../core/api";

export type MarketStore = Pick<RestaurantSummary, "id" | "name" | "isOpenNow">;

let pending: Promise<MarketStore | null> | null = null;

/**
 * The launch has exactly one supermarket partner — JOVO MARKET — so the
 * customer never picks a store, and there is no store-selection screen in
 * front of the catalogue.
 *
 * The store's id still has to come from somewhere: the cart is keyed by
 * business id, and every catalogue, product and order endpoint takes one. It
 * is resolved once from the public supermarket listing rather than hardcoded,
 * because the id differs between the seeded local database, staging and
 * production — a literal UUID in the source tree would be wrong in at least
 * two of the three. Resolving it this way also needs no new API endpoint.
 *
 * If more than one supermarket is ever approved, the first is used. That is a
 * deliberate, documented simplification for a single-partner launch, not an
 * assumption the API enforces.
 */
export function resolveMarketStore(): Promise<MarketStore | null> {
  if (!pending) {
    // Resolve the single launch store even when it is closed, so the home can show a clear "closed"
    // state instead of mistaking a closed store for an unreachable one.
    pending = listSupermarkets(1, 1, true)
      .then((page) => {
        const store = page.items[0];
        return store ? { id: store.id, name: store.name, isOpenNow: store.isOpenNow } : null;
      })
      .catch(() => {
        // A failed lookup must not be cached, or a single offline moment at
        // launch would leave the catalogue permanently unreachable for the
        // rest of the session.
        pending = null;
        return null;
      });
  }
  return pending;
}

/** Drops the cached store so the next resolve hits the API again. */
export function forgetMarketStore(): void {
  pending = null;
}

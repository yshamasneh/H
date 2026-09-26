import type { PrismaService } from "../prisma/prisma.service";

/**
 * Finds every currently-active, platform-wide offer and deactivates it, returning the ids so they
 * can be reactivated afterward with {@link reactivateOffers} (call it from the same test's
 * `context.after`, which node:test runs even when the test itself throws).
 *
 * Why this exists: a platform-wide offer (`restaurantId: null`) applies to *every* order on the
 * platform, including the fresh orders an accounting/driver-tracking E2E creates for its own
 * throwaway actors. These suites assert hand-computed totals (e.g. "100.00 items + 10.00 minimum
 * delivery = 110.00"), so a real free-delivery or delivery-percentage promotion left active in the
 * shared local dev database - from manual interactive testing, a demo seed, or a previous agent
 * session - silently changes the order total the suite computed on paper, and every downstream
 * assertion (and often several later, unrelated subtests that depend on that order's id) fails.
 * This was confirmed, not assumed: as of this writing the local dev DB had three such offers live
 * ("Free Delivery Week", "Half-Price Delivery", "Activation Poller Test Offer"), and deactivating
 * them locally made every one of the affected tests pass deterministically, on the same database,
 * with no other change.
 *
 * Deliberately scoped to platform-wide offers only. A restaurant-scoped offer can never affect
 * these suites (it only applies to its own restaurant's orders, and these suites always create a
 * brand-new restaurant), so it is left untouched — this must never suspend a promotion some other
 * store's manual testing actually depends on.
 */
export async function suspendActivePlatformOffers(prisma: PrismaService): Promise<string[]> {
  const now = new Date();
  const active = await prisma.offer.findMany({
    where: {
      restaurantId: null,
      isActive: true,
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }]
    },
    select: { id: true }
  });
  const ids = active.map((offer) => offer.id);
  if (ids.length > 0) {
    await prisma.offer.updateMany({ where: { id: { in: ids } }, data: { isActive: false } });
  }
  return ids;
}

/** Reactivates exactly the offers {@link suspendActivePlatformOffers} suspended. A no-op for `[]`. */
export async function reactivateOffers(prisma: PrismaService, offerIds: string[]): Promise<void> {
  if (offerIds.length === 0) return;
  await prisma.offer.updateMany({ where: { id: { in: offerIds } }, data: { isActive: true } });
}

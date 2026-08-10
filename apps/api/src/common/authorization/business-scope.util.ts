import type { Prisma } from "../../generated/prisma/client";
import { ApiException } from "../api.exception";

type MembershipClient = Pick<Prisma.TransactionClient, "businessMember">;

/**
 * Resolves which business a `/me` route acts on, from the caller's active memberships.
 *
 * This replaces looking the business up by `Restaurant.ownerUserId`, which could only ever find
 * the single legal owner and therefore made staff accounts unusable. `ownerUserId` remains the
 * owner of record; membership is what grants access.
 *
 * A caller with several active memberships is refused rather than resolved to an arbitrary one —
 * silently picking a business would be the sort of ambiguity that leaks data between tenants.
 */
export async function resolveMemberBusinessId(client: MembershipClient, userId: string): Promise<string> {
  const memberships = await client.businessMember.findMany({
    where: { userId, isActive: true },
    select: { businessId: true }
  });

  if (memberships.length === 1) return memberships[0].businessId;
  if (memberships.length === 0) {
    throw new ApiException(404, "RESTAURANT_NOT_FOUND", "No restaurant is linked to this account.");
  }
  throw new ApiException(
    409,
    "BUSINESS_CONTEXT_REQUIRED",
    "This account belongs to more than one business. Choose which business to act on.",
    { businessIds: memberships.map((membership) => membership.businessId) }
  );
}

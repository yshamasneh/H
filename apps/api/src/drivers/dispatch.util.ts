import { DriverApprovalStatus, type Prisma } from "../generated/prisma/client";
import { activeDeliveryStatuses } from "./delivery.rules";

/**
 * The drivers who can take a delivery that has just become available: approved, on shift (online),
 * with the app running (a valid presence lease), a live account, and not already committed to a job. A driver on an active delivery is left
 * out because acceptDelivery would refuse them (one delivery at a time), so alerting them would
 * ring the phone of someone who cannot act on it.
 *
 * "On shift" is the server-side online flag, but it is not enough by itself: it survives the app
 * being closed, and alerting a phone whose app is closed is exactly what this must not do. The
 * presence lease is what says the app is running.
 */
export async function findDispatchableDriverIds(
  tx: Prisma.TransactionClient,
  now: Date = new Date()
): Promise<string[]> {
  const online = await tx.driverProfile.findMany({
    where: {
      status: DriverApprovalStatus.APPROVED,
      isOnline: true,
      // The app must be running. A stale online flag on a phone whose app was closed has no lease,
      // so it is not alerted at all (see presence.rules.ts).
      appLeaseUntil: { gt: now },
      user: { isActive: true }
    },
    select: { userId: true }
  });
  if (online.length === 0) return [];
  const ids = online.map((profile) => profile.userId);
  const busy = await tx.delivery.findMany({
    where: { driverId: { in: ids }, status: { in: activeDeliveryStatuses } },
    select: { driverId: true }
  });
  const busyIds = new Set(busy.map((delivery) => delivery.driverId));
  return ids.filter((id) => !busyIds.has(id));
}

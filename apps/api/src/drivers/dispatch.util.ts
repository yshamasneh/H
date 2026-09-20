import { DriverApprovalStatus, type Prisma } from "../generated/prisma/client";
import { activeDeliveryStatuses } from "./delivery.rules";

/**
 * The drivers who can take a delivery that has just become available: approved, on shift (online),
 * with a live account, and not already committed to a job. A driver on an active delivery is left
 * out because acceptDelivery would refuse them (one delivery at a time), so alerting them would
 * ring the phone of someone who cannot act on it.
 *
 * "On shift" is the server-side online flag. It survives the app being closed, which is what lets a
 * driver be alerted without reopening the app; it is cleared only by the driver, an admin action,
 * or a suspension.
 */
export async function findDispatchableDriverIds(tx: Prisma.TransactionClient): Promise<string[]> {
  const online = await tx.driverProfile.findMany({
    where: { status: DriverApprovalStatus.APPROVED, isOnline: true, user: { isActive: true } },
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

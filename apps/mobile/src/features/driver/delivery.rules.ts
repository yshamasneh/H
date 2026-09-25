import { deliveryFailureReasons, type DeliveryStatusValue, type DriverDeliveryStatusAction } from "../../core/api";

export const activeDeliveryStatuses: DeliveryStatusValue[] = ["ASSIGNED", "PICKED_UP", "ON_THE_WAY"];

/**
 * A delivery the driver is committed to can also end in failure, not only in success. Without a way
 * to report that, a driver holding an undeliverable job stays blocked forever: acceptDelivery
 * refuses a second job while one is active (DELIVERY_DRIVER_HAS_ACTIVE), so the driver can never
 * take any further work. The reasons mirror the API's own list; the API requires one.
 */
export const failableDeliveryStatuses: DeliveryStatusValue[] = ["ASSIGNED", "PICKED_UP", "ON_THE_WAY"];

export const driverFailureReasons = deliveryFailureReasons;

export function canReportFailure(status: DeliveryStatusValue): boolean {
  return failableDeliveryStatuses.includes(status);
}

export const nextDriverActionByStatus: Partial<
  Record<DeliveryStatusValue, { action: DriverDeliveryStatusAction; labelKey: string }>
> = {
  ASSIGNED: { action: "PICKED_UP", labelKey: "home.markPickedUp" },
  PICKED_UP: { action: "ON_THE_WAY", labelKey: "home.startDelivery" },
  ON_THE_WAY: { action: "DELIVERED", labelKey: "home.markDelivered" }
};

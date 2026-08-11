import type { DeliveryStatusValue, DriverDeliveryStatusAction } from "../../core/api";

export const activeDeliveryStatuses: DeliveryStatusValue[] = ["ASSIGNED", "PICKED_UP", "ON_THE_WAY"];

export const nextDriverActionByStatus: Partial<
  Record<DeliveryStatusValue, { action: DriverDeliveryStatusAction; labelKey: string }>
> = {
  ASSIGNED: { action: "PICKED_UP", labelKey: "home.markPickedUp" },
  PICKED_UP: { action: "ON_THE_WAY", labelKey: "home.startDelivery" },
  ON_THE_WAY: { action: "DELIVERED", labelKey: "home.markDelivered" }
};

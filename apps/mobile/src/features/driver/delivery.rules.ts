import type { DeliveryStatusValue, DriverDeliveryStatusAction } from "../../core/api";

export const activeDeliveryStatuses: DeliveryStatusValue[] = ["ASSIGNED", "PICKED_UP", "ON_THE_WAY"];

export const nextDriverActionByStatus: Partial<
  Record<DeliveryStatusValue, { action: DriverDeliveryStatusAction; label: string }>
> = {
  ASSIGNED: { action: "PICKED_UP", label: "Mark Picked Up" },
  PICKED_UP: { action: "ON_THE_WAY", label: "Start Delivery" },
  ON_THE_WAY: { action: "DELIVERED", label: "Mark Delivered" }
};

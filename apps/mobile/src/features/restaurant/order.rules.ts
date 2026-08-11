import type { OrderStatusValue, RestaurantOrderStatusAction } from "../../core/api";

export const nextRestaurantActionsByStatus: Record<
  OrderStatusValue,
  { action: RestaurantOrderStatusAction; labelKey: string }[]
> = {
  PLACED: [
    { action: "ACCEPTED", labelKey: "orders.acceptOrder" },
    { action: "REJECTED", labelKey: "orders.rejectOrder" }
  ],
  ACCEPTED: [{ action: "PREPARING", labelKey: "orders.startPreparing" }],
  PREPARING: [{ action: "READY_FOR_PICKUP", labelKey: "orders.markReadyForPickup" }],
  READY_FOR_PICKUP: [],
  DELIVERED: [],
  REJECTED: [],
  CANCELLED: []
};

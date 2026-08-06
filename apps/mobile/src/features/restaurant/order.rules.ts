import type { OrderStatusValue, RestaurantOrderStatusAction } from "../../core/api";

export const nextRestaurantActionsByStatus: Record<
  OrderStatusValue,
  { action: RestaurantOrderStatusAction; label: string }[]
> = {
  PLACED: [
    { action: "ACCEPTED", label: "Accept Order" },
    { action: "REJECTED", label: "Reject Order" }
  ],
  ACCEPTED: [{ action: "PREPARING", label: "Start Preparing" }],
  PREPARING: [{ action: "READY_FOR_PICKUP", label: "Mark Ready for Pickup" }],
  READY_FOR_PICKUP: [],
  DELIVERED: [],
  REJECTED: [],
  CANCELLED: []
};

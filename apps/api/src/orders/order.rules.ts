import { OrderStatus } from "../generated/prisma/client";
import type { RestaurantOrderStatusAction } from "./orders.dto";

export const cancellableByAdminStatuses: OrderStatus[] = [
  OrderStatus.PLACED,
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP
];

export const restaurantStatusTransitions: Record<RestaurantOrderStatusAction, OrderStatus> = {
  ACCEPTED: OrderStatus.ACCEPTED,
  PREPARING: OrderStatus.PREPARING,
  READY_FOR_PICKUP: OrderStatus.READY_FOR_PICKUP,
  REJECTED: OrderStatus.REJECTED
};

export const allowedOrderTransitions: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PLACED]: [OrderStatus.ACCEPTED, OrderStatus.REJECTED, OrderStatus.CANCELLED],
  [OrderStatus.ACCEPTED]: [OrderStatus.PREPARING],
  [OrderStatus.PREPARING]: [OrderStatus.READY_FOR_PICKUP],
  // DELIVERY_FAILED is reached only by the driver reporting a failure, never by a business action.
  [OrderStatus.READY_FOR_PICKUP]: [OrderStatus.DELIVERED, OrderStatus.DELIVERY_FAILED],
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.REJECTED]: [],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.DELIVERY_FAILED]: []
};

import type { DeliveryStatus, OrderPaymentMethod, OrderStatus } from "../generated/prisma/enums";

export type OrderItemView = {
  id: string;
  menuItemId: string;
  nameSnapshot: string;
  priceMinorSnapshot: number;
  quantity: number;
  lineTotalMinor: number;
};

export type OrderRestaurantSummary = {
  id: string;
  name: string;
};

export type OrderStatusHistoryEntry = {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  changedByUserId: string;
  note: string | null;
  createdAt: Date;
};

export type DeliveryStatusSummary = {
  id: string;
  status: DeliveryStatus;
  assignedAt: Date | null;
  pickedUpAt: Date | null;
  onTheWayAt: Date | null;
  deliveredAt: Date | null;
};

export type OrderDetailView = {
  id: string;
  status: OrderStatus;
  paymentMethod: OrderPaymentMethod;
  restaurant: OrderRestaurantSummary;
  deliveryLabel: string;
  deliveryAddressLine: string;
  deliveryLatitude: number | null;
  deliveryLongitude: number | null;
  items: OrderItemView[];
  subtotalMinor: number;
  deliveryFeeMinor: number;
  serviceFeeMinor: number;
  discountMinor: number;
  totalMinor: number;
  createdAt: Date;
  statusHistory: OrderStatusHistoryEntry[];
  delivery: DeliveryStatusSummary | null;
};

export type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

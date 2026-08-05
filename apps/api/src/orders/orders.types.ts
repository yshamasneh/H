import type { OrderPaymentMethod, OrderStatus } from "../generated/prisma/enums";

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
};

export type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

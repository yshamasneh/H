import type { DeliveryStatus, DriverApprovalStatus, OrderPaymentMethod } from "../generated/prisma/enums";

export type DriverProfileView = {
  userId: string;
  status: DriverApprovalStatus;
  isOnline: boolean;
  lastLatitude: number | null;
  lastLongitude: number | null;
};

export type AdminDriverView = {
  userId: string;
  fullName: string;
  phone: string;
  isActive: boolean;
  status: DriverApprovalStatus;
  isOnline: boolean;
  completedDeliveriesCount: number;
  activeDeliveryId: string | null;
  createdAt: Date;
};

export type DriverStatsView = {
  /** Deliveries the driver completed (DELIVERED). */
  completedCount: number;
  /** Deliveries currently in progress (assigned, picked up, or on the way). */
  activeCount: number;
  /** Total earned so far: completedCount × the flat per-delivery payout, in minor units. */
  earningsMinor: number;
  /** The flat payout per completed delivery, in minor units, so the client can show the rate. */
  perDeliveryMinor: number;
};

export type DeliveryOrderSummary = {
  id: string;
  deliveryLabel: string;
  deliveryAddressLine: string;
  totalMinor: number;
  paymentMethod: OrderPaymentMethod;
};

export type DeliveryRestaurantSummary = {
  id: string;
  name: string;
  addressLine: string;
};

export type DeliveryView = {
  id: string;
  status: DeliveryStatus;
  order: DeliveryOrderSummary;
  restaurant: DeliveryRestaurantSummary;
  assignedAt: Date | null;
  pickedUpAt: Date | null;
  onTheWayAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
};

export type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

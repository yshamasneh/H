import type {
  DeliveryStatus,
  FulfillmentAdjustmentStatus,
  OrderPaymentMethod,
  OrderStatus
} from "../generated/prisma/enums";
import type { AppliedPromotion } from "../offers/offers.types";

export type OrderItemView = {
  id: string;
  menuItemId: string;
  nameSnapshot: string;
  priceMinorSnapshot: number;
  quantity: number;
  unitLabelSnapshot: string;
  allowSubstitution: boolean;
  isVariableWeightSnapshot: boolean;
  lineTotalMinor: number;
  fulfillmentAdjustment: {
    id: string;
    replacementMenuItemId: string | null;
    replacementNameSnapshot: string | null;
    replacementUnitLabelSnapshot: string | null;
    actualQuantityMilli: number;
    unitPriceMinor: number;
    lineTotalMinor: number;
    status: FulfillmentAdjustmentStatus;
    note: string | null;
    decidedAt: Date | null;
    updatedAt: Date;
  } | null;
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
  deliveryDistanceMeters: number | null;
  customerNote: string | null;
  appliedPromotions: AppliedPromotion[];
  items: OrderItemView[];
  subtotalMinor: number;
  deliveryFeeMinor: number;
  serviceFeeMinor: number;
  discountMinor: number;
  totalMinor: number;
  acceptedByUserId: string | null;
  acceptedAt: Date | null;
  /**
   * Only populated for business and admin views. Customer-facing responses omit it so a staff
   * member's name is never exposed to the person who placed the order.
   */
  acceptedByFullName?: string | null;
  createdAt: Date;
  statusHistory: OrderStatusHistoryEntry[];
  delivery: DeliveryStatusSummary | null;
  requiresCustomerReview: boolean;
};

export type OrderQuoteView = {
  subtotalMinor: number;
  deliveryDistanceMeters: number;
  deliveryFeeMinor: number;
  serviceFeeMinor: number;
  discountMinor: number;
  totalMinor: number;
  appliedPromotions: AppliedPromotion[];
};

export type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

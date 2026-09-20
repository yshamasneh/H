import type {
  DeliveryStatus,
  DriverApprovalStatus,
  OrderFinancialOutcome,
  OrderPaymentMethod
} from "../generated/prisma/enums";

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

/** One driver's last reported position, for the admin live map. */
export type AdminDriverLocationView = {
  userId: string;
  fullName: string;
  phone: string;
  status: DriverApprovalStatus;
  isOnline: boolean;
  latitude: number | null;
  longitude: number | null;
  /** When the phone last reported. Null until the driver's first fix. */
  lastLocationAt: Date | null;
  activeDelivery: {
    deliveryId: string;
    orderId: string;
    status: DeliveryStatus;
    restaurantName: string;
  } | null;
};

/** Where the driver on one order is, with the two ends of the trip for context. */
export type AdminOrderTrackingView = {
  orderId: string;
  deliveryId: string | null;
  deliveryStatus: DeliveryStatus | null;
  driver: AdminDriverLocationView | null;
  pickup: { name: string; latitude: number | null; longitude: number | null } | null;
  destination: { label: string; latitude: number | null; longitude: number | null };
};

export type DriverStatsView = {
  /** Deliveries the driver completed (DELIVERED). */
  completedCount: number;
  /** Deliveries currently in progress (assigned, picked up, or on the way). */
  activeCount: number;
  /** Total earned so far, summed from the driver's own ledger rows. */
  earningsMinor: number;
  /** Of that, how much has actually been paid out. */
  earningsPaidMinor: number;
  /** What the platform still owes the driver: earned minus paid. */
  earningsOutstandingMinor: number;
  /** Customers' cash the driver is currently holding and has not yet handed over. Deliberately
   *  never netted against earnings: owing the platform cash and being owed pay are two facts. */
  cashOutstandingMinor: number;
  /** Average payout per completed delivery, in minor units (earningsMinor / completedCount, since
   *  the payout scales with each delivery's actual fee and is no longer a flat rate). */
  perDeliveryMinor: number;
};

export const driverCashPeriods = ["SHIFT", "TODAY", "WEEK", "MONTH", "ALL"] as const;
/** SHIFT is "since the last cash handover"; the rest are calendar periods on the server's clock. */
export type DriverCashPeriod = (typeof driverCashPeriods)[number];

export type DriverCashLineView = {
  orderId: string;
  restaurantName: string | null;
  deliveryLabel: string | null;
  outcome: OrderFinancialOutcome | null;
  occurredAt: Date;
  cashCollectedMinor: number;
  cashHandedOverMinor: number;
  cashOwedToPlatformMinor: number;
  earningMinor: number;
};

/**
 * The driver's money, as three separate facts. Every figure is read from the accounting ledger and
 * none is derived by netting one against another.
 *
 * The platform settles cash GROSS: the driver hands over everything collected and is paid their
 * delivery share as a separate event. So `cashOwedToPlatformMinor` is NOT reduced by earnings.
 */
export type DriverCashSummaryView = {
  period: DriverCashPeriod;
  /** Start of the period, or null when it reaches back to the first order. */
  from: Date | null;
  to: Date;
  lastHandoverAt: Date | null;
  /** What was collected from customers in the period, including anything already handed over. */
  cashCollectedMinor: number;
  /** Of that, how much has already been handed back to the platform. */
  cashHandedOverMinor: number;
  /** The driver's delivery-fee share earned on orders in the period. */
  earningsMinor: number;
  deliveredCount: number;
  failedCount: number;
  /**
   * Standing balance, independent of the chosen period, so a narrow period can never hide cash
   * that is still owed.
   */
  balance: {
    /** Cash still to hand over at the next settlement, across every unsettled order. */
    cashOwedToPlatformMinor: number;
    unsettledOrderCount: number;
    oldestUnsettledAt: Date | null;
    /** Part of the amount above that comes from before the chosen period began. */
    cashOwedFromBeforePeriodMinor: number;
    /** Delivery-fee share earned to date and not yet paid to the driver. */
    earningsOwedToDriverMinor: number;
  };
  lines: DriverCashLineView[];
  linesTruncated: boolean;
};

export type DeliveryOrderSummary = {
  id: string;
  deliveryLabel: string;
  deliveryAddressLine: string;
  totalMinor: number;
  paymentMethod: OrderPaymentMethod;
  // The customer's delivery destination, captured at checkout. Optional because
  // orders placed before delivery coordinates were recorded may lack them.
  latitude: number | null;
  longitude: number | null;
};

export type DeliveryRestaurantSummary = {
  id: string;
  name: string;
  addressLine: string;
  // The pickup store's location. Optional because a store may not have set coordinates.
  latitude: number | null;
  longitude: number | null;
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

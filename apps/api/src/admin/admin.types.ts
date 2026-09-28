import type { OrderStatus, UserRole } from "../generated/prisma/enums";

export type DashboardActivityEntry = {
  id: string;
  orderId: string;
  restaurantName: string;
  toStatus: OrderStatus;
  createdAt: Date;
};

export type DashboardOverview = {
  ordersToday: number;
  revenueTodayMinor: number;
  activeDeliveries: number;
  pendingRestaurantApprovals: number;
  onlineDriversCount: number;
  newCustomerSignupsToday: number;
  /** Driver applications waiting for a decision. */
  pendingDriverApprovals: number;
  /** Orders placed and not yet accepted by their store, whenever they were placed. */
  ordersAwaitingAcceptance: number;
  /**
   * All-time counts straight from the tables. The "today" figures above read as zero on a quiet
   * day even when the platform holds a great deal of data, which looks like the dashboard is not
   * connected to it; these make it obvious what is actually in the database.
   */
  totals: DashboardTotals;
  activityFeed: DashboardActivityEntry[];
};

export type DashboardTotals = {
  businesses: number;
  approvedBusinesses: number;
  suspendedBusinesses: number;
  products: number;
  hiddenProducts: number;
  customers: number;
  orders: number;
  approvedDrivers: number;
};

export type AdminUserView = {
  id: string;
  fullName: string;
  phone: string;
  role: UserRole;
  isActive: boolean;
  phoneVerifiedAt: Date | null;
  createdAt: Date;
};

export type CustomerOrderSummary = {
  id: string;
  status: OrderStatus;
  /** The order's exact total in agorot: the one "amount" this view uses. */
  totalMinor: number;
  createdAt: Date;
  storeName: string;
  itemsCount: number;
};

export type CustomerDetailView = {
  customer: AdminUserView;
  /** DELIVERED orders only. */
  deliveredOrdersCount: number;
  /** Sum of `totalMinor` over DELIVERED orders since the account was created, in agorot. */
  deliveredSpentMinor: number;
  /** Every order in any status. */
  ordersCount: number;
  firstOrderAt: Date | null;
  /** Newest first, from today back to the first order. */
  orders: CustomerOrderSummary[];
};

export type AuditLogEntryView = {
  id: string;
  actorUserId: string;
  actorFullName: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  metadataJson: unknown;
  createdAt: Date;
};

export type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

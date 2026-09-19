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

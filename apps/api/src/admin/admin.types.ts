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
  activityFeed: DashboardActivityEntry[];
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

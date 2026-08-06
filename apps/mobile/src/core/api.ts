import { Platform } from "react-native";
import type { CountryCode } from "./phone";

export type UserRole = "CUSTOMER" | "RESTAURANT" | "DRIVER" | "ADMIN";

export type PublicUser = {
  id: string;
  fullName: string;
  phone: string;
  role: UserRole;
};

export type AuthResult = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  refreshExpiresInSeconds: number;
  user: PublicUser;
};

export type OtpRequestResult = {
  phone: string;
  expiresInSeconds: number;
  resendAvailableInSeconds: number;
  message: string;
};

export type SignupInput = {
  fullName: string;
  countryCode: CountryCode;
  phoneNumber: string;
  password: string;
  confirmPassword: string;
};

export type PhoneInput = {
  countryCode: CountryCode;
  phoneNumber: string;
};

export type VerifyOtpInput = PhoneInput & { code: string };

export type RestaurantSummary = {
  id: string;
  name: string;
  description: string | null;
  phone: string;
  addressLine: string;
  logoUrl: string | null;
  isOpen: boolean;
};

export type MenuItemSummary = {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number;
  imageUrl: string | null;
};

export type MenuCategorySummary = {
  id: string;
  name: string;
  sortOrder: number;
  items: MenuItemSummary[];
};

export type RestaurantMenu = {
  restaurant: RestaurantSummary;
  categories: MenuCategorySummary[];
};

export type RestaurantOffer = {
  id: string;
  title: string;
  description: string | null;
  discountPercent: number | null;
  imageUrl: string | null;
  startsAt: string;
  endsAt: string | null;
  restaurant: Pick<RestaurantSummary, "id" | "name" | "logoUrl">;
};

export type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

export const orderPaymentMethods = ["CASH"] as const;
export type OrderPaymentMethod = (typeof orderPaymentMethods)[number];
export type OrderStatusValue =
  | "PLACED"
  | "ACCEPTED"
  | "PREPARING"
  | "READY_FOR_PICKUP"
  | "DELIVERED"
  | "REJECTED"
  | "CANCELLED";

export const restaurantOrderStatusActions = ["ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "REJECTED"] as const;
export type RestaurantOrderStatusAction = (typeof restaurantOrderStatusActions)[number];

export type DeliveryStatusValue = "PENDING_ASSIGNMENT" | "ASSIGNED" | "PICKED_UP" | "ON_THE_WAY" | "DELIVERED" | "CANCELLED";

export const driverDeliveryStatusActions = ["PICKED_UP", "ON_THE_WAY", "DELIVERED"] as const;
export type DriverDeliveryStatusAction = (typeof driverDeliveryStatusActions)[number];

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
  fromStatus: OrderStatusValue | null;
  toStatus: OrderStatusValue;
  changedByUserId: string;
  note: string | null;
  createdAt: string;
};

export type DeliveryStatusSummary = {
  id: string;
  status: DeliveryStatusValue;
  assignedAt: string | null;
  pickedUpAt: string | null;
  onTheWayAt: string | null;
  deliveredAt: string | null;
};

export type OrderDetail = {
  id: string;
  status: OrderStatusValue;
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
  createdAt: string;
  statusHistory: OrderStatusHistoryEntry[];
  delivery: DeliveryStatusSummary | null;
};

export type DriverProfileView = {
  userId: string;
  isOnline: boolean;
  lastLatitude: number | null;
  lastLongitude: number | null;
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
  status: DeliveryStatusValue;
  order: DeliveryOrderSummary;
  restaurant: DeliveryRestaurantSummary;
  assignedAt: string | null;
  pickedUpAt: string | null;
  onTheWayAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
};

export type CreateOrderItemInput = {
  menuItemId: string;
  quantity: number;
};

export type CreateOrderInput = {
  restaurantId: string;
  items: CreateOrderItemInput[];
  deliveryLabel: string;
  deliveryAddressLine: string;
  deliveryLatitude?: number;
  deliveryLongitude?: number;
  paymentMethod: OrderPaymentMethod;
};

type ApiErrorPayload = {
  statusCode?: number;
  code?: string;
  message?: string;
  details?: unknown;
  requestId?: string;
};

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details: unknown = null
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const configuredApiUrl = process.env?.EXPO_PUBLIC_API_URL?.replace(/\/$/, "");
const developmentApiUrl =
  Platform.select({
    android: "http://10.0.2.2:3000",
    ios: "http://localhost:3000",
    default: "http://localhost:3000"
  }) || "http://localhost:3000";

if (!__DEV__ && (!configuredApiUrl || !configuredApiUrl.startsWith("https://"))) {
  throw new Error("Production builds require an HTTPS EXPO_PUBLIC_API_URL.");
}

export const apiBaseUrl = configuredApiUrl || developmentApiUrl;

export function requestSignupCode(input: SignupInput): Promise<OtpRequestResult> {
  return request("/api/v1/auth/customer/signup/request-code", { method: "POST", body: input });
}

export function verifySignupCode(input: VerifyOtpInput): Promise<AuthResult> {
  return request("/api/v1/auth/customer/signup/verify-code", { method: "POST", body: input });
}

export function login(input: PhoneInput & { password: string }): Promise<AuthResult> {
  return request("/api/v1/auth/login", { method: "POST", body: input });
}

export function refreshSession(refreshToken: string): Promise<AuthResult> {
  return request("/api/v1/auth/refresh", { method: "POST", body: { refreshToken } });
}

export function logout(accessToken: string): Promise<{ message: string }> {
  return request("/api/v1/auth/logout", { method: "POST", accessToken });
}

export async function fetchCurrentUser(accessToken: string): Promise<PublicUser> {
  const response = await request<{ user: PublicUser }>("/api/v1/auth/me", { accessToken });
  return response.user;
}

export function requestPasswordResetCode(input: PhoneInput): Promise<OtpRequestResult> {
  return request("/api/v1/auth/password/forgot/request-code", { method: "POST", body: input });
}

export function verifyPasswordResetCode(
  input: VerifyOtpInput
): Promise<{ resetToken: string; expiresInSeconds: number }> {
  return request("/api/v1/auth/password/forgot/verify-code", { method: "POST", body: input });
}

export function resetPassword(input: {
  resetToken: string;
  password: string;
  confirmPassword: string;
}): Promise<{ message: string }> {
  return request("/api/v1/auth/password/reset", { method: "POST", body: input });
}

export function listRestaurants(page = 1, pageSize = 20): Promise<Page<RestaurantSummary>> {
  return request(`/api/v1/restaurants?page=${page}&pageSize=${pageSize}`);
}

export function getRestaurantMenu(restaurantId: string): Promise<RestaurantMenu> {
  return request(`/api/v1/restaurants/${restaurantId}/menu`);
}

export function listActiveRestaurantOffers(): Promise<RestaurantOffer[]> {
  return request("/api/v1/restaurants/offers/active");
}

export function createOrder(accessToken: string, input: CreateOrderInput): Promise<OrderDetail> {
  return request("/api/v1/orders", { method: "POST", body: input, accessToken });
}

export function listMyOrders(accessToken: string, page = 1, pageSize = 20): Promise<Page<OrderDetail>> {
  return request(`/api/v1/orders/me?page=${page}&pageSize=${pageSize}`, { accessToken });
}

export function getMyOrder(accessToken: string, orderId: string): Promise<OrderDetail> {
  return request(`/api/v1/orders/${orderId}`, { accessToken });
}

export function listRestaurantOrders(accessToken: string, page = 1, pageSize = 20): Promise<Page<OrderDetail>> {
  return request(`/api/v1/restaurant/me/orders?page=${page}&pageSize=${pageSize}`, { accessToken });
}

export function getRestaurantOrder(accessToken: string, orderId: string): Promise<OrderDetail> {
  return request(`/api/v1/restaurant/me/orders/${orderId}`, { accessToken });
}

export function updateOrderStatus(
  accessToken: string,
  orderId: string,
  status: RestaurantOrderStatusAction,
  note?: string
): Promise<OrderDetail> {
  return request(`/api/v1/restaurant/me/orders/${orderId}/status`, {
    method: "PATCH",
    body: { status, note },
    accessToken
  });
}

export function setDriverOnlineStatus(accessToken: string, isOnline: boolean): Promise<DriverProfileView> {
  return request("/api/v1/driver/me/status", { method: "PATCH", body: { isOnline }, accessToken });
}

export function listAvailableDeliveries(accessToken: string): Promise<DeliveryView[]> {
  return request("/api/v1/driver/me/deliveries/available", { accessToken });
}

export function listMyDeliveries(accessToken: string, page = 1, pageSize = 20): Promise<Page<DeliveryView>> {
  return request(`/api/v1/driver/me/deliveries?page=${page}&pageSize=${pageSize}`, { accessToken });
}

export function acceptDelivery(accessToken: string, deliveryId: string): Promise<DeliveryView> {
  return request(`/api/v1/driver/me/deliveries/${deliveryId}/accept`, { method: "POST", accessToken });
}

export function updateDeliveryStatus(
  accessToken: string,
  deliveryId: string,
  status: DriverDeliveryStatusAction
): Promise<DeliveryView> {
  return request(`/api/v1/driver/me/deliveries/${deliveryId}/status`, {
    method: "PATCH",
    body: { status },
    accessToken
  });
}

export type NotificationType =
  | "ORDER_PLACED"
  | "ORDER_STATUS_CHANGED"
  | "DELIVERY_ASSIGNED"
  | "DELIVERY_STATUS_CHANGED"
  | "RESTAURANT_APPROVED"
  | "RESTAURANT_REJECTED"
  | "RESTAURANT_SUSPENDED"
  | "DRIVER_APPROVED"
  | "DRIVER_REJECTED"
  | "DRIVER_SUSPENDED"
  | "ADMIN_ALERT";

export type NotificationView = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  relatedEntityId: string | null;
  isRead: boolean;
  createdAt: string;
};

export type NotificationsPage = Page<NotificationView> & { unreadCount: number };

export type RestaurantStatusValue = "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";

export type AdminRestaurant = RestaurantSummary & {
  status: RestaurantStatusValue;
  createdAt: string;
};

export type AdminRestaurantDetail = AdminRestaurant & {
  ownerFullName: string;
  ownerPhone: string;
  totalOrdersCount: number;
  revenueMinor: number;
};

export type DriverApprovalStatusValue = "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";

export type AdminDriver = {
  userId: string;
  fullName: string;
  phone: string;
  isActive: boolean;
  status: DriverApprovalStatusValue;
  isOnline: boolean;
  completedDeliveriesCount: number;
  activeDeliveryId: string | null;
  createdAt: string;
};

export type AdminUser = {
  id: string;
  fullName: string;
  phone: string;
  role: UserRole;
  isActive: boolean;
  phoneVerifiedAt: string | null;
  createdAt: string;
};

export type AdminDashboardActivity = {
  id: string;
  orderId: string;
  restaurantName: string;
  toStatus: OrderStatusValue;
  createdAt: string;
};

export type AdminDashboard = {
  ordersToday: number;
  revenueTodayMinor: number;
  activeDeliveries: number;
  pendingRestaurantApprovals: number;
  onlineDriversCount: number;
  newCustomerSignupsToday: number;
  activityFeed: AdminDashboardActivity[];
};

export type AdminAuditLogEntry = {
  id: string;
  actorUserId: string;
  actorFullName: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  metadataJson: unknown;
  createdAt: string;
};

export function listMyNotifications(accessToken: string, page = 1, pageSize = 20): Promise<NotificationsPage> {
  return request(`/api/v1/notifications/me?page=${page}&pageSize=${pageSize}`, { accessToken });
}

export function markNotificationRead(accessToken: string, notificationId: string): Promise<NotificationView> {
  return request(`/api/v1/notifications/${notificationId}/read`, { method: "PATCH", accessToken });
}

export function cancelMyOrder(accessToken: string, orderId: string): Promise<OrderDetail> {
  return request(`/api/v1/orders/${orderId}/cancel`, { method: "POST", accessToken });
}

export function getAdminDashboard(accessToken: string): Promise<AdminDashboard> {
  return request("/api/v1/admin/dashboard", { accessToken });
}

export function listAdminRestaurants(
  accessToken: string,
  params: { status?: RestaurantStatusValue; isOpen?: boolean } = {}
): Promise<Page<AdminRestaurant>> {
  return request(`/api/v1/admin/restaurants${toQuery(params)}`, { accessToken });
}

export function getAdminRestaurant(accessToken: string, restaurantId: string): Promise<AdminRestaurantDetail> {
  return request(`/api/v1/admin/restaurants/${restaurantId}`, { accessToken });
}

export function approveAdminRestaurant(accessToken: string, restaurantId: string): Promise<AdminRestaurant> {
  return request(`/api/v1/admin/restaurants/${restaurantId}/approve`, { method: "POST", accessToken });
}

export function rejectAdminRestaurant(accessToken: string, restaurantId: string): Promise<AdminRestaurant> {
  return request(`/api/v1/admin/restaurants/${restaurantId}/reject`, { method: "POST", accessToken });
}

export function suspendAdminRestaurant(
  accessToken: string,
  restaurantId: string,
  reason: string
): Promise<AdminRestaurant> {
  return request(`/api/v1/admin/restaurants/${restaurantId}/suspend`, {
    method: "POST",
    body: { reason },
    accessToken
  });
}

export function reactivateAdminRestaurant(accessToken: string, restaurantId: string): Promise<AdminRestaurant> {
  return request(`/api/v1/admin/restaurants/${restaurantId}/reactivate`, { method: "POST", accessToken });
}

export function listAdminOrders(
  accessToken: string,
  params: { status?: OrderStatusValue; restaurantId?: string; customerId?: string; page?: number } = {}
): Promise<Page<OrderDetail>> {
  return request(`/api/v1/admin/orders${toQuery(params)}`, { accessToken });
}

export function getAdminOrder(accessToken: string, orderId: string): Promise<OrderDetail> {
  return request(`/api/v1/admin/orders/${orderId}`, { accessToken });
}

export function cancelAdminOrder(accessToken: string, orderId: string, reason: string): Promise<OrderDetail> {
  return request(`/api/v1/admin/orders/${orderId}/cancel`, {
    method: "POST",
    body: { reason },
    accessToken
  });
}

export function listAdminDrivers(accessToken: string): Promise<AdminDriver[]> {
  return request("/api/v1/admin/drivers", { accessToken });
}

export function approveAdminDriver(accessToken: string, userId: string): Promise<AdminDriver> {
  return request(`/api/v1/admin/drivers/${userId}/approve`, { method: "POST", accessToken });
}

export function rejectAdminDriver(accessToken: string, userId: string, reason: string): Promise<AdminDriver> {
  return request(`/api/v1/admin/drivers/${userId}/reject`, {
    method: "POST",
    body: { reason },
    accessToken
  });
}

export function suspendAdminDriver(accessToken: string, userId: string, reason: string): Promise<AdminDriver> {
  return request(`/api/v1/admin/drivers/${userId}/suspend`, {
    method: "POST",
    body: { reason },
    accessToken
  });
}

export function reactivateAdminDriver(accessToken: string, userId: string): Promise<AdminDriver> {
  return request(`/api/v1/admin/drivers/${userId}/reactivate`, { method: "POST", accessToken });
}

export function listAdminUsers(
  accessToken: string,
  params: { role?: UserRole; search?: string } = {}
): Promise<Page<AdminUser>> {
  return request(`/api/v1/admin/users${toQuery(params)}`, { accessToken });
}

export function listAdminAuditLog(
  accessToken: string,
  params: { action?: string; actorUserId?: string; page?: number } = {}
): Promise<Page<AdminAuditLogEntry>> {
  return request(`/api/v1/admin/audit-log${toQuery(params)}`, { accessToken });
}

function toQuery(params: Record<string, unknown>): string {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
  return query ? `?${query}` : "";
}

async function request<T>(
  path: string,
  options: { method?: "GET" | "POST" | "PATCH"; body?: unknown; accessToken?: string } = {}
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Cannot connect to the TasawaQ server. Please try again.");
  }

  const payload = (await response.json().catch(() => null)) as T | ApiErrorPayload | null;
  if (!response.ok) {
    const error = (payload ?? {}) as ApiErrorPayload;
    throw new ApiError(
      response.status,
      error.code ?? "API_ERROR",
      error.message ?? "The request could not be completed.",
      error.details ?? null
    );
  }
  if (!payload) {
    throw new ApiError(response.status, "INVALID_API_RESPONSE", "The server returned an invalid response.");
  }
  return payload as T;
}

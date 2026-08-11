import { Platform } from "react-native";
import i18n from "../i18n";
import type { CountryCode } from "./phone";

export type UserRole = "CUSTOMER" | "RESTAURANT" | "DRIVER" | "ADMIN";
export type BusinessType = "RESTAURANT" | "SUPERMARKET";

export type PublicUser = {
  id: string;
  fullName: string;
  phone: string;
  role: UserRole;
};

export type MyProfile = PublicUser & {
  email: string | null;
  createdAt: string;
};

export type SavedAddress = {
  id: string;
  label: string;
  addressLine: string;
  latitude: number;
  longitude: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
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

export type RestaurantRegistrationInput = PhoneInput & {
  ownerFullName: string;
  password: string;
  confirmPassword: string;
  restaurantName: string;
  addressLine: string;
  description?: string;
  businessType?: BusinessType;
};

export type DriverRegistrationInput = PhoneInput & {
  fullName: string;
  password: string;
  confirmPassword: string;
};

export type RestaurantRegistrationResult = {
  message: string;
  restaurantId: string;
  status: RestaurantStatusValue;
};

export type DriverRegistrationResult = {
  message: string;
  userId: string;
};

export type VerifyOtpInput = PhoneInput & { code: string };

export type RestaurantSummary = {
  id: string;
  name: string;
  businessType: BusinessType;
  description: string | null;
  phone: string;
  addressLine: string;
  latitude: number | null;
  longitude: number | null;
  logoUrl: string | null;
  isOpen: boolean;
};

export type MenuItemSummary = {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number;
  effectivePriceMinor: number;
  imageUrl: string | null;
  sku: string | null;
  brand: string | null;
  unitLabel: string;
  stockQuantity: number | null;
  isFeatured: boolean;
  isVariableWeight: boolean;
  barcode: string | null;
  reorderLevel: number | null;
  offer: { id: string; title: string; discountPercent: number; minimumSubtotalMinor: number } | null;
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

export const offerTypes = ["PRODUCT_PERCENTAGE", "ORDER_PERCENTAGE", "DELIVERY_PERCENTAGE", "FREE_DELIVERY"] as const;
export type OfferTypeValue = (typeof offerTypes)[number];

export type RestaurantOffer = {
  id: string;
  type: OfferTypeValue;
  restaurantId: string | null;
  restaurantName: string | null;
  restaurantBusinessType: BusinessType | null;
  menuItemId: string | null;
  menuItemName: string | null;
  title: string;
  description: string | null;
  discountPercent: number | null;
  imageUrl: string | null;
  startsAt: string;
  endsAt: string | null;
  minimumSubtotalMinor: number;
  maxDiscountMinor: number | null;
  isActive: boolean;
  createdAt: string;
};

export type AdminOfferInput = {
  type: OfferTypeValue;
  restaurantId?: string;
  menuItemId?: string;
  title: string;
  description?: string;
  discountPercent?: number;
  minimumSubtotalMinor?: number;
  maxDiscountMinor?: number;
  imageUrl?: string;
  startsAt?: string;
  endsAt?: string;
  isActive?: boolean;
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
  unitLabelSnapshot: string;
  allowSubstitution: boolean;
  isVariableWeightSnapshot: boolean;
  fulfillmentAdjustment: FulfillmentAdjustmentView | null;
};

export type FulfillmentAdjustmentView = {
  id: string;
  replacementMenuItemId: string | null;
  replacementNameSnapshot: string | null;
  replacementUnitLabelSnapshot: string | null;
  actualQuantityMilli: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  status: "PENDING" | "APPROVED" | "REJECTED";
  note: string | null;
  decidedAt: string | null;
  updatedAt: string;
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
  deliveryDistanceMeters: number | null;
  customerNote: string | null;
  appliedPromotions: { offerId: string; title: string; type: OfferTypeValue; discountMinor: number }[];
  items: OrderItemView[];
  subtotalMinor: number;
  deliveryFeeMinor: number;
  discountMinor: number;
  totalMinor: number;
  createdAt: string;
  statusHistory: OrderStatusHistoryEntry[];
  delivery: DeliveryStatusSummary | null;
  requiresCustomerReview: boolean;
};

export type OrderQuote = {
  subtotalMinor: number;
  deliveryDistanceMeters: number;
  deliveryFeeMinor: number;
  discountMinor: number;
  totalMinor: number;
  appliedPromotions: OrderDetail["appliedPromotions"];
};

export type DriverProfileView = {
  userId: string;
  status: DriverApprovalStatusValue;
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
  allowSubstitution?: boolean;
};

export type CreateOrderInput = {
  restaurantId: string;
  items: CreateOrderItemInput[];
  deliveryLabel: string;
  deliveryAddressLine: string;
  deliveryLatitude: number;
  deliveryLongitude: number;
  paymentMethod: OrderPaymentMethod;
  customerNote?: string;
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

export function getMyProfile(accessToken: string): Promise<MyProfile> {
  return request("/api/v1/users/me", { accessToken });
}

export function updateMyProfile(
  accessToken: string,
  input: { fullName?: string; email?: string | null }
): Promise<MyProfile> {
  return request("/api/v1/users/me", { method: "PATCH", body: input, accessToken });
}

export function deleteMyAccount(accessToken: string): Promise<void> {
  return request("/api/v1/users/me", { method: "DELETE", accessToken });
}

export function listMyAddresses(accessToken: string): Promise<SavedAddress[]> {
  return request("/api/v1/users/me/addresses", { accessToken });
}

export function createMyAddress(
  accessToken: string,
  input: Omit<SavedAddress, "id" | "createdAt" | "updatedAt">
): Promise<SavedAddress> {
  return request("/api/v1/users/me/addresses", { method: "POST", body: input, accessToken });
}

export function updateMyAddress(
  accessToken: string,
  addressId: string,
  input: Partial<Omit<SavedAddress, "id" | "createdAt" | "updatedAt">>
): Promise<SavedAddress> {
  return request(`/api/v1/users/me/addresses/${addressId}`, { method: "PATCH", body: input, accessToken });
}

export function deleteMyAddress(accessToken: string, addressId: string): Promise<void> {
  return request(`/api/v1/users/me/addresses/${addressId}`, { method: "DELETE", accessToken });
}

export function registerMyPushToken(
  accessToken: string,
  token: string,
  platform: "android" | "ios" | "web"
): Promise<{ registered: true }> {
  return request("/api/v1/users/me/push-tokens", { method: "POST", body: { token, platform }, accessToken });
}

export function unregisterMyPushToken(accessToken: string, token: string): Promise<void> {
  return request("/api/v1/users/me/push-tokens", { method: "DELETE", body: { token }, accessToken });
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

export function registerRestaurant(input: RestaurantRegistrationInput): Promise<RestaurantRegistrationResult> {
  return request("/api/v1/restaurants/register", { method: "POST", body: input });
}

export function registerDriver(input: DriverRegistrationInput): Promise<DriverRegistrationResult> {
  return request("/api/v1/drivers/register", { method: "POST", body: input });
}

export function listRestaurants(page = 1, pageSize = 20): Promise<Page<RestaurantSummary>> {
  return request(`/api/v1/restaurants?page=${page}&pageSize=${pageSize}`);
}

export type SupermarketDepartment = {
  id: string;
  name: string;
  sortOrder: number;
  productCount: number;
};

export type SupermarketProduct = MenuItemSummary & {
  categoryId: string;
  categoryName: string;
};

export type SupermarketCatalog = {
  supermarket: RestaurantSummary;
  departments: SupermarketDepartment[];
  products: SupermarketProduct[];
  page: number;
  pageSize: number;
  total: number;
};

export function listSupermarkets(page = 1, pageSize = 20): Promise<Page<RestaurantSummary>> {
  return request(`/api/v1/supermarkets?page=${page}&pageSize=${pageSize}`);
}

export function getSupermarketCatalog(
  supermarketId: string,
  params: { page?: number; pageSize?: number; search?: string; categoryId?: string; featured?: boolean } = {}
): Promise<SupermarketCatalog> {
  return request(`/api/v1/supermarkets/${supermarketId}/catalog${toQuery(params)}`);
}

export function getSupermarketProduct(
  supermarketId: string,
  productId: string
): Promise<SupermarketProduct> {
  return request<{ supermarket: RestaurantSummary; product: SupermarketProduct }>(
    `/api/v1/supermarkets/${supermarketId}/products/${productId}`
  ).then((result) => result.product);
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

export function getOrderQuote(accessToken: string, input: CreateOrderInput): Promise<OrderQuote> {
  return request("/api/v1/orders/quote", { method: "POST", body: input, accessToken });
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

export type RestaurantOwnerProfile = AdminRestaurant;

export type MenuCategoryOwner = {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

export type MenuItemOwner = Omit<MenuItemSummary, "effectivePriceMinor" | "offer"> & {
  categoryId: string;
  isAvailable: boolean;
};

export type InventoryItem = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  stockQuantity: number | null;
  reorderLevel: number | null;
  unitLabel: string;
  isAvailable: boolean;
  isLowStock: boolean;
};

export type InventoryPage = Page<InventoryItem> & {
  summary: {
    totalProducts: number;
    trackedProducts: number;
    lowStockProducts: number;
    outOfStockProducts: number;
  };
};

export type InventoryMovement = {
  id: string;
  menuItemId: string;
  type: "ORDER_RESERVATION" | "ORDER_RESTORE" | "FULFILLMENT_RESERVATION" | "FULFILLMENT_RELEASE" | "MANUAL_ADJUSTMENT" | "PURCHASE_RECEIPT";
  quantityDelta: number;
  stockAfter: number;
  reason: string | null;
  createdAt: string;
  menuItem: { name: string; sku: string | null };
};

export type Supplier = {
  id: string;
  name: string;
  phone: string | null;
  note: string | null;
  isActive: boolean;
};

export type PurchaseOrder = {
  id: string;
  status: "DRAFT" | "RECEIVED" | "CANCELLED";
  reference: string | null;
  note: string | null;
  totalCostMinor: number;
  receivedAt: string | null;
  createdAt: string;
  supplier: Supplier;
  items: {
    id: string;
    menuItemId: string;
    quantity: number;
    unitCostMinor: number;
    menuItem: { name: string; sku: string | null };
  }[];
};

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

export function proposeOrderItemFulfillment(
  accessToken: string,
  orderId: string,
  orderItemId: string,
  input: { replacementMenuItemId?: string; actualQuantityMilli?: number; note?: string }
): Promise<OrderDetail> {
  return request(`/api/v1/restaurant/me/orders/${orderId}/items/${orderItemId}/fulfillment`, {
    method: "POST",
    body: input,
    accessToken
  });
}

export function decideOrderFulfillment(
  accessToken: string,
  orderId: string,
  adjustmentId: string,
  decision: "approve" | "reject"
): Promise<OrderDetail> {
  return request(`/api/v1/orders/${orderId}/fulfillments/${adjustmentId}/${decision}`, {
    method: "POST",
    accessToken
  });
}

export function getRestaurantOwnerProfile(accessToken: string): Promise<RestaurantOwnerProfile> {
  return request("/api/v1/restaurant/me", { accessToken });
}

export function updateRestaurantOwnerProfile(
  accessToken: string,
  input: { name?: string; description?: string; addressLine?: string; logoUrl?: string; latitude?: number; longitude?: number }
): Promise<RestaurantOwnerProfile> {
  return request("/api/v1/restaurant/me", { method: "PATCH", body: input, accessToken });
}

export function setRestaurantOpenStatus(
  accessToken: string,
  isOpen: boolean
): Promise<RestaurantOwnerProfile> {
  return request("/api/v1/restaurant/me/open-status", {
    method: "PATCH",
    body: { isOpen },
    accessToken
  });
}

export function listRestaurantMenuCategories(accessToken: string): Promise<MenuCategoryOwner[]> {
  return request("/api/v1/restaurant/me/menu/categories", { accessToken });
}

export function createRestaurantMenuCategory(
  accessToken: string,
  input: { name: string; sortOrder?: number }
): Promise<MenuCategoryOwner> {
  return request("/api/v1/restaurant/me/menu/categories", { method: "POST", body: input, accessToken });
}

export function updateRestaurantMenuCategory(
  accessToken: string,
  categoryId: string,
  input: { name?: string; sortOrder?: number; isActive?: boolean }
): Promise<MenuCategoryOwner> {
  return request(`/api/v1/restaurant/me/menu/categories/${categoryId}`, {
    method: "PATCH",
    body: input,
    accessToken
  });
}

export function listRestaurantMenuItems(accessToken: string): Promise<MenuItemOwner[]> {
  return request("/api/v1/restaurant/me/menu/items", { accessToken });
}

export function createRestaurantMenuItem(
  accessToken: string,
  input: {
    categoryId: string;
    name: string;
    description?: string;
    priceMinor: number;
    imageUrl?: string;
    sku?: string;
    brand?: string;
    unitLabel?: string;
    stockQuantity?: number | null;
    isFeatured?: boolean;
    isVariableWeight?: boolean;
    barcode?: string;
    reorderLevel?: number | null;
  }
): Promise<MenuItemOwner> {
  return request("/api/v1/restaurant/me/menu/items", { method: "POST", body: input, accessToken });
}

export function updateRestaurantMenuItem(
  accessToken: string,
  itemId: string,
  input: {
    categoryId?: string;
    name?: string;
    description?: string;
    priceMinor?: number;
    imageUrl?: string;
    sku?: string;
    brand?: string;
    unitLabel?: string;
    stockQuantity?: number | null;
    isFeatured?: boolean;
    isVariableWeight?: boolean;
    barcode?: string;
    reorderLevel?: number | null;
  }
): Promise<MenuItemOwner> {
  return request(`/api/v1/restaurant/me/menu/items/${itemId}`, {
    method: "PATCH",
    body: input,
    accessToken
  });
}

export function setRestaurantMenuItemAvailability(
  accessToken: string,
  itemId: string,
  isAvailable: boolean
): Promise<MenuItemOwner> {
  return request(`/api/v1/restaurant/me/menu/items/${itemId}/availability`, {
    method: "PATCH",
    body: { isAvailable },
    accessToken
  });
}

export function listStoreInventory(
  accessToken: string,
  params: { search?: string; lowStock?: boolean; page?: number; pageSize?: number } = {}
): Promise<InventoryPage> {
  return request(`/api/v1/restaurant/me/inventory${toQuery(params)}`, { accessToken });
}

export function lookupStoreInventoryBarcode(accessToken: string, barcode: string): Promise<InventoryItem> {
  return request(`/api/v1/restaurant/me/inventory/barcode/${encodeURIComponent(barcode)}`, { accessToken });
}

export function adjustStoreInventory(
  accessToken: string,
  itemId: string,
  quantityDelta: number,
  reason: string
): Promise<InventoryItem> {
  return request(`/api/v1/restaurant/me/inventory/items/${itemId}/adjust`, {
    method: "POST",
    body: { quantityDelta, reason },
    accessToken
  });
}

export function listStoreInventoryMovements(
  accessToken: string,
  page = 1,
  pageSize = 50
): Promise<Page<InventoryMovement>> {
  return request(`/api/v1/restaurant/me/inventory/movements?page=${page}&pageSize=${pageSize}`, { accessToken });
}

export function listStoreSuppliers(accessToken: string): Promise<Supplier[]> {
  return request("/api/v1/restaurant/me/inventory/suppliers", { accessToken });
}

export function createStoreSupplier(
  accessToken: string,
  input: { name: string; phone?: string; note?: string }
): Promise<Supplier> {
  return request("/api/v1/restaurant/me/inventory/suppliers", { method: "POST", body: input, accessToken });
}

export function listStorePurchaseOrders(accessToken: string): Promise<PurchaseOrder[]> {
  return request("/api/v1/restaurant/me/inventory/purchase-orders", { accessToken });
}

export function createStorePurchaseOrder(
  accessToken: string,
  input: {
    supplierId: string;
    reference?: string;
    note?: string;
    items: { menuItemId: string; quantity: number; unitCostMinor: number }[];
  }
): Promise<PurchaseOrder> {
  return request("/api/v1/restaurant/me/inventory/purchase-orders", { method: "POST", body: input, accessToken });
}

export function receiveStorePurchaseOrder(accessToken: string, purchaseOrderId: string): Promise<PurchaseOrder> {
  return request(`/api/v1/restaurant/me/inventory/purchase-orders/${purchaseOrderId}/receive`, {
    method: "POST",
    accessToken
  });
}

export function cancelStorePurchaseOrder(accessToken: string, purchaseOrderId: string): Promise<PurchaseOrder> {
  return request(`/api/v1/restaurant/me/inventory/purchase-orders/${purchaseOrderId}/cancel`, {
    method: "POST",
    accessToken
  });
}

export function getAdminDashboard(accessToken: string): Promise<AdminDashboard> {
  return request("/api/v1/admin/dashboard", { accessToken });
}

export function listAdminRestaurants(
  accessToken: string,
  params: { status?: RestaurantStatusValue; isOpen?: boolean; businessType?: BusinessType } = {}
): Promise<Page<AdminRestaurant>> {
  return request(`/api/v1/admin/restaurants${toQuery(params)}`, { accessToken });
}

export function getAdminRestaurant(accessToken: string, restaurantId: string): Promise<AdminRestaurantDetail> {
  return request(`/api/v1/admin/restaurants/${restaurantId}`, { accessToken });
}

export function getAdminRestaurantMenu(
  accessToken: string,
  restaurantId: string
): Promise<{ categories: { id: string; name: string; isActive: boolean; items: (MenuItemOwner & { categoryName: string })[] }[] }> {
  return request(`/api/v1/admin/restaurants/${restaurantId}/menu`, { accessToken });
}

export function listAdminOffers(accessToken: string): Promise<RestaurantOffer[]> {
  return request("/api/v1/admin/offers", { accessToken });
}

export function createAdminOffer(accessToken: string, input: AdminOfferInput): Promise<RestaurantOffer> {
  return request("/api/v1/admin/offers", { method: "POST", body: input, accessToken });
}

export function updateAdminOffer(
  accessToken: string,
  offerId: string,
  input: AdminOfferInput
): Promise<RestaurantOffer> {
  return request(`/api/v1/admin/offers/${offerId}`, { method: "PATCH", body: input, accessToken });
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
  options: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; accessToken?: string } = {}
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
    throw new ApiError(0, "NETWORK_ERROR", i18n.t("common:networkError"));
  }

  const payload = (await response.json().catch(() => null)) as T | ApiErrorPayload | null;
  if (!response.ok) {
    const error = (payload ?? {}) as ApiErrorPayload;
    throw new ApiError(
      response.status,
      error.code ?? "API_ERROR",
      error.message ?? i18n.t("common:requestFailed"),
      error.details ?? null
    );
  }
  if (response.status === 204) return undefined as T;
  if (!payload) {
    throw new ApiError(response.status, "INVALID_API_RESPONSE", i18n.t("common:invalidResponse"));
  }
  return payload as T;
}

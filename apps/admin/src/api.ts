import type { AccessContext } from "./api.business";
export type { AccessContext, BusinessType, Permission } from "./api.business";
import { createRefreshCoordinator, sendWithAuthRetry } from "./auth-retry";
const configuredApiUrl = (import.meta as any).env?.VITE_API_URL?.replace(/\/$/, "");
if ((import.meta as any).env?.PROD && (!configuredApiUrl || !configuredApiUrl.startsWith("https://"))) {
  throw new Error("Production builds require an HTTPS VITE_API_URL.");
}
export const apiBaseUrl = configuredApiUrl || "http://localhost:3000";

export type UserRole = "CUSTOMER" | "RESTAURANT" | "DRIVER" | "ADMIN";

export type PublicUser = { id: string; fullName: string; phone: string; role: UserRole };

export type AuthResult = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  refreshExpiresInSeconds: number;
  user: PublicUser;
};

export type Page<T> = { items: T[]; page: number; pageSize: number; total: number };

export type RestaurantStatus = "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";

export type RestaurantProfile = {
  id: string;
  name: string;
  description: string | null;
  phone: string;
  addressLine: string;
  logoUrl: string | null;
  isOpen: boolean;
  status: RestaurantStatus;
  createdAt: string;
};

export type AdminRestaurantView = RestaurantProfile & {
  ownerFullName: string;
  ownerPhone: string;
  totalOrdersCount: number;
  revenueMinor: number;
};

export type AdminMenuView = {
  categories: {
    id: string;
    name: string;
    isActive: boolean;
    items: { id: string; name: string; description: string | null; priceMinor: number; isAvailable: boolean }[];
  }[];
};

export type OrderStatus =
  | "PLACED"
  | "ACCEPTED"
  | "PREPARING"
  | "READY_FOR_PICKUP"
  | "DELIVERED"
  | "REJECTED"
  | "CANCELLED"
  | "DELIVERY_FAILED";
export type DeliveryStatus =
  | "PENDING_ASSIGNMENT"
  | "ASSIGNED"
  | "PICKED_UP"
  | "ON_THE_WAY"
  | "DELIVERED"
  | "CANCELLED"
  | "FAILED";

export type OrderStatusHistoryEntry = {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  changedByUserId: string;
  note: string | null;
  createdAt: string;
};

export type OrderDetail = {
  id: string;
  status: OrderStatus;
  paymentMethod: string;
  restaurant: { id: string; name: string };
  deliveryLabel: string;
  deliveryAddressLine: string;
  items: { id: string; nameSnapshot: string; quantity: number; lineTotalMinor: number }[];
  subtotalMinor: number;
  deliveryFeeMinor: number;
  discountMinor: number;
  totalMinor: number;
  acceptedByUserId: string | null;
  acceptedAt: string | null;
  acceptedByFullName?: string | null;
  createdAt: string;
  statusHistory: OrderStatusHistoryEntry[];
  delivery: { id: string; status: DeliveryStatus; assignedAt: string | null; pickedUpAt: string | null; onTheWayAt: string | null; deliveredAt: string | null } | null;
};

export type DriverApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";

export type AdminDriverView = {
  userId: string;
  fullName: string;
  phone: string;
  isActive: boolean;
  status: DriverApprovalStatus;
  isOnline: boolean;
  completedDeliveriesCount: number;
  activeDeliveryId: string | null;
  createdAt: string;
};

export type AdminUserView = {
  id: string;
  fullName: string;
  phone: string;
  role: UserRole;
  isActive: boolean;
  phoneVerifiedAt: string | null;
  createdAt: string;
};

export type DashboardActivityEntry = {
  id: string;
  orderId: string;
  restaurantName: string;
  toStatus: OrderStatus;
  createdAt: string;
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

export type AuditLogEntry = {
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

export const accessTokenStorageKey = "wasel_admin_access_token";
export const refreshTokenStorageKey = "wasel_admin_refresh_token";

/**
 * Session storage, not local storage.
 *
 * These are the most privileged tokens the platform issues, and a refresh token is good for 30
 * days. Keeping them in `sessionStorage` means they die with the browser tab rather than sitting
 * on disk on a shared or unattended machine, and it matches what the mobile web build already
 * does. Reads are wrapped because a browser configured to block site data throws on access
 * rather than returning null.
 */
function readToken(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeToken(key: string, token: string | null): void {
  try {
    if (token) sessionStorage.setItem(key, token);
    else sessionStorage.removeItem(key);
  } catch {
    // A browser that refuses to store leaves the session in memory only; the user signs in again
    // on the next reload rather than seeing the app fail outright.
  }
}

export function getAccessToken(): string | null {
  return readToken(accessTokenStorageKey);
}

export function setAccessToken(token: string | null): void {
  writeToken(accessTokenStorageKey, token);
}

export function getRefreshToken(): string | null {
  return readToken(refreshTokenStorageKey);
}

export function setRefreshToken(token: string | null): void {
  writeToken(refreshTokenStorageKey, token);
}

/** Persist a full auth result — both tokens — so the session survives past the 15-minute
 *  access-token lifetime (H-2). */
export function storeSession(result: AuthResult): void {
  setAccessToken(result.accessToken);
  setRefreshToken(result.refreshToken);
}

/** Drop both tokens (logout, or a refused refresh token). */
export function clearSession(): void {
  setAccessToken(null);
  setRefreshToken(null);
}

export function login(input: { countryCode: string; phoneNumber: string; password: string }): Promise<AuthResult> {
  return request("/api/v1/auth/login", { method: "POST", body: input });
}

export function fetchCurrentUser(): Promise<{ user: PublicUser; access: AccessContext }> {
  return request("/api/v1/auth/me");
}

export function logout(): Promise<{ message: string }> {
  return request("/api/v1/auth/logout", { method: "POST" });
}

export function getDashboard(): Promise<DashboardOverview> {
  return request("/api/v1/admin/dashboard");
}

export function listAdminRestaurants(params: { status?: string; isOpen?: boolean } = {}): Promise<Page<RestaurantProfile>> {
  return request(`/api/v1/admin/restaurants${toQuery(params)}`);
}

export function getAdminRestaurant(id: string): Promise<AdminRestaurantView> {
  return request(`/api/v1/admin/restaurants/${id}`);
}

export function getAdminRestaurantMenu(id: string): Promise<AdminMenuView> {
  return request(`/api/v1/admin/restaurants/${id}/menu`);
}

export function getAdminRestaurantOrders(id: string): Promise<Page<{ id: string; status: OrderStatus; totalMinor: number; createdAt: string }>> {
  return request(`/api/v1/admin/restaurants/${id}/orders`);
}

export function approveRestaurant(id: string): Promise<RestaurantProfile> {
  return request(`/api/v1/admin/restaurants/${id}/approve`, { method: "POST" });
}

export function rejectRestaurant(id: string): Promise<RestaurantProfile> {
  return request(`/api/v1/admin/restaurants/${id}/reject`, { method: "POST" });
}

export function suspendRestaurant(id: string, reason: string): Promise<RestaurantProfile> {
  return request(`/api/v1/admin/restaurants/${id}/suspend`, { method: "POST", body: { reason } });
}

export function reactivateRestaurant(id: string): Promise<RestaurantProfile> {
  return request(`/api/v1/admin/restaurants/${id}/reactivate`, { method: "POST" });
}

export function listAdminOrders(
  params: { status?: string; restaurantId?: string; customerId?: string; fromDate?: string; toDate?: string; page?: number } = {}
): Promise<Page<OrderDetail>> {
  return request(`/api/v1/admin/orders${toQuery(params)}`);
}

export function getAdminOrder(id: string): Promise<OrderDetail> {
  return request(`/api/v1/admin/orders/${id}`);
}

export function cancelAdminOrder(id: string, reason: string): Promise<OrderDetail> {
  return request(`/api/v1/admin/orders/${id}/cancel`, { method: "POST", body: { reason } });
}

export function listAdminDrivers(): Promise<AdminDriverView[]> {
  return request("/api/v1/admin/drivers");
}

export function approveDriver(userId: string): Promise<AdminDriverView> {
  return request(`/api/v1/admin/drivers/${userId}/approve`, { method: "POST" });
}

export function rejectDriver(userId: string, reason: string): Promise<AdminDriverView> {
  return request(`/api/v1/admin/drivers/${userId}/reject`, { method: "POST", body: { reason } });
}

export function suspendDriver(userId: string, reason: string): Promise<AdminDriverView> {
  return request(`/api/v1/admin/drivers/${userId}/suspend`, { method: "POST", body: { reason } });
}

export function reactivateDriver(userId: string): Promise<AdminDriverView> {
  return request(`/api/v1/admin/drivers/${userId}/reactivate`, { method: "POST" });
}

export function listAdminUsers(params: { role?: string; search?: string } = {}): Promise<Page<AdminUserView>> {
  return request(`/api/v1/admin/users${toQuery(params)}`);
}

export function listAuditLog(
  params: { actorUserId?: string; action?: string; fromDate?: string; toDate?: string; page?: number } = {}
): Promise<Page<AuditLogEntry>> {
  return request(`/api/v1/admin/audit-log${toQuery(params)}`);
}

export function toQuery(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== "");
  if (entries.length === 0) return "";
  const search = new URLSearchParams(entries.map(([key, value]) => [key, String(value)]));
  return `?${search.toString()}`;
}

const refreshEndpoint = "/api/v1/auth/refresh";

/**
 * Mints a fresh access token from the stored refresh token, using a raw fetch so it can't
 * recurse back through `request()`. Wrapped in a coordinator (below) so simultaneous 401s
 * share one refresh. Only a rejected refresh token (a 401 on the refresh itself) tears the
 * session down; a network failure leaves both tokens in place for a later attempt.
 */
async function performTokenRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${refreshEndpoint}`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken })
    });
  } catch {
    return null;
  }
  if (!response.ok) {
    if (response.status === 401) clearSession();
    return null;
  }
  const result = (await response.json().catch(() => null)) as AuthResult | null;
  if (!result?.accessToken) return null;
  storeSession(result);
  return result.accessToken;
}

const refreshAccessToken = createRefreshCoordinator(performTokenRefresh);

export async function request<T>(path: string, options: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown } = {}): Promise<T> {
  const accessToken = getAccessToken();
  const send = (token: string | undefined) =>
    fetch(`${apiBaseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

  let response: Response;
  try {
    // On a 401, refresh the access token once and replay — never for the refresh call
    // itself or an unauthenticated request, so this can't recurse.
    const result = await sendWithAuthRetry(send, {
      accessToken: accessToken ?? undefined,
      refresh: refreshAccessToken,
      canRefresh: accessToken !== null && path !== refreshEndpoint,
      statusOf: (res) => res.status
    });
    response = result.response;
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Cannot connect to the TasawaQ server.");
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload ?? {};
    // A 401 that survives the refresh attempt means the session is truly over.
    if (response.status === 401) clearSession();
    throw new ApiError(response.status, error.code ?? "API_ERROR", error.message ?? "The request could not be completed.", error.details ?? null);
  }
  return payload as T;
}

// ---- platform user and business management (15.5) ----

export function createAdminUser(body: {
  fullName: string;
  countryCode: string;
  phoneNumber: string;
  password: string;
  platformRoleKey?: string;
}): Promise<AdminUserView> {
  return request("/api/v1/admin/users/admins", { method: "POST", body });
}

export function setUserActive(userId: string, isActive: boolean, reason: string): Promise<AdminUserView> {
  return request(`/api/v1/admin/users/${userId}/active`, { method: "PATCH", body: { isActive, reason } });
}

export function assignPlatformRole(userId: string, platformRoleKey?: string): Promise<AdminUserView> {
  return request(`/api/v1/admin/users/${userId}/platform-role`, { method: "PATCH", body: { platformRoleKey } });
}

export function createBusiness(body: {
  businessName: string;
  ownerFullName: string;
  countryCode: string;
  phoneNumber: string;
  password: string;
  addressLine: string;
  businessType: "RESTAURANT" | "SUPERMARKET";
  description?: string;
  approveImmediately?: boolean;
}): Promise<RestaurantProfile> {
  return request("/api/v1/admin/restaurants", { method: "POST", body });
}

// ---- public orientation landmarks for the customer address map ----

export type Landmark = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  createdAt: string;
  updatedAt: string;
};

export function listLandmarks(): Promise<Landmark[]> {
  return request("/api/v1/admin/landmarks");
}

export function createLandmark(body: { name: string; latitude: number; longitude: number }): Promise<Landmark> {
  return request("/api/v1/admin/landmarks", { method: "POST", body });
}

export function updateLandmark(
  id: string,
  body: { name: string; latitude: number; longitude: number }
): Promise<Landmark> {
  return request(`/api/v1/admin/landmarks/${id}`, { method: "PATCH", body });
}

export function deleteLandmark(id: string): Promise<{ id: string }> {
  return request(`/api/v1/admin/landmarks/${id}`, { method: "DELETE" });
}

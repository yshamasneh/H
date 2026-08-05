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

export type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

export const orderPaymentMethods = ["CASH"] as const;
export type OrderPaymentMethod = (typeof orderPaymentMethods)[number];
export type OrderStatusValue = "PLACED" | "CANCELLED";

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

export const apiBaseUrl =
  process.env?.EXPO_PUBLIC_API_URL ||
  Platform.select({
    android: "http://10.0.2.2:3000",
    ios: "http://localhost:3000",
    default: "http://localhost:3000"
  }) ||
  "http://localhost:3000";

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

export function createOrder(accessToken: string, input: CreateOrderInput): Promise<OrderDetail> {
  return request("/api/v1/orders", { method: "POST", body: input, accessToken });
}

export function listMyOrders(accessToken: string, page = 1, pageSize = 20): Promise<Page<OrderDetail>> {
  return request(`/api/v1/orders/me?page=${page}&pageSize=${pageSize}`, { accessToken });
}

export function getMyOrder(accessToken: string, orderId: string): Promise<OrderDetail> {
  return request(`/api/v1/orders/${orderId}`, { accessToken });
}

async function request<T>(
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown; accessToken?: string } = {}
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

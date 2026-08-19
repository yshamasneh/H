import { request, toQuery, type OrderDetail, type Page, type RestaurantProfile, type RestaurantStatus } from "./api";

/**
 * The business portal's API surface, kept separate from the platform-administration calls in
 * `api.ts` so the two shells stay readable as they grow.
 */

export type Permission =
  | "MANAGE_BUSINESSES"
  | "MANAGE_USERS"
  | "MANAGE_ADMINS"
  | "MANAGE_ROLES"
  | "MANAGE_DRIVERS"
  | "MANAGE_OFFERS"
  | "VIEW_ACCOUNTING"
  | "MANAGE_ACCOUNTING_SETTINGS"
  | "APPROVE_OPERATING_COSTS"
  | "RECEIVE_DRIVER_CASH"
  | "MANAGE_SETTLEMENTS"
  | "VIEW_ALL_ORDERS"
  | "MANAGE_ALL_ORDERS"
  | "MANAGE_PRODUCTS"
  | "MANAGE_PRICES"
  | "MANAGE_MENU"
  | "MANAGE_INVENTORY"
  | "VIEW_ORDERS"
  | "MANAGE_ORDERS"
  | "VIEW_SALES"
  | "VIEW_REPORTS"
  | "MANAGE_BUSINESS_SETTINGS"
  | "MANAGE_BUSINESS_STAFF"
  | "PROPOSE_OPERATING_COSTS"
  | "VIEW_AUDIT_LOG";

export type BusinessType = "RESTAURANT" | "SUPERMARKET";

export type AccessContext = {
  isSuperAdmin: boolean;
  permissions: Permission[];
  roleKey: string | null;
  business: {
    id: string;
    name: string;
    businessType: BusinessType;
    status: RestaurantStatus;
    isOpen: boolean;
  } | null;
};

export type BusinessOrderItem = {
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
    replacementNameSnapshot: string | null;
    actualQuantityMilli: number;
    lineTotalMinor: number;
    status: "PENDING" | "APPROVED" | "REJECTED";
    note: string | null;
  } | null;
};

export type BusinessOrder = Omit<OrderDetail, "items"> & {
  items: BusinessOrderItem[];
  customerNote: string | null;
  requiresCustomerReview: boolean;
};

export type LiveOrderQueue = {
  business: { id: string; name: string; businessType: BusinessType; isOpen: boolean };
  new: BusinessOrder[];
  inProgress: BusinessOrder[];
  ready: BusinessOrder[];
  serverTime: string;
};

export function getLiveOrders(): Promise<LiveOrderQueue> {
  return request("/api/v1/restaurant/me/orders/live");
}

export function getBusinessOrder(orderId: string): Promise<BusinessOrder> {
  return request(`/api/v1/restaurant/me/orders/${orderId}`);
}

export function updateBusinessOrderStatus(
  orderId: string,
  status: "ACCEPTED" | "PREPARING" | "READY_FOR_PICKUP" | "REJECTED",
  note?: string
): Promise<BusinessOrder> {
  return request(`/api/v1/restaurant/me/orders/${orderId}/status`, { method: "PATCH", body: { status, note } });
}

export function proposeFulfillment(
  orderId: string,
  orderItemId: string,
  body: { replacementMenuItemId?: string; actualQuantityMilli?: number; note?: string }
): Promise<BusinessOrder> {
  return request(`/api/v1/restaurant/me/orders/${orderId}/items/${orderItemId}/fulfillment`, {
    method: "POST",
    body
  });
}

export type BusinessProfile = RestaurantProfile & { businessType: BusinessType };

export function getBusinessProfile(): Promise<BusinessProfile> {
  return request("/api/v1/restaurant/me");
}

export function setBusinessOpenStatus(isOpen: boolean): Promise<BusinessProfile> {
  return request("/api/v1/restaurant/me/open-status", { method: "PATCH", body: { isOpen } });
}

// ---- catalogue ----

export type MenuCategoryOwner = { id: string; name: string; sortOrder: number; isActive: boolean };

export type MenuItemOwner = {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  priceMinor: number;
  /** What the store paid per unit. Owner/admin-only; never present on a customer-facing view. */
  costPriceMinor: number | null;
  imageUrl: string | null;
  sku: string | null;
  brand: string | null;
  unitLabel: string;
  stockQuantity: number | null;
  reorderLevel: number | null;
  barcode: string | null;
  isFeatured: boolean;
  isVariableWeight: boolean;
  isAvailable: boolean;
};

export function listBusinessCategories(): Promise<MenuCategoryOwner[]> {
  return request("/api/v1/restaurant/me/menu/categories");
}

export function createBusinessCategory(body: { name: string; sortOrder?: number }): Promise<MenuCategoryOwner> {
  return request("/api/v1/restaurant/me/menu/categories", { method: "POST", body });
}

export function updateBusinessCategory(
  categoryId: string,
  body: { name?: string; sortOrder?: number; isActive?: boolean }
): Promise<MenuCategoryOwner> {
  return request(`/api/v1/restaurant/me/menu/categories/${categoryId}`, { method: "PATCH", body });
}

export function deleteBusinessCategory(categoryId: string): Promise<{ message: string }> {
  return request(`/api/v1/restaurant/me/menu/categories/${categoryId}`, { method: "DELETE" });
}

export function listBusinessItems(): Promise<MenuItemOwner[]> {
  return request("/api/v1/restaurant/me/menu/items");
}

export function createBusinessItem(body: Record<string, unknown>): Promise<MenuItemOwner> {
  return request("/api/v1/restaurant/me/menu/items", { method: "POST", body });
}

export function updateBusinessItem(itemId: string, body: Record<string, unknown>): Promise<MenuItemOwner> {
  return request(`/api/v1/restaurant/me/menu/items/${itemId}`, { method: "PATCH", body });
}

export function deleteBusinessItem(itemId: string): Promise<{ message: string }> {
  return request(`/api/v1/restaurant/me/menu/items/${itemId}`, { method: "DELETE" });
}

export function setBusinessItemAvailability(itemId: string, isAvailable: boolean): Promise<MenuItemOwner> {
  return request(`/api/v1/restaurant/me/menu/items/${itemId}/availability`, {
    method: "PATCH",
    body: { isAvailable }
  });
}

// ---- inventory, suppliers, purchasing (supermarket only) ----

export type InventoryRow = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  stockQuantity: number | null;
  reorderLevel: number | null;
  isLowStock?: boolean;
};

export function listInventory(params: { search?: string; lowStock?: boolean } = {}): Promise<Page<InventoryRow>> {
  return request(`/api/v1/restaurant/me/inventory${toQuery(params)}`);
}

export function adjustInventory(itemId: string, body: { quantityDelta: number; reason: string }): Promise<unknown> {
  return request(`/api/v1/restaurant/me/inventory/items/${itemId}/adjust`, { method: "POST", body });
}

export type Supplier = { id: string; name: string; phone: string | null; note: string | null; isActive: boolean };

export function listSuppliers(): Promise<Supplier[]> {
  return request("/api/v1/restaurant/me/inventory/suppliers");
}

export function createSupplier(body: { name: string; phone?: string; note?: string }): Promise<Supplier> {
  return request("/api/v1/restaurant/me/inventory/suppliers", { method: "POST", body });
}

export type PurchaseOrderView = {
  id: string;
  supplierId: string;
  supplierName?: string;
  status: "DRAFT" | "RECEIVED" | "CANCELLED";
  reference: string | null;
  totalCostMinor: number;
  receivedAt: string | null;
  createdAt: string;
  items: { menuItemId: string; quantity: number; unitCostMinor: number }[];
};

export function listPurchaseOrders(): Promise<PurchaseOrderView[]> {
  return request("/api/v1/restaurant/me/inventory/purchase-orders");
}

export function createPurchaseOrder(body: {
  supplierId: string;
  reference?: string;
  note?: string;
  items: { menuItemId: string; quantity: number; unitCostMinor: number }[];
}): Promise<PurchaseOrderView> {
  return request("/api/v1/restaurant/me/inventory/purchase-orders", { method: "POST", body });
}

export function receivePurchaseOrder(purchaseOrderId: string): Promise<PurchaseOrderView> {
  return request(`/api/v1/restaurant/me/inventory/purchase-orders/${purchaseOrderId}/receive`, { method: "POST" });
}

export function cancelPurchaseOrder(purchaseOrderId: string): Promise<PurchaseOrderView> {
  return request(`/api/v1/restaurant/me/inventory/purchase-orders/${purchaseOrderId}/cancel`, { method: "POST" });
}

// ---- staff ----

export type BusinessStaffMember = {
  userId: string;
  fullName: string;
  phone: string;
  roleKey: string;
  isActive: boolean;
  isOwner: boolean;
  createdAt: string;
};

export function listBusinessStaff(): Promise<BusinessStaffMember[]> {
  return request("/api/v1/restaurant/me/staff");
}

export function addBusinessStaff(body: {
  fullName: string;
  countryCode: string;
  phoneNumber: string;
  password: string;
  confirmPassword: string;
  roleKey: string;
}): Promise<BusinessStaffMember> {
  return request("/api/v1/restaurant/me/staff", { method: "POST", body });
}

export function updateBusinessStaff(
  staffUserId: string,
  body: { roleKey?: string; isActive?: boolean }
): Promise<BusinessStaffMember> {
  return request(`/api/v1/restaurant/me/staff/${staffUserId}`, { method: "PATCH", body });
}

export function removeBusinessStaff(staffUserId: string): Promise<{ message: string }> {
  return request(`/api/v1/restaurant/me/staff/${staffUserId}`, { method: "DELETE" });
}

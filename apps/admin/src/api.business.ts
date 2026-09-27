import type { ProfileBody } from "./business-profile";
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
  | "MANAGE_NOTIFICATIONS"
  | "MANAGE_LANDMARKS"
  | "MANAGE_PLATFORM_SETTINGS"
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
  /** The product's picture now (display only); null when it has none. */
  imageUrl?: string | null;
  /** In the bag, as ticked by whoever is packing. Shared by every device on the business. */
  isPicked?: boolean;
  fulfillmentAdjustment: {
    id: string;
    replacementMenuItemId?: string | null;
    replacementNameSnapshot: string | null;
    replacementUnitLabelSnapshot?: string | null;
    /** The replacement product's picture (display only). */
    replacementImageUrl?: string | null;
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

/**
 * The store workspace's calls (orders, open/close, reports, stock, staff, and the product list the
 * order screen offers as replacements), bound to one API base. The store's own shell uses
 * `/api/v1/restaurant/me`; the admin console's store section uses `/api/v1/admin/restaurants/:id`,
 * whose routes mirror the owner ones path for path. The server decides what either caller may do.
 */
export function createStoreApi(base: string) {
  return {
    getLiveOrders(): Promise<LiveOrderQueue> {
      return request(`${base}/orders/live`);
    },

    getBusinessOrder(orderId: string): Promise<BusinessOrder> {
      return request(`${base}/orders/${orderId}`);
    },

    updateBusinessOrderStatus(
      orderId: string,
      status: "ACCEPTED" | "PREPARING" | "READY_FOR_PICKUP" | "REJECTED",
      note?: string
    ): Promise<BusinessOrder> {
      return request(`${base}/orders/${orderId}/status`, { method: "PATCH", body: { status, note } });
    },

    /** Sets whether one line of an order being packed is in the bag. A set, not a flip, so two devices converge. */
    setItemPicked(orderId: string, orderItemId: string, isPicked: boolean): Promise<BusinessOrder> {
      return request(`${base}/orders/${orderId}/items/${orderItemId}/picked`, {
        method: "PUT",
        body: { isPicked }
      });
    },

    proposeFulfillment(
      orderId: string,
      orderItemId: string,
      body: { replacementMenuItemId?: string; actualQuantityMilli?: number; note?: string }
    ): Promise<BusinessOrder> {
      return request(`${base}/orders/${orderId}/items/${orderItemId}/fulfillment`, {
        method: "POST",
        body
      });
    },

    getBusinessStats(): Promise<BusinessStats> {
      return request(`${base}/stats`);
    },

    setBusinessOpenStatus(isOpen: boolean): Promise<BusinessProfile> {
      return request(`${base}/open-status`, { method: "PATCH", body: { isOpen } });
    },

    listBusinessItems(): Promise<MenuItemOwner[]> {
      return request(`${base}/menu/items`);
    },

    listInventory(
      params: { search?: string; lowStock?: boolean; page?: number; pageSize?: number } = {}
    ): Promise<Page<InventoryRow>> {
      return request(`${base}/inventory${toQuery(params)}`);
    },

    listInventoryMovements(
      params: { menuItemId?: string; page?: number; pageSize?: number } = {}
    ): Promise<Page<InventoryMovement>> {
      return request(`${base}/inventory/movements${toQuery(params)}`);
    },

    lookupInventoryBarcode(barcode: string): Promise<InventoryRow> {
      return request(`${base}/inventory/barcode/${encodeURIComponent(barcode.trim())}`);
    },

    adjustInventory(itemId: string, body: { quantityDelta: number; reason: string }): Promise<unknown> {
      return request(`${base}/inventory/items/${itemId}/adjust`, { method: "POST", body });
    },

    listSuppliers(): Promise<Supplier[]> {
      return request(`${base}/inventory/suppliers`);
    },

    createSupplier(body: { name: string; phone?: string; note?: string }): Promise<Supplier> {
      return request(`${base}/inventory/suppliers`, { method: "POST", body });
    },

    listPurchaseOrders(): Promise<PurchaseOrderView[]> {
      return request(`${base}/inventory/purchase-orders`);
    },

    createPurchaseOrder(body: {
      supplierId: string;
      reference?: string;
      note?: string;
      items: { menuItemId: string; quantity: number; unitCostMinor: number }[];
    }): Promise<PurchaseOrderView> {
      return request(`${base}/inventory/purchase-orders`, { method: "POST", body });
    },

    receivePurchaseOrder(purchaseOrderId: string): Promise<PurchaseOrderView> {
      return request(`${base}/inventory/purchase-orders/${purchaseOrderId}/receive`, { method: "POST" });
    },

    cancelPurchaseOrder(purchaseOrderId: string): Promise<PurchaseOrderView> {
      return request(`${base}/inventory/purchase-orders/${purchaseOrderId}/cancel`, { method: "POST" });
    },

    listBusinessStaff(): Promise<BusinessStaffMember[]> {
      return request(`${base}/staff`);
    },

    addBusinessStaff(body: {
      fullName: string;
      countryCode: string;
      phoneNumber: string;
      password: string;
      confirmPassword: string;
      roleKey: string;
    }): Promise<BusinessStaffMember> {
      return request(`${base}/staff`, { method: "POST", body });
    },

    updateBusinessStaff(
      staffUserId: string,
      body: { roleKey?: string; isActive?: boolean }
    ): Promise<BusinessStaffMember> {
      return request(`${base}/staff/${staffUserId}`, { method: "PATCH", body });
    },

    removeBusinessStaff(staffUserId: string): Promise<{ message: string }> {
      return request(`${base}/staff/${staffUserId}`, { method: "DELETE" });
    }
  };
}

export type StoreApi = ReturnType<typeof createStoreApi>;

export const ownStoreApi = createStoreApi("/api/v1/restaurant/me");

/** The same calls bound to a store an admin manages by id (admin/restaurants/:restaurantId/...). */
export function adminStoreApi(restaurantId: string): StoreApi {
  return createStoreApi(`/api/v1/admin/restaurants/${restaurantId}`);
}

export const getLiveOrders = ownStoreApi.getLiveOrders;

export const getBusinessOrder = ownStoreApi.getBusinessOrder;

export const updateBusinessOrderStatus = ownStoreApi.updateBusinessOrderStatus;

export const setItemPicked = ownStoreApi.setItemPicked;

export const proposeFulfillment = ownStoreApi.proposeFulfillment;

export type BusinessProfile = RestaurantProfile & { businessType: BusinessType };

export function getBusinessProfile(): Promise<BusinessProfile> {
  return request("/api/v1/restaurant/me");
}

export function updateBusinessProfile(body: ProfileBody): Promise<BusinessProfile> {
  return request("/api/v1/restaurant/me", { method: "PATCH", body });
}

export type PeriodStats = { salesMinor: number; ordersCount: number };
export type BusinessStats = { today: PeriodStats; month: PeriodStats; total: PeriodStats };

export const getBusinessStats = ownStoreApi.getBusinessStats;

export const setBusinessOpenStatus = ownStoreApi.setBusinessOpenStatus;

// ---- catalogue ----

export type MenuCategoryOwner = { id: string; name: string; sortOrder: number; isActive: boolean };

export type MenuItemOwner = {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  priceMinor: number;
  /** The price customers pay while a sale is on; null when there is no sale. Always below priceMinor. */
  salePriceMinor: number | null;
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
  /** Manual display ordering for customer-facing listings; higher sorts first. */
  displayPriority: number;
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

export const listBusinessItems = ownStoreApi.listBusinessItems;

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

// ---- admin: manage ANY store's catalogue -------------------------------------------------------
// These target a store by id (/admin/restaurants/:id/menu/*) so a platform admin can manage a
// catalogue they do not own. The server guards them with the ADMIN role + MANAGE_BUSINESSES.

const adminMenuBase = (restaurantId: string) => `/api/v1/admin/restaurants/${restaurantId}/menu`;

export function listStoreCategories(restaurantId: string): Promise<MenuCategoryOwner[]> {
  return request(`${adminMenuBase(restaurantId)}/categories`);
}

export function createStoreCategory(restaurantId: string, body: { name: string; sortOrder?: number }): Promise<MenuCategoryOwner> {
  return request(`${adminMenuBase(restaurantId)}/categories`, { method: "POST", body });
}

export function updateStoreCategory(
  restaurantId: string,
  categoryId: string,
  body: { name?: string; sortOrder?: number; isActive?: boolean }
): Promise<MenuCategoryOwner> {
  return request(`${adminMenuBase(restaurantId)}/categories/${categoryId}`, { method: "PATCH", body });
}

export function deleteStoreCategory(restaurantId: string, categoryId: string): Promise<{ message: string }> {
  return request(`${adminMenuBase(restaurantId)}/categories/${categoryId}`, { method: "DELETE" });
}

export function listStoreItems(restaurantId: string): Promise<MenuItemOwner[]> {
  return request(`${adminMenuBase(restaurantId)}/items`);
}

export function createStoreItem(restaurantId: string, body: Record<string, unknown>): Promise<MenuItemOwner> {
  return request(`${adminMenuBase(restaurantId)}/items`, { method: "POST", body });
}

export function updateStoreItem(restaurantId: string, itemId: string, body: Record<string, unknown>): Promise<MenuItemOwner> {
  return request(`${adminMenuBase(restaurantId)}/items/${itemId}`, { method: "PATCH", body });
}

export function deleteStoreItem(restaurantId: string, itemId: string): Promise<{ message: string }> {
  return request(`${adminMenuBase(restaurantId)}/items/${itemId}`, { method: "DELETE" });
}

export function setStoreItemAvailability(restaurantId: string, itemId: string, isAvailable: boolean): Promise<MenuItemOwner> {
  return request(`${adminMenuBase(restaurantId)}/items/${itemId}/availability`, { method: "PATCH", body: { isAvailable } });
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

export const listInventory = ownStoreApi.listInventory;

export type InventoryMovementType =
  | "ORDER_RESERVATION"
  | "ORDER_RESTORE"
  | "FULFILLMENT_RESERVATION"
  | "FULFILLMENT_RELEASE"
  | "MANUAL_ADJUSTMENT"
  | "PURCHASE_RECEIPT";

export type InventoryMovement = {
  id: string;
  menuItemId: string;
  type: InventoryMovementType;
  quantityDelta: number;
  stockAfter: number;
  reason: string | null;
  createdAt: string;
  menuItem: { name: string; sku: string | null };
};

export const listInventoryMovements = ownStoreApi.listInventoryMovements;

export const lookupInventoryBarcode = ownStoreApi.lookupInventoryBarcode;

export const adjustInventory = ownStoreApi.adjustInventory;

export type Supplier = { id: string; name: string; phone: string | null; note: string | null; isActive: boolean };

export const listSuppliers = ownStoreApi.listSuppliers;

export const createSupplier = ownStoreApi.createSupplier;

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

export const listPurchaseOrders = ownStoreApi.listPurchaseOrders;

export const createPurchaseOrder = ownStoreApi.createPurchaseOrder;

export const receivePurchaseOrder = ownStoreApi.receivePurchaseOrder;

export const cancelPurchaseOrder = ownStoreApi.cancelPurchaseOrder;

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

export const listBusinessStaff = ownStoreApi.listBusinessStaff;

export const addBusinessStaff = ownStoreApi.addBusinessStaff;

export const updateBusinessStaff = ownStoreApi.updateBusinessStaff;

export const removeBusinessStaff = ownStoreApi.removeBusinessStaff;

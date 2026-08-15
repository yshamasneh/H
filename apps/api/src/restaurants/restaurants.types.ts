import type { BusinessType, RestaurantStatus } from "../generated/prisma/enums";

export type RestaurantPublicView = {
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

export type RestaurantProfileView = RestaurantPublicView & {
  status: RestaurantStatus;
  createdAt: Date;
};

export type MenuItemPublicView = {
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

export type MenuCategoryPublicView = {
  id: string;
  name: string;
  sortOrder: number;
  items: MenuItemPublicView[];
};

export type PublicMenuView = {
  restaurant: RestaurantPublicView;
  categories: MenuCategoryPublicView[];
};

export type MenuCategoryOwnerView = {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

export type MenuItemOwnerView = Omit<MenuItemPublicView, "effectivePriceMinor" | "offer"> & {
  categoryId: string;
  isAvailable: boolean;
  /** What the store paid per unit. Owner/admin-only — never present on any customer-facing view. */
  costPriceMinor: number | null;
};

export type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

export type AdminRestaurantView = RestaurantProfileView & {
  ownerFullName: string;
  ownerPhone: string;
  totalOrdersCount: number;
  revenueMinor: number;
};

export type AdminMenuItemView = MenuItemOwnerView & {
  categoryName: string;
};

export type SupermarketProductView = MenuItemPublicView & {
  categoryId: string;
  categoryName: string;
};

export type SupermarketCatalogView = {
  supermarket: RestaurantPublicView;
  departments: { id: string; name: string; sortOrder: number; productCount: number }[];
  products: SupermarketProductView[];
  page: number;
  pageSize: number;
  total: number;
};

export type BusinessStaffView = {
  userId: string;
  fullName: string;
  phone: string;
  roleKey: string;
  isActive: boolean;
  /** The owner of record, whose access cannot be removed from inside the business. */
  isOwner: boolean;
  createdAt: Date;
};

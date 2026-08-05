import type { RestaurantStatus } from "../generated/prisma/enums";

export type RestaurantPublicView = {
  id: string;
  name: string;
  description: string | null;
  phone: string;
  addressLine: string;
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
  imageUrl: string | null;
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

export type MenuItemOwnerView = MenuItemPublicView & {
  categoryId: string;
  isAvailable: boolean;
};

export type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

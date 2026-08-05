import { randomUUID } from "node:crypto";
import { RestaurantStatus, UserRole } from "../../generated/prisma/client";

type UserRecord = {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  passwordHash: string;
  role: UserRole;
  phoneVerifiedAt: Date | null;
  isActive: boolean;
  tokenVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

type RestaurantRecord = {
  id: string;
  ownerUserId: string;
  name: string;
  description: string | null;
  phone: string;
  status: RestaurantStatus;
  isOpen: boolean;
  addressLine: string;
  logoUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type MenuCategoryRecord = {
  id: string;
  restaurantId: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type MenuItemRecord = {
  id: string;
  restaurantId: string;
  categoryId: string;
  name: string;
  description: string | null;
  priceMinor: number;
  imageUrl: string | null;
  isAvailable: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export class FakeRestaurantPrisma {
  readonly users: UserRecord[] = [];
  readonly restaurants: RestaurantRecord[] = [];
  readonly menuCategories: MenuCategoryRecord[] = [];
  readonly menuItems: MenuItemRecord[] = [];
  private transactionTail: Promise<void> = Promise.resolve();

  readonly user = {} as any;
  readonly restaurant = {} as any;
  readonly menuCategory = {} as any;
  readonly menuItem = {} as any;

  constructor() {
    this.user.findUnique = async ({ where }: any) =>
      this.users.find((user) => (where.phone ? user.phone === where.phone : user.id === where.id)) ?? null;
    this.user.create = async ({ data }: any) => {
      if (this.users.some((user) => user.phone === data.phone)) {
        throw new Error("duplicate user phone");
      }
      const now = new Date();
      const user: UserRecord = {
        id: data.id ?? randomUUID(),
        fullName: data.fullName,
        phone: data.phone,
        email: data.email ?? null,
        passwordHash: data.passwordHash,
        role: data.role,
        phoneVerifiedAt: data.phoneVerifiedAt ?? null,
        isActive: data.isActive ?? true,
        tokenVersion: 0,
        createdAt: now,
        updatedAt: now
      };
      this.users.push(user);
      return user;
    };

    this.restaurant.findUnique = async ({ where }: any) =>
      this.restaurants.find((restaurant) =>
        where.id ? restaurant.id === where.id : restaurant.ownerUserId === where.ownerUserId
      ) ?? null;
    this.restaurant.findFirst = async ({ where }: any) =>
      this.restaurants.find(
        (restaurant) =>
          (!where.id || restaurant.id === where.id) && (!where.status || restaurant.status === where.status)
      ) ?? null;
    this.restaurant.findMany = async ({ where, skip = 0, take }: any) => {
      const matches = this.restaurants
        .filter(
          (restaurant) =>
            (!where?.status || restaurant.status === where.status) &&
            (where?.isOpen === undefined || restaurant.isOpen === where.isOpen)
        )
        .sort((left, right) => left.name.localeCompare(right.name));
      return typeof take === "number" ? matches.slice(skip, skip + take) : matches.slice(skip);
    };
    this.restaurant.count = async ({ where }: any) =>
      this.restaurants.filter(
        (restaurant) =>
          (!where?.status || restaurant.status === where.status) &&
          (where?.isOpen === undefined || restaurant.isOpen === where.isOpen)
      ).length;
    this.restaurant.create = async ({ data }: any) => {
      const now = new Date();
      const restaurant: RestaurantRecord = {
        id: data.id ?? randomUUID(),
        ownerUserId: data.ownerUserId,
        name: data.name,
        description: data.description ?? null,
        phone: data.phone,
        status: data.status ?? RestaurantStatus.PENDING,
        isOpen: data.isOpen ?? false,
        addressLine: data.addressLine,
        logoUrl: data.logoUrl ?? null,
        createdAt: now,
        updatedAt: now
      };
      this.restaurants.push(restaurant);
      return restaurant;
    };
    this.restaurant.update = async ({ where, data }: any) => {
      const restaurant = this.restaurants.find((item) => item.id === where.id);
      if (!restaurant) throw new Error("missing restaurant");
      if (data.name !== undefined) restaurant.name = data.name;
      if (data.description !== undefined) restaurant.description = data.description;
      if (data.addressLine !== undefined) restaurant.addressLine = data.addressLine;
      if (data.logoUrl !== undefined) restaurant.logoUrl = data.logoUrl;
      if (data.isOpen !== undefined) restaurant.isOpen = data.isOpen;
      if (data.status !== undefined) restaurant.status = data.status;
      restaurant.updatedAt = new Date();
      return restaurant;
    };

    this.menuCategory.findUnique = async ({ where }: any) =>
      this.menuCategories.find((category) => category.id === where.id) ?? null;
    this.menuCategory.findMany = async ({ where, include }: any) => {
      const categories = this.menuCategories
        .filter(
          (category) =>
            category.restaurantId === where.restaurantId && (where.isActive === undefined || category.isActive === where.isActive)
        )
        .sort((left, right) => left.sortOrder - right.sortOrder);
      if (!include?.items) return categories;
      return categories.map((category) => ({
        ...category,
        items: this.menuItems
          .filter(
            (item) =>
              item.categoryId === category.id &&
              (include.items.where?.isAvailable === undefined || item.isAvailable === include.items.where.isAvailable)
          )
          .sort((left, right) => left.name.localeCompare(right.name))
      }));
    };
    this.menuCategory.create = async ({ data }: any) => {
      const now = new Date();
      const category: MenuCategoryRecord = {
        id: data.id ?? randomUUID(),
        restaurantId: data.restaurantId,
        name: data.name,
        sortOrder: data.sortOrder ?? 0,
        isActive: data.isActive ?? true,
        createdAt: now,
        updatedAt: now
      };
      this.menuCategories.push(category);
      return category;
    };
    this.menuCategory.update = async ({ where, data }: any) => {
      const category = this.menuCategories.find((item) => item.id === where.id);
      if (!category) throw new Error("missing category");
      if (data.name !== undefined) category.name = data.name;
      if (data.sortOrder !== undefined) category.sortOrder = data.sortOrder;
      if (data.isActive !== undefined) category.isActive = data.isActive;
      category.updatedAt = new Date();
      return category;
    };

    this.menuItem.findUnique = async ({ where }: any) =>
      this.menuItems.find((item) => item.id === where.id) ?? null;
    this.menuItem.findMany = async ({ where }: any) => {
      let items = this.menuItems.filter((item) => item.restaurantId === where.restaurantId);
      if (where.isAvailable !== undefined) items = items.filter((item) => item.isAvailable === where.isAvailable);
      if (where.categoryId) items = items.filter((item) => item.categoryId === where.categoryId);
      return [...items].sort((left, right) => left.name.localeCompare(right.name));
    };
    this.menuItem.create = async ({ data }: any) => {
      const now = new Date();
      const item: MenuItemRecord = {
        id: data.id ?? randomUUID(),
        restaurantId: data.restaurantId,
        categoryId: data.categoryId,
        name: data.name,
        description: data.description ?? null,
        priceMinor: data.priceMinor,
        imageUrl: data.imageUrl ?? null,
        isAvailable: data.isAvailable ?? true,
        createdAt: now,
        updatedAt: now
      };
      this.menuItems.push(item);
      return item;
    };
    this.menuItem.update = async ({ where, data }: any) => {
      const item = this.menuItems.find((candidate) => candidate.id === where.id);
      if (!item) throw new Error("missing item");
      if (data.categoryId !== undefined) item.categoryId = data.categoryId;
      if (data.name !== undefined) item.name = data.name;
      if (data.description !== undefined) item.description = data.description;
      if (data.priceMinor !== undefined) item.priceMinor = data.priceMinor;
      if (data.imageUrl !== undefined) item.imageUrl = data.imageUrl;
      if (data.isAvailable !== undefined) item.isAvailable = data.isAvailable;
      item.updatedAt = new Date();
      return item;
    };
  }

  async $transaction<T>(operation: (transaction: this) => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation(this);
    } finally {
      release();
    }
  }

  seedApprovedOpenRestaurant(overrides: Partial<RestaurantRecord> = {}): RestaurantRecord {
    const now = new Date();
    const restaurant: RestaurantRecord = {
      id: randomUUID(),
      ownerUserId: randomUUID(),
      name: "Falafel House",
      description: null,
      phone: "+970591234567",
      status: RestaurantStatus.APPROVED,
      isOpen: true,
      addressLine: "Al-Manara Square, Ramallah",
      logoUrl: null,
      createdAt: now,
      updatedAt: now,
      ...overrides
    };
    this.restaurants.push(restaurant);
    return restaurant;
  }
}

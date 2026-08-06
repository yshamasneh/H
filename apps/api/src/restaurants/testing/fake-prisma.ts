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

type OrderRecord = {
  id: string;
  restaurantId: string;
  customerId: string;
  status: string;
  totalMinor: number;
  createdAt: Date;
};

type NotificationRecord = {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  relatedEntityId: string | null;
  isRead: boolean;
  createdAt: Date;
};

type AuditLogRecord = {
  id: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  metadataJson: unknown;
  createdAt: Date;
};

export class FakeRestaurantPrisma {
  readonly users: UserRecord[] = [];
  readonly restaurants: RestaurantRecord[] = [];
  readonly menuCategories: MenuCategoryRecord[] = [];
  readonly menuItems: MenuItemRecord[] = [];
  readonly orders: OrderRecord[] = [];
  readonly notifications: NotificationRecord[] = [];
  readonly auditLogs: AuditLogRecord[] = [];
  private transactionTail: Promise<void> = Promise.resolve();

  readonly user = {} as any;
  readonly restaurant = {} as any;
  readonly menuCategory = {} as any;
  readonly menuItem = {} as any;
  readonly order = {} as any;
  readonly notification = {} as any;
  readonly auditLog = {} as any;

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

    this.restaurant.findUnique = async ({ where, include }: any) => {
      const restaurant = this.restaurants.find((candidate) =>
        where.id ? candidate.id === where.id : candidate.ownerUserId === where.ownerUserId
      );
      if (!restaurant) return null;
      return include?.owner ? { ...restaurant, owner: this.users.find((user) => user.id === restaurant.ownerUserId)! } : restaurant;
    };
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

    this.order.count = async ({ where }: any) =>
      this.orders.filter((order) => !where?.restaurantId || order.restaurantId === where.restaurantId).length;
    this.order.findMany = async ({ where, select, skip = 0, take, orderBy }: any) => {
      let matches = this.orders.filter(
        (order) =>
          (!where?.restaurantId || order.restaurantId === where.restaurantId) &&
          (!where?.status || order.status === where.status)
      );
      if (orderBy?.createdAt === "desc") {
        matches = [...matches].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
      }
      const sliced = typeof take === "number" ? matches.slice(skip, skip + take) : matches.slice(skip);
      if (!select) return sliced;
      return sliced.map((order) => {
        const projected: Record<string, unknown> = {};
        for (const key of Object.keys(select)) projected[key] = (order as any)[key];
        return projected;
      });
    };

    this.notification.create = async ({ data }: any) => {
      const notification: NotificationRecord = {
        id: randomUUID(),
        userId: data.userId,
        type: data.type,
        title: data.title,
        body: data.body,
        relatedEntityId: data.relatedEntityId ?? null,
        isRead: false,
        createdAt: new Date()
      };
      this.notifications.push(notification);
      return notification;
    };

    this.auditLog.create = async ({ data }: any) => {
      const entry: AuditLogRecord = {
        id: randomUUID(),
        actorUserId: data.actorUserId,
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId,
        reason: data.reason ?? null,
        metadataJson: data.metadataJson ?? null,
        createdAt: new Date()
      };
      this.auditLogs.push(entry);
      return entry;
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

  seedOrder(restaurantId: string, overrides: Partial<OrderRecord> = {}): OrderRecord {
    const order: OrderRecord = {
      id: randomUUID(),
      restaurantId,
      customerId: randomUUID(),
      status: "DELIVERED",
      totalMinor: 2000,
      createdAt: new Date(),
      ...overrides
    };
    this.orders.push(order);
    return order;
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

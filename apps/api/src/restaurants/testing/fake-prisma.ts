import { randomUUID } from "node:crypto";
import { BusinessType, RestaurantStatus, UserRole } from "../../generated/prisma/client";

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
  businessType: BusinessType;
  description: string | null;
  phone: string;
  status: RestaurantStatus;
  isOpen: boolean;
  opensAt: string | null;
  closesAt: string | null;
  addressLine: string;
  latitude: number | null;
  longitude: number | null;
  showLocationToCustomer: boolean;
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
  costPriceMinor: number | null;
  imageUrl: string | null;
  sku: string | null;
  brand: string | null;
  unitLabel: string;
  stockQuantity: number | null;
  isFeatured: boolean;
  isVariableWeight: boolean;
  barcode: string | null;
  reorderLevel: number | null;
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
  readonly orderItems: { id: string; menuItemId: string }[] = [];
  readonly menuItems: MenuItemRecord[] = [];
  readonly orders: OrderRecord[] = [];
  readonly notifications: NotificationRecord[] = [];
  readonly auditLogs: AuditLogRecord[] = [];
  readonly offers: any[] = [];
  /** System roles, seeded by migration in a real database. */
  readonly roles: { id: string; key: string }[] = [
    { id: randomUUID(), key: "SUPER_ADMIN" },
    { id: randomUUID(), key: "BUSINESS_ADMIN" },
    { id: randomUUID(), key: "BUSINESS_STAFF" }
  ];
  readonly businessMembers: { businessId: string; userId: string; roleId: string; isActive: boolean }[] = [];
  private transactionTail: Promise<void> = Promise.resolve();

  readonly user = {} as any;
  readonly restaurant = {} as any;
  readonly menuCategory = {} as any;
  readonly menuItem = {} as any;
  readonly orderItem = {} as any;
  readonly order = {} as any;
  readonly notification = {} as any;
  readonly auditLog = {} as any;
  readonly offer = {} as any;
  readonly role = {} as any;
  readonly businessMember = {} as any;

  constructor() {
    this.offer.findMany = async () => this.offers;
    this.role.findUnique = async ({ where }: any) =>
      this.roles.find((role) => (where.key ? role.key === where.key : role.id === where.id)) ?? null;
    this.businessMember.findMany = async ({ where }: any) =>
      this.businessMembers.filter(
        (member) =>
          (where?.userId === undefined || member.userId === where.userId) &&
          (where?.businessId === undefined || member.businessId === where.businessId) &&
          (where?.isActive === undefined || member.isActive === where.isActive)
      );
    this.businessMember.upsert = async ({ where, create, update }: any) => {
      const key = where.businessId_userId;
      const existing = this.businessMembers.find(
        (member) => member.businessId === key.businessId && member.userId === key.userId
      );
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const member = {
        businessId: create.businessId,
        userId: create.userId,
        roleId: create.roleId,
        isActive: create.isActive ?? true
      };
      this.businessMembers.push(member);
      return member;
    };
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
          && (!where.businessType || restaurant.businessType === where.businessType)
      ) ?? null;
    this.restaurant.findMany = async ({ where, skip = 0, take }: any) => {
      const matches = this.restaurants
        .filter(
          (restaurant) =>
            (!where?.status || restaurant.status === where.status) &&
            (!where?.businessType || restaurant.businessType === where.businessType) &&
            (where?.isOpen === undefined || restaurant.isOpen === where.isOpen)
        )
        .sort((left, right) => left.name.localeCompare(right.name));
      return typeof take === "number" ? matches.slice(skip, skip + take) : matches.slice(skip);
    };
    this.restaurant.count = async ({ where }: any) =>
      this.restaurants.filter(
        (restaurant) =>
          (!where?.status || restaurant.status === where.status) &&
          (!where?.businessType || restaurant.businessType === where.businessType) &&
          (where?.isOpen === undefined || restaurant.isOpen === where.isOpen)
      ).length;
    this.restaurant.create = async ({ data }: any) => {
      const now = new Date();
      const restaurant: RestaurantRecord = {
        id: data.id ?? randomUUID(),
        ownerUserId: data.ownerUserId,
        name: data.name,
        businessType: data.businessType ?? BusinessType.RESTAURANT,
        description: data.description ?? null,
        phone: data.phone,
        status: data.status ?? RestaurantStatus.PENDING,
        isOpen: data.isOpen ?? false,
        opensAt: data.opensAt ?? null,
        closesAt: data.closesAt ?? null,
        addressLine: data.addressLine,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        showLocationToCustomer: data.showLocationToCustomer ?? false,
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
      if (data.latitude !== undefined) restaurant.latitude = data.latitude;
      if (data.longitude !== undefined) restaurant.longitude = data.longitude;
      if (data.showLocationToCustomer !== undefined) restaurant.showLocationToCustomer = data.showLocationToCustomer;
      if (data.isOpen !== undefined) restaurant.isOpen = data.isOpen;
      if (data.opensAt !== undefined) restaurant.opensAt = data.opensAt;
      if (data.closesAt !== undefined) restaurant.closesAt = data.closesAt;
      if (data.status !== undefined) restaurant.status = data.status;
      restaurant.updatedAt = new Date();
      return restaurant;
    };

    this.menuCategory.findUnique = async ({ where }: any) =>
      this.menuCategories.find((category) => category.id === where.id) ?? null;
    this.menuCategory.findFirst = async ({ where }: any) =>
      this.menuCategories.find((category) => {
        if (where.restaurantId && category.restaurantId !== where.restaurantId) return false;
        if (where.name !== undefined) {
          const target = typeof where.name === "object" ? where.name.equals : where.name;
          const insensitive = typeof where.name === "object" && where.name.mode === "insensitive";
          if (insensitive) {
            if (category.name.toLowerCase() !== String(target).toLowerCase()) return false;
          } else if (category.name !== target) {
            return false;
          }
        }
        if (where.sortOrder !== undefined && category.sortOrder !== where.sortOrder) return false;
        if (where.id?.not && category.id === where.id.not) return false;
        return true;
      }) ?? null;
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

    // Deletion is guarded by these counts, so the fake has to answer them.
    this.orderItem.count = async ({ where }: any) =>
      this.orderItems.filter((line) => line.menuItemId === where.menuItemId).length;
    this.menuItem.count = async ({ where }: any) =>
      this.menuItems.filter((item) => menuItemMatchesCatalogWhere(item, where)).length;
    this.menuItem.delete = async ({ where }: any) => {
      const index = this.menuItems.findIndex((item) => item.id === where.id);
      if (index < 0) throw new Error("missing menu item");
      return this.menuItems.splice(index, 1)[0];
    };
    this.menuCategory.delete = async ({ where }: any) => {
      const index = this.menuCategories.findIndex((category) => category.id === where.id);
      if (index < 0) throw new Error("missing menu category");
      return this.menuCategories.splice(index, 1)[0];
    };

    this.menuItem.findUnique = async ({ where }: any) =>
      this.menuItems.find((item) => item.id === where.id) ?? null;
    this.menuItem.findFirst = async ({ where }: any) => {
      const item = this.menuItems.find((candidate) =>
        (!where?.id || typeof where.id !== "string" || candidate.id === where.id) &&
        (!where?.restaurantId || candidate.restaurantId === where.restaurantId) &&
        (!where?.sku || candidate.sku === where.sku) &&
        (!where?.isAvailable || candidate.isAvailable) &&
        (where?.costPriceMinor?.not !== null || candidate.costPriceMinor !== null) &&
        (!where?.id?.not || candidate.id !== where.id.not)
      );
      if (!item) return null;
      if (where?.OR && item.stockQuantity === 0) return null;
      return item;
    };
    this.menuItem.findMany = async ({ where, orderBy, skip = 0, take, select }: any) => {
      let items = this.menuItems.filter((item) => menuItemMatchesCatalogWhere(item, where));
      const orderings = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [{ name: "asc" }];
      items = [...items].sort((left, right) => {
        for (const ordering of orderings) {
          if (ordering.isFeatured === "desc") {
            const diff = Number(right.isFeatured) - Number(left.isFeatured);
            if (diff !== 0) return diff;
          } else if (ordering.name === "asc") {
            const diff = left.name.localeCompare(right.name);
            if (diff !== 0) return diff;
          }
        }
        return 0;
      });
      const sliced = typeof take === "number" ? items.slice(skip, skip + take) : items.slice(skip);
      if (!select) return sliced;
      return sliced.map((item) => {
        const projected: Record<string, unknown> = {};
        for (const key of Object.keys(select)) projected[key] = (item as any)[key];
        return projected;
      });
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
        costPriceMinor: data.costPriceMinor ?? null,
        imageUrl: data.imageUrl ?? null,
        sku: data.sku ?? null,
        brand: data.brand ?? null,
        unitLabel: data.unitLabel ?? "item",
        stockQuantity: data.stockQuantity ?? null,
        isFeatured: data.isFeatured ?? false,
        isVariableWeight: data.isVariableWeight ?? false,
        barcode: data.barcode ?? null,
        reorderLevel: data.reorderLevel ?? null,
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
      if (data.costPriceMinor !== undefined) item.costPriceMinor = data.costPriceMinor;
      if (data.imageUrl !== undefined) item.imageUrl = data.imageUrl;
      if (data.sku !== undefined) item.sku = data.sku;
      if (data.brand !== undefined) item.brand = data.brand;
      if (data.unitLabel !== undefined) item.unitLabel = data.unitLabel;
      if (data.stockQuantity !== undefined) item.stockQuantity = data.stockQuantity;
      if (data.isFeatured !== undefined) item.isFeatured = data.isFeatured;
      if (data.isVariableWeight !== undefined) item.isVariableWeight = data.isVariableWeight;
      if (data.barcode !== undefined) item.barcode = data.barcode;
      if (data.reorderLevel !== undefined) item.reorderLevel = data.reorderLevel;
      if (data.isAvailable !== undefined) item.isAvailable = data.isAvailable;
      item.updatedAt = new Date();
      return item;
    };

    const orderMatchesWhere = (order: OrderRecord, where: any): boolean =>
      (!where?.restaurantId || order.restaurantId === where.restaurantId) &&
      (!where?.status || order.status === where.status) &&
      (where?.createdAt?.gte === undefined || order.createdAt.getTime() >= where.createdAt.gte.getTime());
    this.order.count = async ({ where }: any) =>
      this.orders.filter((order) => orderMatchesWhere(order, where)).length;
    this.order.aggregate = async ({ where, _sum }: any) => {
      const matches = this.orders.filter((order) => orderMatchesWhere(order, where));
      const sum: Record<string, number> = {};
      for (const key of Object.keys(_sum ?? {})) {
        sum[key] = matches.reduce((total, order) => total + ((order as any)[key] ?? 0), 0);
      }
      return { _sum: sum };
    };
    this.order.findMany = async ({ where, select, skip = 0, take, orderBy }: any) => {
      let matches = this.orders.filter((order) => orderMatchesWhere(order, where));
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

  /** Marks a product as having appeared on an order, which is what blocks deletion. */
  seedOrderItemFor(menuItemId: string): void {
    this.orderItems.push({ id: randomUUID(), menuItemId });
  }

  seedApprovedOpenRestaurant(overrides: Partial<RestaurantRecord> = {}): RestaurantRecord {
    const now = new Date();
    const restaurant: RestaurantRecord = {
      id: randomUUID(),
      ownerUserId: randomUUID(),
      name: "Falafel House",
      businessType: BusinessType.RESTAURANT,
      description: null,
      phone: "+970591234567",
      status: RestaurantStatus.APPROVED,
      isOpen: true,
      opensAt: null,
      closesAt: null,
      addressLine: "Al-Manara Square, Ramallah",
      latitude: 31.9038,
      longitude: 35.2034,
      showLocationToCustomer: false,
      logoUrl: null,
      createdAt: now,
      updatedAt: now,
      ...overrides
    };
    this.restaurants.push(restaurant);
    // Registration and the migration backfill both give the owner a membership, so a seeded
    // business has one too — otherwise business-wide notifications would reach nobody.
    this.businessMembers.push({
      businessId: restaurant.id,
      userId: restaurant.ownerUserId,
      roleId: this.roles.find((role) => role.key === "BUSINESS_ADMIN")!.id,
      isActive: true
    });
    return restaurant;
  }
}

/**
 * Matches the `where` shapes the supermarket catalog builds (`getSupermarketCatalog`):
 * restaurant + availability + category (equality or `{ in }`) + optional `isFeatured`,
 * plus the `AND` of the "in stock" clause and the case-insensitive name/description/brand/sku
 * search `OR`. Kept faithful so the search/pagination tests exercise real filtering.
 */
function menuItemMatchesCatalogWhere(item: MenuItemRecord, where: any): boolean {
  if (!where) return true;
  const contains = (value: string | null, needle: unknown) =>
    typeof value === "string" && value.toLowerCase().includes(String(needle).toLowerCase());
  if (where.restaurantId !== undefined && item.restaurantId !== where.restaurantId) return false;
  if (where.isAvailable !== undefined && item.isAvailable !== where.isAvailable) return false;
  // `costPriceMinor: { not: null }` — a supermarket product with no cost price is not orderable.
  if (where.costPriceMinor?.not === null && item.costPriceMinor === null) return false;
  if (where.isFeatured !== undefined && item.isFeatured !== where.isFeatured) return false;
  if (where.categoryId !== undefined) {
    if (typeof where.categoryId === "string") {
      if (item.categoryId !== where.categoryId) return false;
    } else if (where.categoryId.in && !where.categoryId.in.includes(item.categoryId)) {
      return false;
    }
  }
  const matchesOr = (or: any[]) =>
    or.some((cond) => {
      if ("stockQuantity" in cond) {
        if (cond.stockQuantity === null) return item.stockQuantity === null;
        if (cond.stockQuantity?.gt !== undefined) {
          return item.stockQuantity !== null && item.stockQuantity > cond.stockQuantity.gt;
        }
      }
      if (cond.name?.contains !== undefined) return contains(item.name, cond.name.contains);
      if (cond.description?.contains !== undefined) return contains(item.description, cond.description.contains);
      if (cond.brand?.contains !== undefined) return contains(item.brand, cond.brand.contains);
      if (cond.sku?.contains !== undefined) return contains(item.sku, cond.sku.contains);
      return false;
    });
  if (Array.isArray(where.AND)) {
    for (const clause of where.AND) {
      if (Array.isArray(clause.OR) && !matchesOr(clause.OR)) return false;
    }
  }
  if (Array.isArray(where.OR) && !matchesOr(where.OR)) return false;
  return true;
}

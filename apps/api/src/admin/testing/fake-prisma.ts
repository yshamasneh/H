import { randomUUID } from "node:crypto";
import { DeliveryStatus, DriverApprovalStatus, OrderStatus, RestaurantStatus, UserRole } from "../../generated/prisma/client";

type UserRecord = {
  id: string;
  fullName: string;
  phone: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  phoneVerifiedAt: Date | null;
  createdAt: Date;
};

type RestaurantRecord = { id: string; name: string; status: RestaurantStatus };

type OrderRecord = {
  id: string;
  restaurantId: string;
  status: OrderStatus;
  totalMinor: number;
  createdAt: Date;
};

type DeliveryRecord = { id: string; status: DeliveryStatus };

type DriverProfileRecord = { userId: string; status: DriverApprovalStatus; isOnline: boolean };

type OrderStatusHistoryRecord = {
  id: string;
  orderId: string;
  toStatus: OrderStatus;
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

function inFilter(actual: unknown, where: any): boolean {
  if (where === undefined) return true;
  if (typeof where === "object" && where !== null && "in" in where) return where.in.includes(actual);
  if (typeof where === "object" && where !== null && "notIn" in where) return !where.notIn.includes(actual);
  return actual === where;
}

export class FakeAdminPrisma {
  readonly users: UserRecord[] = [];
  readonly restaurants: RestaurantRecord[] = [];
  readonly orders: OrderRecord[] = [];
  readonly deliveries: DeliveryRecord[] = [];
  readonly driverProfiles: DriverProfileRecord[] = [];
  readonly orderStatusHistories: OrderStatusHistoryRecord[] = [];
  readonly auditLogs: AuditLogRecord[] = [];

  readonly user = {} as any;
  readonly restaurant = {} as any;
  readonly order = {} as any;
  readonly delivery = {} as any;
  readonly driverProfile = {} as any;
  readonly orderStatusHistory = {} as any;
  readonly auditLog = {} as any;

  constructor() {
    this.order.count = async ({ where }: any) =>
      this.orders.filter((order) => (!where?.createdAt?.gte || order.createdAt >= where.createdAt.gte)).length;
    this.order.findMany = async ({ where, select }: any) => {
      const matches = this.orders.filter(
        (order) =>
          (!where?.createdAt?.gte || order.createdAt >= where.createdAt.gte) &&
          inFilter(order.status, where?.status)
      );
      if (!select) return matches;
      return matches.map((order) => ({ totalMinor: order.totalMinor }));
    };

    this.delivery.count = async ({ where }: any) =>
      this.deliveries.filter((delivery) => inFilter(delivery.status, where?.status)).length;

    this.restaurant.count = async ({ where }: any) =>
      this.restaurants.filter((restaurant) => !where?.status || restaurant.status === where.status).length;

    this.driverProfile.count = async ({ where }: any) =>
      this.driverProfiles.filter(
        (profile) =>
          (where?.isOnline === undefined || profile.isOnline === where.isOnline) &&
          (!where?.status || profile.status === where.status)
      ).length;

    this.user.count = async ({ where }: any) =>
      this.users.filter(
        (user) =>
          (!where?.role || user.role === where.role) &&
          (!where?.createdAt?.gte || user.createdAt >= where.createdAt.gte) &&
          matchesSearch(user, where?.OR)
      ).length;

    this.user.findMany = async ({ where, skip = 0, take, orderBy }: any) => {
      let matches = this.users.filter(
        (user) =>
          (!where?.role || user.role === where.role) &&
          (!where?.createdAt?.gte || user.createdAt >= where.createdAt.gte) &&
          matchesSearch(user, where?.OR)
      );
      if (orderBy?.createdAt === "desc") {
        matches = [...matches].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
      }
      return typeof take === "number" ? matches.slice(skip, skip + take) : matches.slice(skip);
    };

    this.orderStatusHistory.findMany = async ({ orderBy, take }: any) => {
      let matches = [...this.orderStatusHistories];
      if (orderBy?.createdAt === "desc") {
        matches.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
      }
      matches = typeof take === "number" ? matches.slice(0, take) : matches;
      return matches.map((entry) => {
        const order = this.orders.find((candidate) => candidate.id === entry.orderId)!;
        const restaurant = this.restaurants.find((candidate) => candidate.id === order.restaurantId)!;
        return { ...entry, order: { ...order, restaurant } };
      });
    };

    this.auditLog.findMany = async ({ where, skip = 0, take, orderBy }: any) => {
      let matches = this.auditLogs.filter(
        (entry) =>
          (!where?.actorUserId || entry.actorUserId === where.actorUserId) &&
          (!where?.action || entry.action === where.action) &&
          (!where?.createdAt?.gte || entry.createdAt >= where.createdAt.gte) &&
          (!where?.createdAt?.lte || entry.createdAt <= where.createdAt.lte)
      );
      if (orderBy?.createdAt === "desc") {
        matches = [...matches].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
      }
      const sliced = typeof take === "number" ? matches.slice(skip, skip + take) : matches.slice(skip);
      return sliced.map((entry) => ({ ...entry, actor: this.users.find((user) => user.id === entry.actorUserId)! }));
    };

    this.auditLog.count = async ({ where }: any) =>
      this.auditLogs.filter(
        (entry) =>
          (!where?.actorUserId || entry.actorUserId === where.actorUserId) &&
          (!where?.action || entry.action === where.action) &&
          (!where?.createdAt?.gte || entry.createdAt >= where.createdAt.gte) &&
          (!where?.createdAt?.lte || entry.createdAt <= where.createdAt.lte)
      ).length;
  }

  seedUser(overrides: Partial<UserRecord> = {}): UserRecord {
    const user: UserRecord = {
      id: randomUUID(),
      fullName: "Test User",
      phone: `+97059${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
      passwordHash: "hash",
      role: UserRole.CUSTOMER,
      isActive: true,
      phoneVerifiedAt: new Date(),
      createdAt: new Date(),
      ...overrides
    };
    this.users.push(user);
    return user;
  }

  seedRestaurant(overrides: Partial<RestaurantRecord> = {}): RestaurantRecord {
    const restaurant: RestaurantRecord = { id: randomUUID(), name: "Falafel House", status: RestaurantStatus.APPROVED, ...overrides };
    this.restaurants.push(restaurant);
    return restaurant;
  }

  seedOrder(restaurantId: string, overrides: Partial<OrderRecord> = {}): OrderRecord {
    const order: OrderRecord = {
      id: randomUUID(),
      restaurantId,
      status: OrderStatus.DELIVERED,
      totalMinor: 2000,
      createdAt: new Date(),
      ...overrides
    };
    this.orders.push(order);
    return order;
  }

  seedDelivery(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
    const delivery: DeliveryRecord = { id: randomUUID(), status: DeliveryStatus.ASSIGNED, ...overrides };
    this.deliveries.push(delivery);
    return delivery;
  }

  seedDriverProfile(overrides: Partial<DriverProfileRecord> = {}): DriverProfileRecord {
    const profile: DriverProfileRecord = {
      userId: randomUUID(),
      status: DriverApprovalStatus.APPROVED,
      isOnline: true,
      ...overrides
    };
    this.driverProfiles.push(profile);
    return profile;
  }

  seedOrderStatusHistory(orderId: string, overrides: Partial<OrderStatusHistoryRecord> = {}): OrderStatusHistoryRecord {
    const entry: OrderStatusHistoryRecord = {
      id: randomUUID(),
      orderId,
      toStatus: OrderStatus.PLACED,
      createdAt: new Date(),
      ...overrides
    };
    this.orderStatusHistories.push(entry);
    return entry;
  }

  seedAuditLog(overrides: Partial<AuditLogRecord> = {}): AuditLogRecord {
    const entry: AuditLogRecord = {
      id: randomUUID(),
      actorUserId: randomUUID(),
      action: "RESTAURANT_APPROVED",
      entityType: "Restaurant",
      entityId: randomUUID(),
      reason: null,
      metadataJson: null,
      createdAt: new Date(),
      ...overrides
    };
    this.auditLogs.push(entry);
    return entry;
  }
}

function matchesSearch(user: UserRecord, orClauses: any[] | undefined): boolean {
  if (!orClauses) return true;
  return orClauses.some((clause) => {
    if (clause.fullName) return user.fullName.toLowerCase().includes(String(clause.fullName.contains).toLowerCase());
    if (clause.phone) return user.phone.includes(clause.phone.contains);
    return false;
  });
}

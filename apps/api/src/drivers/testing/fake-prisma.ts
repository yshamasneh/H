import { randomUUID } from "node:crypto";
import { DeliveryStatus, DriverApprovalStatus, OrderStatus, UserRole } from "../../generated/prisma/client";

type UserRecord = {
  id: string;
  fullName: string;
  phone: string;
  passwordHash: string;
  role: UserRole;
  phoneVerifiedAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type DriverProfileRecord = {
  userId: string;
  status: DriverApprovalStatus;
  isOnline: boolean;
  lastLatitude: number | null;
  lastLongitude: number | null;
  createdAt: Date;
  updatedAt: Date;
};

type RestaurantRecord = {
  id: string;
  name: string;
  addressLine: string;
};

type OrderRecord = {
  id: string;
  customerId: string;
  restaurantId: string;
  status: OrderStatus;
  deliveryLabel: string;
  deliveryAddressLine: string;
  totalMinor: number;
  paymentMethod: "CASH";
};

type OrderStatusHistoryRecord = {
  id: string;
  orderId: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  changedByUserId: string;
  note: string | null;
  createdAt: Date;
};

type DeliveryRecord = {
  id: string;
  orderId: string;
  driverId: string | null;
  status: DeliveryStatus;
  assignedAt: Date | null;
  pickedUpAt: Date | null;
  onTheWayAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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

function matchesStatus(actual: unknown, where: unknown): boolean {
  if (where === undefined) return true;
  if (typeof where === "object" && where !== null && "in" in (where as Record<string, unknown>)) {
    return ((where as { in: unknown[] }).in).includes(actual);
  }
  return actual === where;
}

export class FakeDriversPrisma {
  readonly users: UserRecord[] = [];
  readonly driverProfiles: DriverProfileRecord[] = [];
  readonly restaurants: RestaurantRecord[] = [];
  readonly orders: OrderRecord[] = [];
  readonly orderStatusHistories: OrderStatusHistoryRecord[] = [];
  readonly deliveries: DeliveryRecord[] = [];
  readonly notifications: NotificationRecord[] = [];
  readonly auditLogs: AuditLogRecord[] = [];
  private transactionTail: Promise<void> = Promise.resolve();

  readonly user = {} as any;
  readonly driverProfile = {} as any;
  readonly order = {} as any;
  readonly orderStatusHistory = {} as any;
  readonly delivery = {} as any;
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
        passwordHash: data.passwordHash,
        role: data.role,
        phoneVerifiedAt: data.phoneVerifiedAt ?? null,
        isActive: data.isActive ?? true,
        createdAt: now,
        updatedAt: now
      };
      this.users.push(user);
      return user;
    };

    this.driverProfile.create = async ({ data }: any) => {
      const now = new Date();
      const profile: DriverProfileRecord = {
        userId: data.userId,
        status: data.status ?? DriverApprovalStatus.PENDING,
        isOnline: data.isOnline ?? false,
        lastLatitude: data.lastLatitude ?? null,
        lastLongitude: data.lastLongitude ?? null,
        createdAt: now,
        updatedAt: now
      };
      this.driverProfiles.push(profile);
      return profile;
    };
    this.driverProfile.findUnique = async ({ where, include }: any) => {
      const profile = this.driverProfiles.find((candidate) => candidate.userId === where.userId) ?? null;
      if (!profile) return null;
      return include?.user ? { ...profile, user: this.users.find((user) => user.id === profile.userId)! } : profile;
    };
    this.driverProfile.findMany = async ({ include, orderBy }: any) => {
      let matches = [...this.driverProfiles];
      if (orderBy?.createdAt === "desc") {
        matches.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
      } else if (orderBy?.createdAt === "asc") {
        matches.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
      }
      return matches.map((profile) =>
        include?.user ? { ...profile, user: this.users.find((user) => user.id === profile.userId)! } : profile
      );
    };
    this.driverProfile.update = async ({ where, data, include }: any) => {
      const profile = this.driverProfiles.find((candidate) => candidate.userId === where.userId);
      if (!profile) throw new Error("missing driver profile");
      if (data.isOnline !== undefined) profile.isOnline = data.isOnline;
      if (data.status !== undefined) profile.status = data.status;
      profile.updatedAt = new Date();
      return include?.user ? { ...profile, user: this.users.find((user) => user.id === profile.userId)! } : profile;
    };

    this.order.findUnique = async ({ where }: any) => this.orders.find((order) => order.id === where.id) ?? null;
    this.order.update = async ({ where, data }: any) => {
      const order = this.orders.find((candidate) => candidate.id === where.id);
      if (!order) throw new Error("missing order");
      if (data.status !== undefined) order.status = data.status;
      return order;
    };

    this.orderStatusHistory.create = async ({ data }: any) => {
      const entry: OrderStatusHistoryRecord = {
        id: randomUUID(),
        orderId: data.orderId,
        fromStatus: data.fromStatus ?? null,
        toStatus: data.toStatus,
        changedByUserId: data.changedByUserId,
        note: data.note ?? null,
        createdAt: new Date()
      };
      this.orderStatusHistories.push(entry);
      return entry;
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

    this.delivery.findUnique = async ({ where }: any) => {
      const found = this.deliveries.find((delivery) =>
        where.id ? delivery.id === where.id : delivery.orderId === where.orderId
      );
      return found ? this.hydrateDelivery(found) : null;
    };

    this.delivery.findMany = async ({ where, orderBy, skip = 0, take }: any) => {
      let matches = this.deliveries.filter(
        (delivery) =>
          matchesStatus(delivery.status, where?.status) &&
          (!where?.driverId ||
            (typeof where.driverId === "object" && where.driverId !== null && "in" in where.driverId
              ? where.driverId.in.includes(delivery.driverId)
              : delivery.driverId === where.driverId))
      );
      if (orderBy?.createdAt === "desc") {
        matches = [...matches].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
      } else if (orderBy?.createdAt === "asc") {
        matches = [...matches].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
      }
      const sliced = typeof take === "number" ? matches.slice(skip, skip + take) : matches.slice(skip);
      return sliced.map((delivery) => this.hydrateDelivery(delivery));
    };

    this.delivery.count = async ({ where }: any) =>
      this.deliveries.filter(
        (delivery) => matchesStatus(delivery.status, where?.status) && (!where?.driverId || delivery.driverId === where.driverId)
      ).length;

    this.delivery.updateMany = async ({ where, data }: any) => {
      const matches = this.deliveries.filter(
        (delivery) =>
          delivery.id === where.id &&
          (!where.status || delivery.status === where.status) &&
          (where.driverId !== null || delivery.driverId === null)
      );
      for (const delivery of matches) {
        Object.assign(delivery, data);
        delivery.updatedAt = new Date();
      }
      return { count: matches.length };
    };
  }

  private hydrateDelivery(delivery: DeliveryRecord) {
    const order = this.orders.find((candidate) => candidate.id === delivery.orderId)!;
    const restaurant = this.restaurants.find((candidate) => candidate.id === order.restaurantId)!;
    return { ...delivery, order: { ...order, restaurant } };
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

  seedRestaurant(overrides: Partial<RestaurantRecord> = {}): RestaurantRecord {
    const restaurant: RestaurantRecord = {
      id: randomUUID(),
      name: "Falafel House",
      addressLine: "Al-Manara Square, Ramallah",
      ...overrides
    };
    this.restaurants.push(restaurant);
    return restaurant;
  }

  seedOrder(restaurantId: string, overrides: Partial<OrderRecord> = {}): OrderRecord {
    const order: OrderRecord = {
      id: randomUUID(),
      customerId: randomUUID(),
      restaurantId,
      status: OrderStatus.READY_FOR_PICKUP,
      deliveryLabel: "Home",
      deliveryAddressLine: "Al-Manara Square, Ramallah",
      totalMinor: 3200,
      paymentMethod: "CASH",
      ...overrides
    };
    this.orders.push(order);
    return order;
  }

  seedDelivery(orderId: string, overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
    const now = new Date();
    const delivery: DeliveryRecord = {
      id: randomUUID(),
      orderId,
      driverId: null,
      status: DeliveryStatus.PENDING_ASSIGNMENT,
      assignedAt: null,
      pickedUpAt: null,
      onTheWayAt: null,
      deliveredAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides
    };
    this.deliveries.push(delivery);
    return delivery;
  }

  seedDriver(overrides: Partial<UserRecord & DriverProfileRecord> = {}): { userId: string } {
    const now = new Date();
    const userId = overrides.id ?? overrides.userId ?? randomUUID();
    this.users.push({
      id: userId,
      fullName: "Driver",
      phone: `+97059${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
      passwordHash: "hash",
      role: UserRole.DRIVER,
      phoneVerifiedAt: now,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides
    });
    this.driverProfiles.push({
      userId,
      status: overrides.status ?? DriverApprovalStatus.APPROVED,
      isOnline: overrides.isOnline ?? true,
      lastLatitude: null,
      lastLongitude: null,
      createdAt: now,
      updatedAt: now
    });
    return { userId };
  }
}

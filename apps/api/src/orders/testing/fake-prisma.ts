import { randomUUID } from "node:crypto";
import {
  BusinessType,
  DeliveryStatus,
  FulfillmentAdjustmentStatus,
  OrderPaymentMethod,
  OrderStatus,
  Prisma,
  RestaurantStatus
} from "../../generated/prisma/client";
import { FakeAccountingStore } from "../../accounting/testing/fake-accounting-prisma";

type RestaurantRecord = {
  id: string;
  ownerUserId: string;
  name: string;
  businessType: BusinessType;
  status: RestaurantStatus;
  isOpen: boolean;
  opensAt: string | null;
  closesAt: string | null;
  latitude: number | null;
  longitude: number | null;
  isPromotionalPartner: boolean;
};

type MenuItemRecord = {
  id: string;
  restaurantId: string;
  name: string;
  priceMinor: number;
  isAvailable: boolean;
  unitLabel: string;
  stockQuantity: number | null;
  isVariableWeight: boolean;
};

type OrderItemRecord = {
  id: string;
  orderId: string;
  menuItemId: string;
  nameSnapshot: string;
  priceMinorSnapshot: number;
  quantity: number;
  unitLabelSnapshot: string;
  allowSubstitution: boolean;
  isVariableWeightSnapshot: boolean;
};

type FulfillmentAdjustmentRecord = {
  id: string;
  orderItemId: string;
  replacementMenuItemId: string | null;
  proposedByUserId: string;
  replacementNameSnapshot: string | null;
  replacementUnitLabelSnapshot: string | null;
  actualQuantityMilli: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  status: FulfillmentAdjustmentStatus;
  note: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type OrderRecord = {
  id: string;
  customerId: string;
  restaurantId: string;
  status: OrderStatus;
  paymentMethod: OrderPaymentMethod;
  deliveryLabel: string;
  deliveryAddressLine: string;
  deliveryLatitude: number | null;
  deliveryLongitude: number | null;
  deliveryDistanceMeters: number | null;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  serviceFeeMinor: number;
  discountMinor: number;
  merchandiseDiscountMinor: number;
  deliveryDiscountMinor: number;
  promotionSnapshot: unknown;
  idempotencyKey: string | null;
  totalMinor: number;
  acceptedByUserId: string | null;
  acceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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
  failedAt: Date | null;
  cancelledAt: Date | null;
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

function matchesOrderFilters(order: OrderRecord, where: any): boolean {
  if (!where) return true;
  if (where.customerId && order.customerId !== where.customerId) return false;
  if (where.restaurantId && order.restaurantId !== where.restaurantId) return false;
  if (where.status?.in) { if (!where.status.in.includes(order.status)) return false; }
  else if (where.status && order.status !== where.status) return false;
  if (where.createdAt?.gte && order.createdAt < where.createdAt.gte) return false;
  if (where.createdAt?.lte && order.createdAt > where.createdAt.lte) return false;
  return true;
}

export class FakeOrdersPrisma {
  readonly restaurants: RestaurantRecord[] = [];
  readonly menuItems: MenuItemRecord[] = [];
  readonly orders: OrderRecord[] = [];
  readonly orderItems: OrderItemRecord[] = [];
  readonly orderStatusHistories: OrderStatusHistoryRecord[] = [];
  readonly deliveries: DeliveryRecord[] = [];
  readonly notifications: NotificationRecord[] = [];
  readonly auditLogs: AuditLogRecord[] = [];
  readonly offers: any[] = [];
  readonly fulfillmentAdjustments: FulfillmentAdjustmentRecord[] = [];
  readonly inventoryMovements: any[] = [];
  readonly businessMembers: { businessId: string; userId: string; isActive: boolean }[] = [];
  private transactionTail: Promise<void> = Promise.resolve();

  readonly restaurant = {} as any;
  /** The accounting tables, so order creation really does stamp the rates it was taken under. */
  readonly accounting = new FakeAccountingStore();
  readonly financialRateSet = this.accounting.financialRateSet;
  readonly partnerAccount = this.accounting.partnerAccount;
  readonly orderFinancialRecord = this.accounting.orderFinancialRecord;
  readonly partnerEarning = this.accounting.partnerEarning;
  readonly menuItem = {} as any;
  readonly order = {} as any;
  readonly orderStatusHistory = {} as any;
  readonly orderItem = {} as any;
  readonly delivery = {} as any;
  readonly driverProfile = {} as any;
  readonly notification = {} as any;
  readonly auditLog = {} as any;
  readonly offer = {} as any;
  readonly fulfillmentAdjustment = {} as any;
  readonly inventoryMovement = {} as any;
  readonly businessMember = {} as any;

  constructor() {
    // Business access is resolved through membership, so seeding a business implies a membership
    // for its owner exactly as the real migration backfill and registration flow do.
    this.businessMember.findMany = async ({ where }: any) =>
      this.businessMembers.filter(
        (member) =>
          (where?.userId === undefined || member.userId === where.userId) &&
          (where?.businessId === undefined || member.businessId === where.businessId) &&
          (where?.isActive === undefined || member.isActive === where.isActive)
      );

    this.restaurant.findUnique = async ({ where }: any) =>
      this.restaurants.find((restaurant) =>
        where.id ? restaurant.id === where.id : restaurant.ownerUserId === where.ownerUserId
      ) ?? null;

    this.menuItem.findMany = async ({ where }: any) => {
      const ids: string[] | undefined = where?.id?.in;
      return this.menuItems.filter(
        (item) => (!ids || ids.includes(item.id)) && (!where?.restaurantId || item.restaurantId === where.restaurantId)
      );
    };
    this.menuItem.findUnique = async ({ where }: any) => {
      const item = this.menuItems.find((candidate) => candidate.id === where.id) ?? null;
      if (!item) return null;
      if (where.select) {
        const selected: Record<string, unknown> = {};
        for (const key of Object.keys(where.select)) selected[key] = (item as any)[key];
        return selected;
      }
      return item;
    };
    this.menuItem.findFirst = async ({ where }: any) =>
      this.menuItems.find((item) =>
        (!where?.id || item.id === where.id) &&
        (!where?.restaurantId || item.restaurantId === where.restaurantId) &&
        (where?.isAvailable === undefined || item.isAvailable === where.isAvailable)
      ) ?? null;
    this.menuItem.updateMany = async ({ where, data }: any) => {
      const matches = this.menuItems.filter((item) =>
        (!where?.id || item.id === where.id) &&
        (where?.stockQuantity?.gte === undefined || (item.stockQuantity ?? -1) >= where.stockQuantity.gte) &&
        (where?.stockQuantity?.not !== null || item.stockQuantity !== null)
      );
      for (const item of matches) {
        if (data.stockQuantity?.decrement !== undefined && item.stockQuantity !== null) {
          item.stockQuantity -= data.stockQuantity.decrement;
        }
        if (data.stockQuantity?.increment !== undefined && item.stockQuantity !== null) {
          item.stockQuantity += data.stockQuantity.increment;
        }
      }
      return { count: matches.length };
    };

    this.offer.findMany = async ({ where }: any) => {
      // Re-fetch by id (used when re-deriving discounts after a substitution).
      if (where?.id?.in) {
        return this.offers.filter((offer) => where.id.in.includes(offer.id));
      }
      const now = new Date();
      return this.offers.filter((offer) =>
        (!where?.isActive || offer.isActive) &&
        (!offer.startsAt || offer.startsAt <= (where?.startsAt?.lte ?? now)) &&
        (!offer.endsAt || offer.endsAt > now) &&
        (offer.restaurantId === null || offer.restaurantId === where?.AND?.[0]?.OR?.[1]?.restaurantId)
      );
    };

    this.order.create = async ({ data }: any) => {
      // Model the (customerId, idempotencyKey) unique index — NULL keys don't collide.
      if (
        data.idempotencyKey != null &&
        this.orders.some((existing) => existing.customerId === data.customerId && existing.idempotencyKey === data.idempotencyKey)
      ) {
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "test",
          meta: { target: ["customerId", "idempotencyKey"] }
        });
      }
      const now = new Date();
      const order: OrderRecord = {
        id: data.id ?? randomUUID(),
        customerId: data.customerId,
        idempotencyKey: data.idempotencyKey ?? null,
        restaurantId: data.restaurantId,
        status: data.status ?? OrderStatus.PLACED,
        paymentMethod: data.paymentMethod,
        deliveryLabel: data.deliveryLabel,
        deliveryAddressLine: data.deliveryAddressLine,
        deliveryLatitude: data.deliveryLatitude ?? null,
        deliveryLongitude: data.deliveryLongitude ?? null,
        deliveryDistanceMeters: data.deliveryDistanceMeters ?? null,
        subtotalMinor: data.subtotalMinor,
        deliveryFeeMinor: data.deliveryFeeMinor,
        // Retained on the model for pre-removal orders; new orders never set it.
        serviceFeeMinor: data.serviceFeeMinor ?? 0,
        discountMinor: data.discountMinor ?? 0,
        merchandiseDiscountMinor: data.merchandiseDiscountMinor ?? 0,
        deliveryDiscountMinor: data.deliveryDiscountMinor ?? 0,
        promotionSnapshot: data.promotionSnapshot ?? null,
        totalMinor: data.totalMinor,
        acceptedByUserId: data.acceptedByUserId ?? null,
        acceptedAt: data.acceptedAt ?? null,
        createdAt: now,
        updatedAt: now
      };
      this.orders.push(order);

      const itemsToCreate: any[] = data.items?.create ?? [];
      for (const itemData of itemsToCreate) {
        this.orderItems.push({
          id: randomUUID(),
          orderId: order.id,
          menuItemId: itemData.menuItemId,
          nameSnapshot: itemData.nameSnapshot,
          priceMinorSnapshot: itemData.priceMinorSnapshot,
          quantity: itemData.quantity,
          unitLabelSnapshot: itemData.unitLabelSnapshot ?? "item",
          allowSubstitution: itemData.allowSubstitution ?? false,
          isVariableWeightSnapshot: itemData.isVariableWeightSnapshot ?? false
        });
      }

      return this.hydrateOrder(order);
    };

    this.order.findUnique = async ({ where }: any) => {
      const order = where.customerId_idempotencyKey
        ? this.orders.find(
            (candidate) =>
              candidate.customerId === where.customerId_idempotencyKey.customerId &&
              candidate.idempotencyKey === where.customerId_idempotencyKey.idempotencyKey
          )
        : this.orders.find((candidate) => candidate.id === where.id);
      return order ? this.hydrateOrder(order) : null;
    };

    this.order.findMany = async ({ where, orderBy, skip = 0, take }: any) => {
      let matches = this.orders.filter((order) => matchesOrderFilters(order, where));
      if (orderBy?.createdAt === "desc") {
        matches = [...matches].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
      } else if (orderBy?.createdAt === "asc") {
        matches = [...matches].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
      }
      const sliced = typeof take === "number" ? matches.slice(skip, skip + take) : matches.slice(skip);
      return sliced.map((order) => this.hydrateOrder(order));
    };

    this.order.count = async ({ where }: any) => this.orders.filter((order) => matchesOrderFilters(order, where)).length;

    this.order.updateMany = async ({ where, data }: any) => {
      const matches = this.orders.filter(
        (order) => order.id === where.id && (!where.status || order.status === where.status)
      );
      for (const order of matches) {
        if (data.status !== undefined) order.status = data.status;
        if (data.subtotalMinor !== undefined) order.subtotalMinor = data.subtotalMinor;
        if (data.totalMinor !== undefined) order.totalMinor = data.totalMinor;
        if (data.acceptedByUserId !== undefined) order.acceptedByUserId = data.acceptedByUserId;
        if (data.acceptedAt !== undefined) order.acceptedAt = data.acceptedAt;
        order.updatedAt = new Date();
      }
      return { count: matches.length };
    };
    this.order.update = async ({ where, data }: any) => {
      const order = this.orders.find((candidate) => candidate.id === where.id)!;
      if (data.status !== undefined) order.status = data.status;
      if (data.subtotalMinor !== undefined) order.subtotalMinor = data.subtotalMinor;
      if (data.totalMinor !== undefined) order.totalMinor = data.totalMinor;
      if (data.merchandiseDiscountMinor !== undefined) order.merchandiseDiscountMinor = data.merchandiseDiscountMinor;
      if (data.deliveryDiscountMinor !== undefined) order.deliveryDiscountMinor = data.deliveryDiscountMinor;
      if (data.discountMinor !== undefined) order.discountMinor = data.discountMinor;
      if (data.promotionSnapshot !== undefined) order.promotionSnapshot = data.promotionSnapshot;
      order.updatedAt = new Date();
      return this.hydrateOrder(order);
    };

    this.orderStatusHistory.create = async ({ data }: any) => {
      const entry: OrderStatusHistoryRecord = {
        id: randomUUID(),
        orderId: data.orderId,
        fromStatus: data.fromStatus ?? null,
        toStatus: data.toStatus,
        changedByUserId: data.changedByUserId,
        note: data.note ?? null,
        createdAt: new Date(Date.now() + this.orderStatusHistories.length)
      };
      this.orderStatusHistories.push(entry);
      return entry;
    };

    this.orderStatusHistory.findMany = async ({ where }: any) =>
      this.orderStatusHistories.filter((entry) => !where?.orderId || entry.orderId === where.orderId);

    this.orderItem.findMany = async ({ where }: any) =>
      this.orderItems
        .filter((item) => !where?.orderId || item.orderId === where.orderId)
        .map((item) => ({
          ...item,
          fulfillmentAdjustment: this.fulfillmentAdjustments.find((entry) => entry.orderItemId === item.id) ?? null
        }));
    this.orderItem.findUnique = async ({ where }: any) => {
      const item = this.orderItems.find((candidate) => candidate.id === where.id);
      if (!item) return null;
      return {
        ...item,
        menuItem: this.menuItems.find((candidate) => candidate.id === item.menuItemId),
        fulfillmentAdjustment: this.fulfillmentAdjustments.find((entry) => entry.orderItemId === item.id) ?? null
      };
    };

    this.fulfillmentAdjustment.count = async ({ where }: any) =>
      this.fulfillmentAdjustments.filter((entry) => {
        if (where?.status && entry.status !== where.status) return false;
        if (where?.orderItem?.orderId) {
          const orderItem = this.orderItems.find((item) => item.id === entry.orderItemId);
          if (orderItem?.orderId !== where.orderItem.orderId) return false;
        }
        return true;
      }).length;
    this.fulfillmentAdjustment.upsert = async ({ where, create, update }: any) => {
      let entry = this.fulfillmentAdjustments.find((candidate) => candidate.orderItemId === where.orderItemId);
      if (entry) {
        Object.assign(entry, update, { updatedAt: new Date() });
        return entry;
      }
      const now = new Date();
      entry = {
        id: randomUUID(),
        orderItemId: create.orderItemId,
        replacementMenuItemId: create.replacementMenuItemId ?? null,
        proposedByUserId: create.proposedByUserId,
        replacementNameSnapshot: create.replacementNameSnapshot ?? null,
        replacementUnitLabelSnapshot: create.replacementUnitLabelSnapshot ?? null,
        actualQuantityMilli: create.actualQuantityMilli,
        unitPriceMinor: create.unitPriceMinor,
        lineTotalMinor: create.lineTotalMinor,
        status: create.status ?? FulfillmentAdjustmentStatus.PENDING,
        note: create.note ?? null,
        decidedAt: create.decidedAt ?? null,
        createdAt: now,
        updatedAt: now
      };
      this.fulfillmentAdjustments.push(entry);
      return entry;
    };
    this.fulfillmentAdjustment.findUnique = async ({ where }: any) => {
      const entry = this.fulfillmentAdjustments.find((candidate) =>
        where.id ? candidate.id === where.id : candidate.orderItemId === where.orderItemId
      );
      if (!entry) return null;
      const orderItem = this.orderItems.find((item) => item.id === entry.orderItemId)!;
      return {
        ...entry,
        orderItem: {
          ...orderItem,
          menuItem: this.menuItems.find((item) => item.id === orderItem.menuItemId)
        }
      };
    };
    this.fulfillmentAdjustment.update = async ({ where, data }: any) => {
      const entry = this.fulfillmentAdjustments.find((candidate) => candidate.id === where.id)!;
      Object.assign(entry, data, { updatedAt: new Date() });
      return entry;
    };

    this.inventoryMovement.create = async ({ data }: any) => {
      const movement = { id: randomUUID(), createdAt: new Date(), ...data };
      this.inventoryMovements.push(movement);
      return movement;
    };

    this.delivery.create = async ({ data }: any) => {
      const now = new Date();
      const delivery: DeliveryRecord = {
        id: data.id ?? randomUUID(),
        orderId: data.orderId,
        driverId: data.driverId ?? null,
        status: data.status ?? DeliveryStatus.PENDING_ASSIGNMENT,
        assignedAt: data.assignedAt ?? null,
        pickedUpAt: data.pickedUpAt ?? null,
        onTheWayAt: data.onTheWayAt ?? null,
        deliveredAt: data.deliveredAt ?? null,
        failedAt: data.failedAt ?? null,
        cancelledAt: data.cancelledAt ?? null,
        createdAt: now,
        updatedAt: now
      };
      this.deliveries.push(delivery);
      return delivery;
    };

    this.delivery.findUnique = async ({ where }: any) =>
      this.deliveries.find((candidate) =>
        where.id ? candidate.id === where.id : candidate.orderId === where.orderId
      ) ?? null;

    this.delivery.findMany = async ({ where }: any) =>
      this.deliveries.filter(
        (delivery) =>
          (!where?.status || delivery.status === where.status) &&
          (!where?.driverId || delivery.driverId === where.driverId)
      );

    this.delivery.updateMany = async ({ where, data }: any) => {
      const matches = this.deliveries.filter(
        (delivery) =>
          (where.id === undefined || delivery.id === where.id) &&
          (where.orderId === undefined || delivery.orderId === where.orderId) &&
          (where.status?.notIn
            ? !where.status.notIn.includes(delivery.status)
            : !where.status || delivery.status === where.status) &&
          (where.driverId !== null || delivery.driverId === null)
      );
      for (const delivery of matches) {
        Object.assign(delivery, data);
        delivery.updatedAt = new Date();
      }
      return { count: matches.length };
    };

    this.driverProfile.findUnique = async () => null;

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

  private hydrateOrder(order: OrderRecord) {
    const restaurant = this.restaurants.find((candidate) => candidate.id === order.restaurantId)!;
    const items = this.orderItems
      .filter((item) => item.orderId === order.id)
      .map((item) => ({
        ...item,
        fulfillmentAdjustment: this.fulfillmentAdjustments.find((entry) => entry.orderItemId === item.id) ?? null
      }));
    const statusHistory = this.orderStatusHistories.filter((entry) => entry.orderId === order.id);
    const delivery = this.deliveries.find((candidate) => candidate.orderId === order.id) ?? null;
    return { ...order, items, restaurant, statusHistory, delivery };
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
      ownerUserId: randomUUID(),
      name: "Falafel House",
      businessType: BusinessType.RESTAURANT,
      status: RestaurantStatus.APPROVED,
      isOpen: true,
      opensAt: null,
      closesAt: null,
      latitude: 31.9038,
      longitude: 35.2034,
      isPromotionalPartner: false,
      ...overrides
    };
    this.restaurants.push(restaurant);
    this.businessMembers.push({ businessId: restaurant.id, userId: restaurant.ownerUserId, isActive: true });
    return restaurant;
  }

  /** A live offer. `restaurantId: null` is a platform-funded offer; a value is business-funded. */
  seedOffer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const offer = {
      id: randomUUID(),
      type: "ORDER_PERCENTAGE",
      restaurantId: null,
      menuItemId: null,
      title: "Test offer",
      discountPercent: 10,
      minimumSubtotalMinor: 0,
      maxDiscountMinor: null,
      isActive: true,
      startsAt: new Date(Date.now() - 1_000),
      endsAt: null,
      ...overrides
    };
    this.offers.push(offer);
    return offer;
  }

  /** Adds a second person to a business, the way the staff endpoints do. */
  seedBusinessMember(businessId: string, userId: string = randomUUID()): { businessId: string; userId: string } {
    this.businessMembers.push({ businessId, userId, isActive: true });
    return { businessId, userId };
  }

  seedMenuItem(restaurantId: string, overrides: Partial<MenuItemRecord> = {}): MenuItemRecord {
    const item: MenuItemRecord = {
      id: randomUUID(),
      restaurantId,
      name: "Falafel Sandwich",
      priceMinor: 1500,
      isAvailable: true,
      unitLabel: "item",
      stockQuantity: null,
      isVariableWeight: false,
      ...overrides
    };
    this.menuItems.push(item);
    return item;
  }
}

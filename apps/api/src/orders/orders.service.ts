import { Injectable } from "@nestjs/common";
import { writeAuditLog } from "../common/audit-log.util";
import { ApiException } from "../common/api.exception";
import {
  DeliveryStatus,
  NotificationType,
  OrderStatus,
  Prisma,
  RestaurantStatus,
  type Delivery,
  type Order,
  type OrderItem,
  type OrderStatusHistory,
  type Restaurant
} from "../generated/prisma/client";
import { createNotification } from "../notifications/notification.util";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import type { AdminOrdersFilterDto, CreateOrderDto, RestaurantOrderStatusAction } from "./orders.dto";
import type { Page } from "./orders.types";
import type { OrderDetailView } from "./orders.types";
import { calculateOrderFees } from "./pricing";

const cancellableByAdminStatuses: OrderStatus[] = [
  OrderStatus.PLACED,
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP
];

type OrderWithRelations = Order & {
  items: OrderItem[];
  restaurant: Restaurant;
  statusHistory: OrderStatusHistory[];
  delivery: Delivery | null;
};

const orderInclude = {
  items: true,
  restaurant: true,
  statusHistory: { orderBy: { createdAt: "asc" as const } },
  delivery: true
} as const;

const restaurantStatusTransitions: Record<RestaurantOrderStatusAction, OrderStatus> = {
  ACCEPTED: OrderStatus.ACCEPTED,
  PREPARING: OrderStatus.PREPARING,
  READY_FOR_PICKUP: OrderStatus.READY_FOR_PICKUP,
  REJECTED: OrderStatus.REJECTED
};

const allowedOrderTransitions: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PLACED]: [OrderStatus.ACCEPTED, OrderStatus.REJECTED, OrderStatus.CANCELLED],
  [OrderStatus.ACCEPTED]: [OrderStatus.PREPARING],
  [OrderStatus.PREPARING]: [OrderStatus.READY_FOR_PICKUP],
  [OrderStatus.READY_FOR_PICKUP]: [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.REJECTED]: [],
  [OrderStatus.CANCELLED]: []
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway
  ) {}

  async createOrder(customerId: string, input: CreateOrderDto): Promise<OrderDetailView> {
    const order = await this.prisma.$transaction(async (tx) => {
      const restaurant = await tx.restaurant.findUnique({ where: { id: input.restaurantId } });
      if (!restaurant || restaurant.status !== RestaurantStatus.APPROVED) {
        throw new ApiException(404, "RESTAURANT_NOT_FOUND", "This restaurant is not available.");
      }
      if (!restaurant.isOpen) {
        throw new ApiException(409, "RESTAURANT_CLOSED", "This restaurant is not accepting orders right now.");
      }

      const menuItemIds = [...new Set(input.items.map((line) => line.menuItemId))];
      const menuItems = await tx.menuItem.findMany({
        where: { id: { in: menuItemIds }, restaurantId: restaurant.id }
      });
      const menuItemById = new Map(menuItems.map((item) => [item.id, item]));

      for (const line of input.items) {
        const menuItem = menuItemById.get(line.menuItemId);
        if (!menuItem || !menuItem.isAvailable) {
          throw new ApiException(
            409,
            "ORDER_ITEM_UNAVAILABLE",
            "One or more items in your order are no longer available. Please review your cart."
          );
        }
      }

      let subtotalMinor = 0;
      const itemsData = input.items.map((line) => {
        const menuItem = menuItemById.get(line.menuItemId)!;
        subtotalMinor += menuItem.priceMinor * line.quantity;
        return {
          menuItemId: menuItem.id,
          nameSnapshot: menuItem.name,
          priceMinorSnapshot: menuItem.priceMinor,
          quantity: line.quantity
        };
      });

      const { deliveryFeeMinor, serviceFeeMinor } = calculateOrderFees(subtotalMinor);
      const discountMinor = 0;
      const totalMinor = subtotalMinor + deliveryFeeMinor + serviceFeeMinor - discountMinor;

      const created = await tx.order.create({
        data: {
          customerId,
          restaurantId: restaurant.id,
          status: OrderStatus.PLACED,
          paymentMethod: input.paymentMethod,
          deliveryLabel: input.deliveryLabel.trim(),
          deliveryAddressLine: input.deliveryAddressLine.trim(),
          deliveryLatitude: input.deliveryLatitude ?? null,
          deliveryLongitude: input.deliveryLongitude ?? null,
          subtotalMinor,
          deliveryFeeMinor,
          serviceFeeMinor,
          discountMinor,
          totalMinor,
          items: { create: itemsData }
        },
        include: orderInclude
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId: created.id,
          fromStatus: null,
          toStatus: OrderStatus.PLACED,
          changedByUserId: customerId
        }
      });
      await createNotification(tx, this.realtime, {
        userId: restaurant.ownerUserId,
        type: NotificationType.ORDER_PLACED,
        title: "New order received",
        body: `A new order for ${formatPrice(created.totalMinor)} is waiting for your response.`,
        relatedEntityId: created.id
      });
      return { ...created, statusHistory: await tx.orderStatusHistory.findMany({ where: { orderId: created.id } }) };
    });

    this.realtime.emitToRestaurant(order.restaurantId, "order.created", { orderId: order.id });
    this.realtime.emitToAdmins("order.created", { orderId: order.id, restaurantId: order.restaurantId, totalMinor: order.totalMinor });

    return toOrderDetailView(order);
  }

  async listForCustomer(customerId: string, page: number, pageSize: number): Promise<Page<OrderDetailView>> {
    const where = { customerId };
    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: orderInclude,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.order.count({ where })
    ]);
    return { items: orders.map(toOrderDetailView), page, pageSize, total };
  }

  async getForCustomer(customerId: string, orderId: string): Promise<OrderDetailView> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
    if (!order || order.customerId !== customerId) {
      throw orderNotFound();
    }
    return toOrderDetailView(order);
  }

  async listForRestaurantOwner(ownerUserId: string, page: number, pageSize: number): Promise<Page<OrderDetailView>> {
    const restaurant = await this.requireOwnRestaurant(ownerUserId);
    const where = { restaurantId: restaurant.id };
    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: orderInclude,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.order.count({ where })
    ]);
    return { items: orders.map(toOrderDetailView), page, pageSize, total };
  }

  async getForRestaurantOwner(ownerUserId: string, orderId: string): Promise<OrderDetailView> {
    const restaurant = await this.requireOwnRestaurant(ownerUserId);
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
    if (!order || order.restaurantId !== restaurant.id) {
      throw orderNotFound();
    }
    return toOrderDetailView(order);
  }

  async updateStatusForRestaurantOwner(
    ownerUserId: string,
    orderId: string,
    action: RestaurantOrderStatusAction,
    note: string | undefined
  ): Promise<OrderDetailView> {
    const restaurant = await this.requireOwnRestaurant(ownerUserId);
    const targetStatus = restaurantStatusTransitions[action];

    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.order.findUnique({ where: { id: orderId } });
      if (!existing || existing.restaurantId !== restaurant.id) {
        throw orderNotFound();
      }
      if (!allowedOrderTransitions[existing.status].includes(targetStatus)) {
        throw invalidTransition(existing.status, targetStatus);
      }

      const changed = await tx.order.updateMany({
        where: { id: orderId, status: existing.status },
        data: { status: targetStatus }
      });
      if (changed.count !== 1) {
        throw invalidTransition(existing.status, targetStatus);
      }
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: existing.status,
          toStatus: targetStatus,
          changedByUserId: ownerUserId,
          note: note?.trim() || null
        }
      });
      if (targetStatus === OrderStatus.READY_FOR_PICKUP) {
        await tx.delivery.create({ data: { orderId, status: DeliveryStatus.PENDING_ASSIGNMENT } });
      }
      await createNotification(tx, this.realtime, {
        userId: existing.customerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: orderStatusNotificationTitle(targetStatus),
        body: orderStatusNotificationBody(targetStatus, note),
        relatedEntityId: orderId
      });
      return tx.order.findUnique({ where: { id: orderId }, include: orderInclude });
    });

    this.realtime.emitToOrder(orderId, "order.status.changed", { orderId, status: targetStatus });
    this.realtime.emitToAdmins("order.status.changed", { orderId, status: targetStatus });

    return toOrderDetailView(updated!);
  }

  async cancelForCustomer(customerId: string, orderId: string): Promise<OrderDetailView> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.order.findUnique({ where: { id: orderId }, include: { restaurant: true } });
      if (!existing || existing.customerId !== customerId) {
        throw orderNotFound();
      }
      if (!allowedOrderTransitions[existing.status].includes(OrderStatus.CANCELLED)) {
        throw new ApiException(
          409,
          "ORDER_NOT_CANCELLABLE",
          "This order can no longer be cancelled because the restaurant has already responded to it."
        );
      }

      const changed = await tx.order.updateMany({
        where: { id: orderId, status: existing.status },
        data: { status: OrderStatus.CANCELLED }
      });
      if (changed.count !== 1) {
        throw new ApiException(409, "ORDER_NOT_CANCELLABLE", "This order can no longer be cancelled.");
      }
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: existing.status,
          toStatus: OrderStatus.CANCELLED,
          changedByUserId: customerId,
          note: "Cancelled by customer"
        }
      });
      await createNotification(tx, this.realtime, {
        userId: existing.restaurant.ownerUserId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: "Order cancelled by customer",
        body: "The customer cancelled this order before it was accepted.",
        relatedEntityId: orderId
      });
      return tx.order.findUnique({ where: { id: orderId }, include: orderInclude });
    });

    this.realtime.emitToOrder(orderId, "order.status.changed", { orderId, status: OrderStatus.CANCELLED });
    this.realtime.emitToAdmins("order.status.changed", { orderId, status: OrderStatus.CANCELLED });

    return toOrderDetailView(updated!);
  }

  async adminCancelOrder(adminUserId: string, orderId: string, reason: string): Promise<OrderDetailView> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.order.findUnique({ where: { id: orderId }, include: { restaurant: true } });
      if (!existing) {
        throw orderNotFound();
      }
      if (!cancellableByAdminStatuses.includes(existing.status)) {
        throw new ApiException(409, "ORDER_NOT_CANCELLABLE", `An order in status ${existing.status} cannot be cancelled.`);
      }

      const changed = await tx.order.updateMany({
        where: { id: orderId, status: existing.status },
        data: { status: OrderStatus.CANCELLED }
      });
      if (changed.count !== 1) {
        throw new ApiException(409, "ORDER_NOT_CANCELLABLE", "This order can no longer be cancelled.");
      }
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: existing.status,
          toStatus: OrderStatus.CANCELLED,
          changedByUserId: adminUserId,
          note: reason
        }
      });
      await writeAuditLog(tx, {
        actorUserId: adminUserId,
        action: "ORDER_CANCELLED_BY_ADMIN",
        entityType: "Order",
        entityId: orderId,
        reason,
        metadata: { fromStatus: existing.status }
      });
      await createNotification(tx, this.realtime, {
        userId: existing.customerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: "Your order was cancelled",
        body: `An administrator cancelled this order. Reason: ${reason}`,
        relatedEntityId: orderId
      });
      await createNotification(tx, this.realtime, {
        userId: existing.restaurant.ownerUserId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: "An order was cancelled by an administrator",
        body: `Reason: ${reason}`,
        relatedEntityId: orderId
      });
      return tx.order.findUnique({ where: { id: orderId }, include: orderInclude });
    });

    this.realtime.emitToOrder(orderId, "order.status.changed", { orderId, status: OrderStatus.CANCELLED });
    this.realtime.emitToAdmins("order.status.changed", { orderId, status: OrderStatus.CANCELLED });

    return toOrderDetailView(updated!);
  }

  async adminListOrders(filter: AdminOrdersFilterDto, page: number, pageSize: number): Promise<Page<OrderDetailView>> {
    const where: Prisma.OrderWhereInput = {
      status: filter.status ?? undefined,
      restaurantId: filter.restaurantId ?? undefined,
      customerId: filter.customerId ?? undefined,
      createdAt: {
        gte: filter.fromDate ? new Date(filter.fromDate) : undefined,
        lte: filter.toDate ? new Date(filter.toDate) : undefined
      }
    };
    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: orderInclude,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.order.count({ where })
    ]);
    return { items: orders.map(toOrderDetailView), page, pageSize, total };
  }

  async adminGetOrder(orderId: string): Promise<OrderDetailView> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
    if (!order) {
      throw orderNotFound();
    }
    return toOrderDetailView(order);
  }

  private async requireOwnRestaurant(ownerUserId: string): Promise<Restaurant> {
    const restaurant = await this.prisma.restaurant.findUnique({ where: { ownerUserId } });
    if (!restaurant) {
      throw new ApiException(404, "RESTAURANT_NOT_FOUND", "No restaurant is linked to this account.");
    }
    return restaurant;
  }
}

function orderNotFound(): ApiException {
  return new ApiException(404, "ORDER_NOT_FOUND", "This order does not exist.");
}

function invalidTransition(from: OrderStatus, to: OrderStatus): ApiException {
  return new ApiException(409, "ORDER_INVALID_TRANSITION", `Order cannot move from ${from} to ${to}.`);
}

function formatPrice(priceMinor: number): string {
  return `${(priceMinor / 100).toFixed(2)} ILS`;
}

function orderStatusNotificationTitle(status: OrderStatus): string {
  switch (status) {
    case OrderStatus.ACCEPTED:
      return "Your order was accepted";
    case OrderStatus.PREPARING:
      return "Your order is being prepared";
    case OrderStatus.READY_FOR_PICKUP:
      return "Your order is ready and waiting for a driver";
    case OrderStatus.REJECTED:
      return "Your order was rejected";
    case OrderStatus.DELIVERED:
      return "Your order has been delivered";
    case OrderStatus.CANCELLED:
      return "Your order was cancelled";
    default:
      return "Your order status has changed";
  }
}

function orderStatusNotificationBody(status: OrderStatus, note: string | undefined): string {
  const trimmedNote = note?.trim();
  if (status === OrderStatus.REJECTED && trimmedNote) {
    return `The restaurant could not accept this order. Reason: ${trimmedNote}`;
  }
  return trimmedNote || orderStatusNotificationTitle(status);
}

function toOrderDetailView(order: OrderWithRelations): OrderDetailView {
  return {
    id: order.id,
    status: order.status,
    paymentMethod: order.paymentMethod,
    restaurant: { id: order.restaurant.id, name: order.restaurant.name },
    deliveryLabel: order.deliveryLabel,
    deliveryAddressLine: order.deliveryAddressLine,
    deliveryLatitude: order.deliveryLatitude,
    deliveryLongitude: order.deliveryLongitude,
    statusHistory: order.statusHistory
      .slice()
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((entry) => ({
        id: entry.id,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        changedByUserId: entry.changedByUserId,
        note: entry.note,
        createdAt: entry.createdAt
      })),
    delivery: order.delivery
      ? {
          id: order.delivery.id,
          status: order.delivery.status,
          assignedAt: order.delivery.assignedAt,
          pickedUpAt: order.delivery.pickedUpAt,
          onTheWayAt: order.delivery.onTheWayAt,
          deliveredAt: order.delivery.deliveredAt
        }
      : null,
    items: order.items.map((item) => ({
      id: item.id,
      menuItemId: item.menuItemId,
      nameSnapshot: item.nameSnapshot,
      priceMinorSnapshot: item.priceMinorSnapshot,
      quantity: item.quantity,
      lineTotalMinor: item.priceMinorSnapshot * item.quantity
    })),
    subtotalMinor: order.subtotalMinor,
    deliveryFeeMinor: order.deliveryFeeMinor,
    serviceFeeMinor: order.serviceFeeMinor,
    discountMinor: order.discountMinor,
    totalMinor: order.totalMinor,
    createdAt: order.createdAt
  };
}

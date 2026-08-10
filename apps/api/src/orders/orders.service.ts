import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { writeAuditLog } from "../common/audit-log.util";
import { ApiException } from "../common/api.exception";
import {
  BusinessType,
  DeliveryStatus,
  FulfillmentAdjustmentStatus,
  InventoryMovementType,
  NotificationType,
  OrderStatus,
  Prisma,
  RestaurantStatus,
  type Restaurant
} from "../generated/prisma/client";
import { writeInventoryMovement } from "../inventory/inventory.util";
import { createNotification } from "../notifications/notification.util";
import { calculatePromotionDiscounts } from "../offers/offers.service";
import type { AppliedPromotion } from "../offers/offers.types";
import { PrismaService } from "../prisma/prisma.service";
import { DeferredEmitter } from "../realtime/deferred-emitter";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import {
  allowedOrderTransitions,
  cancellableByAdminStatuses,
  restaurantStatusTransitions
} from "./order.rules";
import type {
  AdminOrdersFilterDto,
  CreateOrderDto,
  ProposeFulfillmentAdjustmentDto,
  RestaurantOrderStatusAction
} from "./orders.dto";
import type { OrderQuoteView, Page } from "./orders.types";
import type { OrderDetailView } from "./orders.types";
import { calculateOrderFees, defaultDeliveryPricing, type DeliveryPricingConfig } from "./pricing";

const orderInclude = {
  items: { include: { fulfillmentAdjustment: true } },
  restaurant: true,
  acceptedBy: { select: { id: true, fullName: true } },
  statusHistory: { orderBy: { createdAt: "asc" as const } },
  delivery: true
} as const;

/** Business and admin callers see who accepted an order; customers deliberately do not. */
const withActorNames = { includeActorNames: true } as const;

type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    @Optional() private readonly config?: ConfigService
  ) {}

  async createOrder(customerId: string, input: CreateOrderDto): Promise<OrderDetailView> {
    const emitter = new DeferredEmitter(this.realtime);
    const order = await this.prisma.$transaction(async (tx) => {
      const quote = await this.calculateOrderQuote(tx, input);
      const { restaurant, itemsData } = quote;
      const inventoryReservations = await this.reserveTrackedInventory(tx, quote.inventoryReservations);

      const created = await tx.order.create({
        data: {
          customerId,
          restaurantId: restaurant.id,
          status: OrderStatus.PLACED,
          paymentMethod: input.paymentMethod,
          deliveryLabel: input.deliveryLabel.trim(),
          deliveryAddressLine: input.deliveryAddressLine.trim(),
          deliveryLatitude: input.deliveryLatitude,
          deliveryLongitude: input.deliveryLongitude,
          customerNote: input.customerNote?.trim() || null,
          deliveryDistanceMeters: quote.deliveryDistanceMeters,
          subtotalMinor: quote.subtotalMinor,
          deliveryFeeMinor: quote.deliveryFeeMinor,
          serviceFeeMinor: quote.serviceFeeMinor,
          discountMinor: quote.discountMinor,
          promotionSnapshot: quote.appliedPromotions as unknown as Prisma.InputJsonValue,
          totalMinor: quote.totalMinor,
          items: { create: itemsData }
        },
        include: orderInclude
      });
      for (const reservation of inventoryReservations) {
        await writeInventoryMovement(tx, {
          restaurantId: restaurant.id,
          menuItemId: reservation.menuItemId,
          orderId: created.id,
          type: InventoryMovementType.ORDER_RESERVATION,
          quantityDelta: -reservation.quantity,
          stockAfter: reservation.stockAfter,
          reason: "Stock reserved when order was placed"
        });
      }
      await tx.orderStatusHistory.create({
        data: {
          orderId: created.id,
          fromStatus: null,
          toStatus: OrderStatus.PLACED,
          changedByUserId: customerId
        }
      });
      await createNotification(tx, emitter, {
        userId: restaurant.ownerUserId,
        type: NotificationType.ORDER_PLACED,
        title: "New order received",
        body: `A new order for ${formatPrice(created.totalMinor)} is waiting for your response.`,
        relatedEntityId: created.id
      });
      return { ...created, statusHistory: await tx.orderStatusHistory.findMany({ where: { orderId: created.id } }) };
    });
    emitter.flush();

    this.realtime.emitToRestaurant(order.restaurantId, "order.created", { orderId: order.id });
    this.realtime.emitToAdmins("order.created", { orderId: order.id, restaurantId: order.restaurantId, totalMinor: order.totalMinor });

    return toOrderDetailView(order);
  }

  async quoteOrder(input: CreateOrderDto): Promise<OrderQuoteView> {
    const quote = await this.calculateOrderQuote(this.prisma, input);
    return {
      subtotalMinor: quote.subtotalMinor,
      deliveryDistanceMeters: quote.deliveryDistanceMeters,
      deliveryFeeMinor: quote.deliveryFeeMinor,
      serviceFeeMinor: quote.serviceFeeMinor,
      discountMinor: quote.discountMinor,
      totalMinor: quote.totalMinor,
      appliedPromotions: quote.appliedPromotions
    };
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
    return { items: orders.map((order) => toOrderDetailView(order)), page, pageSize, total };
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
    return {
      items: orders.map((order) => toOrderDetailView(order, withActorNames)),
      page,
      pageSize,
      total
    };
  }

  async getForRestaurantOwner(ownerUserId: string, orderId: string): Promise<OrderDetailView> {
    const restaurant = await this.requireOwnRestaurant(ownerUserId);
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
    if (!order || order.restaurantId !== restaurant.id) {
      throw orderNotFound();
    }
    return toOrderDetailView(order, withActorNames);
  }

  async proposeFulfillmentAdjustment(
    ownerUserId: string,
    orderId: string,
    orderItemId: string,
    input: ProposeFulfillmentAdjustmentDto
  ): Promise<OrderDetailView> {
    const restaurant = await this.requireOwnRestaurant(ownerUserId);
    if (restaurant.businessType !== BusinessType.SUPERMARKET) {
      throw new ApiException(404, "SUPERMARKET_NOT_FOUND", "Fulfillment adjustments are available only for supermarket orders.");
    }

    const emitter = new DeferredEmitter(this.realtime);
    const updated = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order || order.restaurantId !== restaurant.id) throw orderNotFound();
      if (order.status !== OrderStatus.PLACED) {
        throw new ApiException(409, "FULFILLMENT_ORDER_NOT_PLACED", "Adjust products before accepting the order.");
      }
      const orderItem = await tx.orderItem.findUnique({
        where: { id: orderItemId },
        include: { menuItem: true, fulfillmentAdjustment: true }
      });
      if (!orderItem || orderItem.orderId !== order.id) throw orderNotFound();
      if (orderItem.fulfillmentAdjustment?.status === FulfillmentAdjustmentStatus.APPROVED) {
        throw new ApiException(409, "FULFILLMENT_ALREADY_APPROVED", "An approved fulfillment adjustment cannot be replaced.");
      }

      let replacement = null;
      if (input.replacementMenuItemId) {
        if (!orderItem.allowSubstitution) {
          throw new ApiException(409, "SUBSTITUTION_NOT_ALLOWED", "The customer did not allow a replacement for this product.");
        }
        if (input.replacementMenuItemId === orderItem.menuItemId) {
          throw new ApiException(400, "SUBSTITUTION_SAME_PRODUCT", "Choose a different product as the replacement.");
        }
        replacement = await tx.menuItem.findFirst({
          where: {
            id: input.replacementMenuItemId,
            restaurantId: restaurant.id,
            isAvailable: true,
            category: { isActive: true }
          }
        });
        if (!replacement) {
          throw new ApiException(404, "SUBSTITUTION_PRODUCT_NOT_FOUND", "The replacement product is not available in this supermarket.");
        }
      }

      const requestedQuantityMilli = orderItem.quantity * 1_000;
      const actualQuantityMilli = input.actualQuantityMilli ?? requestedQuantityMilli;
      const supportsVariableQuantity = replacement?.isVariableWeight ?? orderItem.isVariableWeightSnapshot;
      if (!replacement && !supportsVariableQuantity) {
        throw new ApiException(400, "FULFILLMENT_ADJUSTMENT_NOT_REQUIRED", "This product is neither replaceable nor variable-weight.");
      }
      if (!supportsVariableQuantity && actualQuantityMilli !== requestedQuantityMilli) {
        throw new ApiException(400, "FULFILLMENT_QUANTITY_FIXED", "Only a variable-weight product can use an adjusted packed quantity.");
      }
      if (actualQuantityMilli < Math.ceil(requestedQuantityMilli * 0.5) || actualQuantityMilli > requestedQuantityMilli * 1.5) {
        throw new ApiException(422, "FULFILLMENT_QUANTITY_OUT_OF_RANGE", "Packed quantity must remain between 50% and 150% of the requested quantity.");
      }

      if (orderItem.fulfillmentAdjustment?.status === FulfillmentAdjustmentStatus.PENDING) {
        const previous = orderItem.fulfillmentAdjustment;
        if (previous.replacementMenuItemId) {
          await this.changeTrackedInventory(tx, {
            restaurantId: restaurant.id,
            menuItemId: previous.replacementMenuItemId,
            orderId: order.id,
            quantityDelta: reservedUnits(previous.actualQuantityMilli),
            type: InventoryMovementType.FULFILLMENT_RELEASE,
            reason: "Previous fulfillment proposal replaced"
          });
        } else if (orderItem.menuItem.stockQuantity !== null) {
          const previousExtraUnits = Math.max(0, reservedUnits(previous.actualQuantityMilli) - orderItem.quantity);
          await this.changeTrackedInventory(tx, {
            restaurantId: restaurant.id,
            menuItemId: orderItem.menuItemId,
            orderId: order.id,
            quantityDelta: previousExtraUnits,
            type: InventoryMovementType.FULFILLMENT_RELEASE,
            reason: "Previous packed-quantity proposal replaced"
          });
        }
      }

      if (replacement && replacement.stockQuantity !== null) {
        const quantity = reservedUnits(actualQuantityMilli);
        const reserved = await this.changeTrackedInventory(tx, {
          restaurantId: restaurant.id,
          menuItemId: replacement.id,
          orderId: order.id,
          quantityDelta: -quantity,
          type: InventoryMovementType.FULFILLMENT_RESERVATION,
          reason: "Replacement reserved for customer review"
        });
        if (!reserved) {
          throw new ApiException(409, "SUBSTITUTION_OUT_OF_STOCK", "The replacement no longer has enough stock.");
        }
      } else if (!replacement && orderItem.menuItem.stockQuantity !== null) {
        const extraUnits = Math.max(0, reservedUnits(actualQuantityMilli) - orderItem.quantity);
        const reserved = await this.changeTrackedInventory(tx, {
          restaurantId: restaurant.id,
          menuItemId: orderItem.menuItemId,
          orderId: order.id,
          quantityDelta: -extraUnits,
          type: InventoryMovementType.FULFILLMENT_RESERVATION,
          reason: "Additional variable quantity reserved for customer review"
        });
        if (!reserved) {
          throw new ApiException(409, "FULFILLMENT_OUT_OF_STOCK", "The product no longer has enough stock for this packed quantity.");
        }
      }

      const unitPriceMinor = replacement?.priceMinor ?? orderItem.priceMinorSnapshot;
      await tx.fulfillmentAdjustment.upsert({
        where: { orderItemId: orderItem.id },
        create: {
          orderItemId: orderItem.id,
          replacementMenuItemId: replacement?.id ?? null,
          proposedByUserId: ownerUserId,
          replacementNameSnapshot: replacement?.name ?? null,
          replacementUnitLabelSnapshot: replacement?.unitLabel ?? null,
          actualQuantityMilli,
          unitPriceMinor,
          lineTotalMinor: Math.floor(unitPriceMinor * actualQuantityMilli / 1_000),
          note: input.note?.trim() || null
        },
        update: {
          replacementMenuItemId: replacement?.id ?? null,
          proposedByUserId: ownerUserId,
          replacementNameSnapshot: replacement?.name ?? null,
          replacementUnitLabelSnapshot: replacement?.unitLabel ?? null,
          actualQuantityMilli,
          unitPriceMinor,
          lineTotalMinor: Math.floor(unitPriceMinor * actualQuantityMilli / 1_000),
          status: FulfillmentAdjustmentStatus.PENDING,
          note: input.note?.trim() || null,
          decidedAt: null
        }
      });
      await createNotification(tx, emitter, {
        userId: order.customerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: "Your supermarket needs a product decision",
        body: replacement
          ? `${orderItem.nameSnapshot} has a proposed replacement. Review it before the store accepts your order.`
          : `${orderItem.nameSnapshot} has a packed quantity update. Review it before the store accepts your order.`,
        relatedEntityId: order.id
      });
      return tx.order.findUnique({ where: { id: order.id }, include: orderInclude });
    });
    emitter.flush();

    this.realtime.emitToOrder(orderId, "order.fulfillment.changed", { orderId });
    return toOrderDetailView(updated!, withActorNames);
  }

  async decideFulfillmentAdjustment(
    customerId: string,
    orderId: string,
    adjustmentId: string,
    decision: "APPROVED" | "REJECTED"
  ): Promise<OrderDetailView> {
    const emitter = new DeferredEmitter(this.realtime);
    const updated = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { restaurant: true } });
      if (!order || order.customerId !== customerId) throw orderNotFound();
      if (order.status !== OrderStatus.PLACED) {
        throw new ApiException(409, "FULFILLMENT_ORDER_NOT_PLACED", "This fulfillment decision is no longer available.");
      }
      const adjustment = await tx.fulfillmentAdjustment.findUnique({
        where: { id: adjustmentId },
        include: { orderItem: { include: { menuItem: true } } }
      });
      if (!adjustment || adjustment.orderItem.orderId !== order.id || adjustment.status !== FulfillmentAdjustmentStatus.PENDING) {
        throw new ApiException(404, "FULFILLMENT_ADJUSTMENT_NOT_FOUND", "This pending fulfillment adjustment does not exist.");
      }

      if (decision === "REJECTED") {
        if (adjustment.replacementMenuItemId) {
          await this.changeTrackedInventory(tx, {
            restaurantId: order.restaurantId,
            menuItemId: adjustment.replacementMenuItemId,
            orderId: order.id,
            quantityDelta: reservedUnits(adjustment.actualQuantityMilli),
            type: InventoryMovementType.FULFILLMENT_RELEASE,
            reason: "Customer rejected replacement"
          });
        } else if (adjustment.orderItem.menuItem.stockQuantity !== null) {
          await this.changeTrackedInventory(tx, {
            restaurantId: order.restaurantId,
            menuItemId: adjustment.orderItem.menuItemId,
            orderId: order.id,
            quantityDelta: Math.max(0, reservedUnits(adjustment.actualQuantityMilli) - adjustment.orderItem.quantity),
            type: InventoryMovementType.FULFILLMENT_RELEASE,
            reason: "Customer rejected additional packed quantity"
          });
        }
        await tx.fulfillmentAdjustment.update({
          where: { id: adjustment.id },
          data: { status: FulfillmentAdjustmentStatus.REJECTED, decidedAt: new Date() }
        });
      } else {
        if (adjustment.replacementMenuItemId) {
          await this.changeTrackedInventory(tx, {
            restaurantId: order.restaurantId,
            menuItemId: adjustment.orderItem.menuItemId,
            orderId: order.id,
            quantityDelta: adjustment.orderItem.quantity,
            type: InventoryMovementType.FULFILLMENT_RELEASE,
            reason: "Original product released after replacement approval"
          });
        } else if (adjustment.orderItem.menuItem.stockQuantity !== null) {
          await this.changeTrackedInventory(tx, {
            restaurantId: order.restaurantId,
            menuItemId: adjustment.orderItem.menuItemId,
            orderId: order.id,
            quantityDelta: Math.max(0, adjustment.orderItem.quantity - reservedUnits(adjustment.actualQuantityMilli)),
            type: InventoryMovementType.FULFILLMENT_RELEASE,
            reason: "Unused original quantity released after packed-quantity approval"
          });
        }
        const originalLineTotal = adjustment.orderItem.priceMinorSnapshot * adjustment.orderItem.quantity;
        const subtotalMinor = order.subtotalMinor - originalLineTotal + adjustment.lineTotalMinor;
        await tx.order.update({
          where: { id: order.id },
          data: {
            subtotalMinor,
            totalMinor: Math.max(0, subtotalMinor + order.deliveryFeeMinor + order.serviceFeeMinor - order.discountMinor)
          }
        });
        await tx.fulfillmentAdjustment.update({
          where: { id: adjustment.id },
          data: { status: FulfillmentAdjustmentStatus.APPROVED, decidedAt: new Date() }
        });
      }

      await createNotification(tx, emitter, {
        userId: order.restaurant.ownerUserId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: decision === "APPROVED" ? "Fulfillment change approved" : "Fulfillment change rejected",
        body: decision === "APPROVED"
          ? "The customer approved the proposed product or packed quantity."
          : "The customer rejected the proposal. You can send a revised proposal or fulfill the original product.",
        relatedEntityId: order.id
      });
      return tx.order.findUnique({ where: { id: order.id }, include: orderInclude });
    });
    emitter.flush();

    this.realtime.emitToOrder(orderId, "order.fulfillment.changed", { orderId });
    return toOrderDetailView(updated!);
  }

  async updateStatusForRestaurantOwner(
    ownerUserId: string,
    orderId: string,
    action: RestaurantOrderStatusAction,
    note: string | undefined
  ): Promise<OrderDetailView> {
    const restaurant = await this.requireOwnRestaurant(ownerUserId);
    const targetStatus = restaurantStatusTransitions[action];

    const emitter = new DeferredEmitter(this.realtime);
    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.order.findUnique({ where: { id: orderId } });
      if (!existing || existing.restaurantId !== restaurant.id) {
        throw orderNotFound();
      }
      if (!allowedOrderTransitions[existing.status].includes(targetStatus)) {
        throw invalidTransition(existing.status, targetStatus);
      }
      if (targetStatus === OrderStatus.ACCEPTED) {
        const pendingAdjustments = await tx.fulfillmentAdjustment.count({
          where: { orderItem: { orderId }, status: FulfillmentAdjustmentStatus.PENDING }
        });
        if (pendingAdjustments > 0) {
          throw new ApiException(
            409,
            "FULFILLMENT_REVIEW_PENDING",
            "Wait for the customer to approve or reject every fulfillment proposal before accepting the order."
          );
        }
      }

      // Compare-and-swap on the current status: exactly one concurrent caller can win, and the
      // winner is recorded in the same atomic write that decides the winner.
      const changed = await tx.order.updateMany({
        where: { id: orderId, status: existing.status },
        data: {
          status: targetStatus,
          ...(targetStatus === OrderStatus.ACCEPTED
            ? { acceptedByUserId: ownerUserId, acceptedAt: new Date() }
            : {})
        }
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
      if (targetStatus === OrderStatus.REJECTED) {
        await this.restoreTrackedInventory(tx, orderId);
      }
      await createNotification(tx, emitter, {
        userId: existing.customerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: orderStatusNotificationTitle(targetStatus),
        body: orderStatusNotificationBody(targetStatus, note),
        relatedEntityId: orderId
      });
      return tx.order.findUnique({ where: { id: orderId }, include: orderInclude });
    });
    emitter.flush();

    this.realtime.emitToOrder(orderId, "order.status.changed", { orderId, status: targetStatus });
    this.realtime.emitToAdmins("order.status.changed", { orderId, status: targetStatus });

    return toOrderDetailView(updated!, withActorNames);
  }

  async cancelForCustomer(customerId: string, orderId: string): Promise<OrderDetailView> {
    const emitter = new DeferredEmitter(this.realtime);
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
      await this.restoreTrackedInventory(tx, orderId);
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: existing.status,
          toStatus: OrderStatus.CANCELLED,
          changedByUserId: customerId,
          note: "Cancelled by customer"
        }
      });
      await createNotification(tx, emitter, {
        userId: existing.restaurant.ownerUserId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: "Order cancelled by customer",
        body: "The customer cancelled this order before it was accepted.",
        relatedEntityId: orderId
      });
      return tx.order.findUnique({ where: { id: orderId }, include: orderInclude });
    });
    emitter.flush();

    this.realtime.emitToOrder(orderId, "order.status.changed", { orderId, status: OrderStatus.CANCELLED });
    this.realtime.emitToAdmins("order.status.changed", { orderId, status: OrderStatus.CANCELLED });

    return toOrderDetailView(updated!);
  }

  async adminCancelOrder(adminUserId: string, orderId: string, reason: string): Promise<OrderDetailView> {
    const emitter = new DeferredEmitter(this.realtime);
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
      await this.restoreTrackedInventory(tx, orderId);
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
      await createNotification(tx, emitter, {
        userId: existing.customerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: "Your order was cancelled",
        body: `An administrator cancelled this order. Reason: ${reason}`,
        relatedEntityId: orderId
      });
      await createNotification(tx, emitter, {
        userId: existing.restaurant.ownerUserId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: "An order was cancelled by an administrator",
        body: `Reason: ${reason}`,
        relatedEntityId: orderId
      });
      return tx.order.findUnique({ where: { id: orderId }, include: orderInclude });
    });
    emitter.flush();

    this.realtime.emitToOrder(orderId, "order.status.changed", { orderId, status: OrderStatus.CANCELLED });
    this.realtime.emitToAdmins("order.status.changed", { orderId, status: OrderStatus.CANCELLED });

    return toOrderDetailView(updated!, withActorNames);
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
    return {
      items: orders.map((order) => toOrderDetailView(order, withActorNames)),
      page,
      pageSize,
      total
    };
  }

  async adminGetOrder(orderId: string): Promise<OrderDetailView> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
    if (!order) {
      throw orderNotFound();
    }
    return toOrderDetailView(order, withActorNames);
  }

  private async requireOwnRestaurant(ownerUserId: string): Promise<Restaurant> {
    const restaurant = await this.prisma.restaurant.findUnique({ where: { ownerUserId } });
    if (!restaurant) {
      throw new ApiException(404, "RESTAURANT_NOT_FOUND", "No restaurant is linked to this account.");
    }
    return restaurant;
  }

  private async calculateOrderQuote(
    client: Pick<Prisma.TransactionClient, "restaurant" | "menuItem" | "offer">,
    input: CreateOrderDto
  ) {
    const restaurant = await client.restaurant.findUnique({ where: { id: input.restaurantId } });
    if (!restaurant || restaurant.status !== RestaurantStatus.APPROVED) {
      throw new ApiException(404, "RESTAURANT_NOT_FOUND", "This restaurant is not available.");
    }
    if (!restaurant.isOpen) {
      throw new ApiException(409, "RESTAURANT_CLOSED", "This restaurant is not accepting orders right now.");
    }
    if (restaurant.latitude === null || restaurant.longitude === null) {
      throw new ApiException(409, "RESTAURANT_LOCATION_REQUIRED", "This restaurant has not configured its delivery location.");
    }

    const menuItemIds = [...new Set(input.items.map((line) => line.menuItemId))];
    const menuItems = await client.menuItem.findMany({
      where: { id: { in: menuItemIds }, restaurantId: restaurant.id, category: { isActive: true } }
    });
    const menuItemById = new Map(menuItems.map((item) => [item.id, item]));
    const requestedQuantityByItemId = new Map<string, number>();
    for (const line of input.items) {
      requestedQuantityByItemId.set(
        line.menuItemId,
        (requestedQuantityByItemId.get(line.menuItemId) ?? 0) + line.quantity
      );
    }
    for (const line of input.items) {
      const menuItem = menuItemById.get(line.menuItemId);
      if (!menuItem || !menuItem.isAvailable) {
        throw new ApiException(
          409,
          "ORDER_ITEM_UNAVAILABLE",
          "One or more items in your order are no longer available. Please review your cart."
        );
      }
      if (
        menuItem.stockQuantity !== null &&
        menuItem.stockQuantity < (requestedQuantityByItemId.get(line.menuItemId) ?? line.quantity)
      ) {
        throw new ApiException(
          409,
          "ORDER_ITEM_OUT_OF_STOCK",
          `${menuItem.name} does not have enough stock for the requested quantity.`
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
        quantity: line.quantity,
        unitLabelSnapshot: menuItem.unitLabel,
        allowSubstitution: line.allowSubstitution ?? false,
        isVariableWeightSnapshot: menuItem.isVariableWeight
      };
    });
    const pricing = this.deliveryPricingConfig();
    const fees = calculateOrderFees(
      { latitude: restaurant.latitude, longitude: restaurant.longitude },
      { latitude: input.deliveryLatitude, longitude: input.deliveryLongitude },
      pricing
    );
    if (fees.deliveryDistanceMeters > pricing.maximumDistanceMeters) {
      throw new ApiException(
        422,
        "DELIVERY_OUT_OF_RANGE",
        `This address is outside the ${Math.round(pricing.maximumDistanceMeters / 1_000)} km delivery area.`
      );
    }

    const now = new Date();
    const activeOffers = await client.offer.findMany({
      where: {
        isActive: true,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        AND: [{ OR: [{ restaurantId: null }, { restaurantId: restaurant.id }] }]
      }
    });
    const promotion = calculatePromotionDiscounts({
      offers: activeOffers,
      items: input.items.map((line) => ({
        menuItemId: line.menuItemId,
        priceMinor: menuItemById.get(line.menuItemId)!.priceMinor,
        quantity: line.quantity
      })),
      subtotalMinor,
      deliveryFeeMinor: fees.deliveryFeeMinor
    });
    return {
      restaurant,
      itemsData,
      inventoryReservations: menuItems
        .filter((item) => item.stockQuantity !== null)
        .map((item) => ({
          menuItemId: item.id,
          quantity: requestedQuantityByItemId.get(item.id) ?? 0
        }))
        .filter((item) => item.quantity > 0),
      subtotalMinor,
      ...fees,
      discountMinor: promotion.discountMinor,
      totalMinor: subtotalMinor + fees.deliveryFeeMinor + fees.serviceFeeMinor - promotion.discountMinor,
      appliedPromotions: promotion.appliedPromotions
    };
  }

  private async reserveTrackedInventory(
    tx: Prisma.TransactionClient,
    reservations: { menuItemId: string; quantity: number }[]
  ): Promise<{ menuItemId: string; quantity: number; stockAfter: number }[]> {
    const completed: { menuItemId: string; quantity: number; stockAfter: number }[] = [];
    for (const reservation of reservations) {
      const updated = await tx.menuItem.updateMany({
        where: { id: reservation.menuItemId, stockQuantity: { gte: reservation.quantity } },
        data: { stockQuantity: { decrement: reservation.quantity } }
      });
      if (updated.count !== 1) {
        throw new ApiException(
          409,
          "ORDER_ITEM_OUT_OF_STOCK",
          "One or more products no longer have enough stock. Refresh the catalog and try again."
        );
      }
      const item = await tx.menuItem.findUnique({ where: { id: reservation.menuItemId }, select: { stockQuantity: true } });
      completed.push({ ...reservation, stockAfter: item!.stockQuantity! });
    }
    return completed;
  }

  private async restoreTrackedInventory(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) return;
    const items = await tx.orderItem.findMany({ where: { orderId }, include: { fulfillmentAdjustment: true } });
    for (const item of items) {
      const adjustment = item.fulfillmentAdjustment;
      if (adjustment?.status === FulfillmentAdjustmentStatus.APPROVED) {
        await this.changeTrackedInventory(tx, {
          restaurantId: order.restaurantId,
          menuItemId: adjustment.replacementMenuItemId ?? item.menuItemId,
          orderId,
          quantityDelta: reservedUnits(adjustment.actualQuantityMilli),
          type: InventoryMovementType.ORDER_RESTORE,
          reason: adjustment.replacementMenuItemId
            ? "Approved replacement restored after order cancellation"
            : "Approved packed quantity restored after order cancellation"
        });
        continue;
      }
      if (adjustment?.status === FulfillmentAdjustmentStatus.PENDING && !adjustment.replacementMenuItemId) {
        await this.changeTrackedInventory(tx, {
          restaurantId: order.restaurantId,
          menuItemId: item.menuItemId,
          orderId,
          quantityDelta: Math.max(item.quantity, reservedUnits(adjustment.actualQuantityMilli)),
          type: InventoryMovementType.ORDER_RESTORE,
          reason: "Pending packed quantity restored after order cancellation"
        });
        continue;
      }
      await this.changeTrackedInventory(tx, {
        restaurantId: order.restaurantId,
        menuItemId: item.menuItemId,
        orderId,
        quantityDelta: item.quantity,
        type: InventoryMovementType.ORDER_RESTORE,
        reason: "Original product restored after order cancellation"
      });
      if (adjustment?.status === FulfillmentAdjustmentStatus.PENDING && adjustment.replacementMenuItemId) {
        await this.changeTrackedInventory(tx, {
          restaurantId: order.restaurantId,
          menuItemId: adjustment.replacementMenuItemId,
          orderId,
          quantityDelta: reservedUnits(adjustment.actualQuantityMilli),
          type: InventoryMovementType.FULFILLMENT_RELEASE,
          reason: "Pending replacement released after order cancellation"
        });
      }
    }
  }

  private async changeTrackedInventory(
    tx: Prisma.TransactionClient,
    input: {
      restaurantId: string;
      menuItemId: string;
      orderId: string;
      quantityDelta: number;
      type: InventoryMovementType;
      reason: string;
    }
  ): Promise<boolean> {
    if (input.quantityDelta === 0) return true;
    const amount = Math.abs(input.quantityDelta);
    const changed = input.quantityDelta < 0
      ? await tx.menuItem.updateMany({
          where: { id: input.menuItemId, stockQuantity: { gte: amount } },
          data: { stockQuantity: { decrement: amount } }
        })
      : await tx.menuItem.updateMany({
          where: { id: input.menuItemId, stockQuantity: { not: null } },
          data: { stockQuantity: { increment: amount } }
        });
    if (changed.count !== 1) return false;
    const item = await tx.menuItem.findUnique({ where: { id: input.menuItemId }, select: { stockQuantity: true } });
    await writeInventoryMovement(tx, { ...input, stockAfter: item!.stockQuantity! });
    return true;
  }

  private deliveryPricingConfig(): DeliveryPricingConfig {
    return {
      minimumFeeMinor: this.config?.get<number>("DELIVERY_MIN_FEE_MINOR") ?? defaultDeliveryPricing.minimumFeeMinor,
      includedDistanceMeters:
        this.config?.get<number>("DELIVERY_INCLUDED_DISTANCE_METERS") ?? defaultDeliveryPricing.includedDistanceMeters,
      ratePerKilometerMinor:
        this.config?.get<number>("DELIVERY_RATE_PER_KM_MINOR") ?? defaultDeliveryPricing.ratePerKilometerMinor,
      maximumDistanceMeters:
        this.config?.get<number>("DELIVERY_MAX_DISTANCE_METERS") ?? defaultDeliveryPricing.maximumDistanceMeters,
      serviceFeeMinor: this.config?.get<number>("SERVICE_FEE_MINOR") ?? defaultDeliveryPricing.serviceFeeMinor
    };
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

function reservedUnits(actualQuantityMilli: number): number {
  return Math.max(1, Math.ceil(actualQuantityMilli / 1_000));
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

function toOrderDetailView(
  order: OrderWithRelations,
  options: { includeActorNames?: boolean } = {}
): OrderDetailView {
  return {
    id: order.id,
    status: order.status,
    acceptedByUserId: order.acceptedByUserId,
    acceptedAt: order.acceptedAt,
    ...(options.includeActorNames ? { acceptedByFullName: order.acceptedBy?.fullName ?? null } : {}),
    paymentMethod: order.paymentMethod,
    restaurant: { id: order.restaurant.id, name: order.restaurant.name },
    deliveryLabel: order.deliveryLabel,
    deliveryAddressLine: order.deliveryAddressLine,
    deliveryLatitude: order.deliveryLatitude,
    deliveryLongitude: order.deliveryLongitude,
    deliveryDistanceMeters: order.deliveryDistanceMeters,
    customerNote: order.customerNote,
    appliedPromotions: parsePromotionSnapshot(order.promotionSnapshot),
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
    items: order.items.map((item) => {
      const adjustment = item.fulfillmentAdjustment;
      return {
        id: item.id,
        menuItemId: item.menuItemId,
        nameSnapshot: item.nameSnapshot,
        priceMinorSnapshot: item.priceMinorSnapshot,
        quantity: item.quantity,
        unitLabelSnapshot: item.unitLabelSnapshot,
        allowSubstitution: item.allowSubstitution,
        isVariableWeightSnapshot: item.isVariableWeightSnapshot,
        lineTotalMinor: adjustment?.status === FulfillmentAdjustmentStatus.APPROVED
          ? adjustment.lineTotalMinor
          : item.priceMinorSnapshot * item.quantity,
        fulfillmentAdjustment: adjustment ? {
          id: adjustment.id,
          replacementMenuItemId: adjustment.replacementMenuItemId,
          replacementNameSnapshot: adjustment.replacementNameSnapshot,
          replacementUnitLabelSnapshot: adjustment.replacementUnitLabelSnapshot,
          actualQuantityMilli: adjustment.actualQuantityMilli,
          unitPriceMinor: adjustment.unitPriceMinor,
          lineTotalMinor: adjustment.lineTotalMinor,
          status: adjustment.status,
          note: adjustment.note,
          decidedAt: adjustment.decidedAt,
          updatedAt: adjustment.updatedAt
        } : null
      };
    }),
    subtotalMinor: order.subtotalMinor,
    deliveryFeeMinor: order.deliveryFeeMinor,
    serviceFeeMinor: order.serviceFeeMinor,
    discountMinor: order.discountMinor,
    totalMinor: order.totalMinor,
    createdAt: order.createdAt,
    requiresCustomerReview: order.items.some(
      (item) => item.fulfillmentAdjustment?.status === FulfillmentAdjustmentStatus.PENDING
    )
  };
}

function parsePromotionSnapshot(value: Prisma.JsonValue | null): AppliedPromotion[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is AppliedPromotion => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const promotion = item as Record<string, unknown>;
    return typeof promotion.offerId === "string" &&
      typeof promotion.title === "string" &&
      typeof promotion.type === "string" &&
      typeof promotion.discountMinor === "number";
  });
}

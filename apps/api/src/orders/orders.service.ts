import { Injectable } from "@nestjs/common";
import { ApiException } from "../common/api.exception";
import {
  OrderStatus,
  RestaurantStatus,
  type Order,
  type OrderItem,
  type Restaurant
} from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { CreateOrderDto } from "./orders.dto";
import type { Page } from "./orders.types";
import type { OrderDetailView } from "./orders.types";
import { calculateOrderFees } from "./pricing";

type OrderWithRelations = Order & { items: OrderItem[]; restaurant: Restaurant };

const orderInclude = { items: true, restaurant: true } as const;

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

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

      return tx.order.create({
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
    });

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

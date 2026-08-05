import { randomUUID } from "node:crypto";
import { OrderPaymentMethod, OrderStatus, RestaurantStatus } from "../../generated/prisma/client";

type RestaurantRecord = {
  id: string;
  ownerUserId: string;
  name: string;
  status: RestaurantStatus;
  isOpen: boolean;
};

type MenuItemRecord = {
  id: string;
  restaurantId: string;
  name: string;
  priceMinor: number;
  isAvailable: boolean;
};

type OrderItemRecord = {
  id: string;
  orderId: string;
  menuItemId: string;
  nameSnapshot: string;
  priceMinorSnapshot: number;
  quantity: number;
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
  subtotalMinor: number;
  deliveryFeeMinor: number;
  serviceFeeMinor: number;
  discountMinor: number;
  totalMinor: number;
  createdAt: Date;
  updatedAt: Date;
};

export class FakeOrdersPrisma {
  readonly restaurants: RestaurantRecord[] = [];
  readonly menuItems: MenuItemRecord[] = [];
  readonly orders: OrderRecord[] = [];
  readonly orderItems: OrderItemRecord[] = [];
  private transactionTail: Promise<void> = Promise.resolve();

  readonly restaurant = {} as any;
  readonly menuItem = {} as any;
  readonly order = {} as any;

  constructor() {
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

    this.order.create = async ({ data }: any) => {
      const now = new Date();
      const order: OrderRecord = {
        id: data.id ?? randomUUID(),
        customerId: data.customerId,
        restaurantId: data.restaurantId,
        status: data.status ?? OrderStatus.PLACED,
        paymentMethod: data.paymentMethod,
        deliveryLabel: data.deliveryLabel,
        deliveryAddressLine: data.deliveryAddressLine,
        deliveryLatitude: data.deliveryLatitude ?? null,
        deliveryLongitude: data.deliveryLongitude ?? null,
        subtotalMinor: data.subtotalMinor,
        deliveryFeeMinor: data.deliveryFeeMinor,
        serviceFeeMinor: data.serviceFeeMinor,
        discountMinor: data.discountMinor ?? 0,
        totalMinor: data.totalMinor,
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
          quantity: itemData.quantity
        });
      }

      return this.hydrateOrder(order);
    };

    this.order.findUnique = async ({ where }: any) => {
      const order = this.orders.find((candidate) => candidate.id === where.id);
      return order ? this.hydrateOrder(order) : null;
    };

    this.order.findMany = async ({ where, orderBy, skip = 0, take }: any) => {
      let matches = this.orders.filter(
        (order) =>
          (!where?.customerId || order.customerId === where.customerId) &&
          (!where?.restaurantId || order.restaurantId === where.restaurantId)
      );
      if (orderBy?.createdAt === "desc") {
        matches = [...matches].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
      }
      const sliced = typeof take === "number" ? matches.slice(skip, skip + take) : matches.slice(skip);
      return sliced.map((order) => this.hydrateOrder(order));
    };

    this.order.count = async ({ where }: any) =>
      this.orders.filter(
        (order) =>
          (!where?.customerId || order.customerId === where.customerId) &&
          (!where?.restaurantId || order.restaurantId === where.restaurantId)
      ).length;
  }

  private hydrateOrder(order: OrderRecord) {
    const restaurant = this.restaurants.find((candidate) => candidate.id === order.restaurantId)!;
    const items = this.orderItems.filter((item) => item.orderId === order.id);
    return { ...order, items, restaurant };
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
      status: RestaurantStatus.APPROVED,
      isOpen: true,
      ...overrides
    };
    this.restaurants.push(restaurant);
    return restaurant;
  }

  seedMenuItem(restaurantId: string, overrides: Partial<MenuItemRecord> = {}): MenuItemRecord {
    const item: MenuItemRecord = {
      id: randomUUID(),
      restaurantId,
      name: "Falafel Sandwich",
      priceMinor: 1500,
      isAvailable: true,
      ...overrides
    };
    this.menuItems.push(item);
    return item;
  }
}

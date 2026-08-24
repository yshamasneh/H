import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { AppModule } from "../app.module";
import { hashPassword } from "../auth/crypto.util";
import { BusinessType, RestaurantStatus, UserRole } from "../generated/prisma/client";
import { OrdersService } from "../orders/orders.service";
import { PrismaService } from "../prisma/prisma.service";

const runDatabaseE2e = process.env.RUN_DATABASE_E2E === "true";
const phones = { owner: "+970594900001", customer: "+970594900002" };

test(
  "concurrent order creation with the same idempotency key produces one order and reserves stock once (TC-081, DB constraint)",
  { skip: !runDatabaseE2e, timeout: 120_000 },
  async (context) => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    const prisma = app.get(PrismaService);
    const orders = app.get(OrdersService);

    const databaseUrl = app.get(ConfigService).getOrThrow<string>("DATABASE_URL");
    const parsed = new URL(databaseUrl);
    // Required unconditionally, even on localhost — the dev DATABASE_URL also points at localhost,
    // and this suite deletes/mutates real rows. A local host is not evidence of a safe database.
    if (!parsed.pathname.toLowerCase().includes("test")) {
      await app.close();
      throw new Error("This E2E requires a database whose name contains 'test'.");
    }

    const cleanup = async () => {
      const users = await prisma.user.findMany({ where: { phone: { in: Object.values(phones) } }, select: { id: true } });
      const userIds = users.map((user) => user.id);
      if (userIds.length === 0) return;
      const restaurants = await prisma.restaurant.findMany({ where: { ownerUserId: { in: userIds } }, select: { id: true } });
      const restaurantIds = restaurants.map((restaurant) => restaurant.id);
      await prisma.order.deleteMany({ where: { customerId: { in: userIds } } });
      if (restaurantIds.length > 0) {
        await prisma.inventoryMovement.deleteMany({ where: { restaurantId: { in: restaurantIds } } });
        await prisma.menuItem.deleteMany({ where: { restaurantId: { in: restaurantIds } } });
        await prisma.menuCategory.deleteMany({ where: { restaurantId: { in: restaurantIds } } });
      }
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.restaurant.deleteMany({ where: { id: { in: restaurantIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    };

    context.after(async () => {
      try {
        await cleanup();
      } finally {
        await app.close();
      }
    });
    await cleanup();

    const passwordHash = await hashPassword("Idem@12345");
    const owner = await prisma.user.create({
      data: { fullName: "Idem Owner", phone: phones.owner, passwordHash, role: UserRole.RESTAURANT, phoneVerifiedAt: new Date(), isActive: true }
    });
    const customer = await prisma.user.create({
      data: { fullName: "Idem Customer", phone: phones.customer, passwordHash, role: UserRole.CUSTOMER, phoneVerifiedAt: new Date(), isActive: true }
    });
    const restaurant = await prisma.restaurant.create({
      data: {
        ownerUserId: owner.id,
        name: "Idem Market",
        businessType: BusinessType.SUPERMARKET,
        status: RestaurantStatus.APPROVED,
        isOpen: true,
        phone: phones.owner,
        addressLine: "Al-Manara Square, Ramallah",
        latitude: 31.9038,
        longitude: 35.2034
      }
    });
    const category = await prisma.menuCategory.create({
      data: { restaurantId: restaurant.id, name: "Groceries", sortOrder: 0, isActive: true }
    });
    const item = await prisma.menuItem.create({
      data: { restaurantId: restaurant.id, categoryId: category.id, name: "Milk", priceMinor: 500, unitLabel: "carton", isAvailable: true, stockQuantity: 10 }
    });

    const idempotencyKey = randomUUID();
    const input = {
      restaurantId: restaurant.id,
      items: [{ menuItemId: item.id, quantity: 2 }],
      deliveryLabel: "Home",
      deliveryAddressLine: "Al-Manara Square, Ramallah",
      deliveryLatitude: 31.9038,
      deliveryLongitude: 35.2034,
      paymentMethod: "CASH" as const,
      idempotencyKey
    };

    // Two requests racing with the same key: the DB unique index — not just app logic — must
    // ensure exactly one order and one stock reservation.
    const results = await Promise.allSettled([
      orders.createOrder(customer.id, input as never),
      orders.createOrder(customer.id, input as never)
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    assert.equal(fulfilled.length, 2, "both calls resolve (the loser returns the winning order, not an error)");
    const ids = fulfilled.map((result) => (result as PromiseFulfilledResult<{ id: string }>).value.id);
    assert.equal(ids[0], ids[1], "both return the same order");

    const persisted = await prisma.order.findMany({ where: { customerId: customer.id } });
    assert.equal(persisted.length, 1, "exactly one order persisted under the real unique constraint");

    const reloadedItem = await prisma.menuItem.findUnique({ where: { id: item.id } });
    assert.equal(reloadedItem?.stockQuantity, 8, "stock decremented exactly once (10 - 2), the loser's reservation rolled back");
  }
);

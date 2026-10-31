import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import request from "supertest";
import { AppModule } from "../app.module";
import { hashPassword } from "../auth/crypto.util";
import { BusinessType, RestaurantStatus, UserRole } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Run 3, task 9 on PostgreSQL, over HTTP, with synthetic data: the full order lifecycle
 * (create → accept → prepare → pack → ready → driver accepts → picked up → on the way → delivered),
 * idempotent placement, customer cancellation, and terminal states refusing further changes.
 * Read-only towards money: it only checks that one financial record and one cash custody appear on
 * delivery and none on cancellation; no formula is asserted or changed here.
 */
const runDatabaseE2e = process.env.RUN_DATABASE_E2E === "true";
if (runDatabaseE2e && process.env.NODE_ENV === "production") {
  throw new Error("This E2E refuses to run with NODE_ENV=production.");
}

const password = "Lifecycle@12345";
const local = { owner: "0594690001", customer: "0594690002", driver: "0594690003" };
const phones = Object.fromEntries(Object.entries(local).map(([key, value]) => [key, `+970${value.slice(1)}`])) as typeof local;
type Http = ReturnType<typeof request>;

test("order lifecycle and idempotency over HTTP", { skip: !runDatabaseE2e, timeout: 180_000 }, async (context) => {
  const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  await app.init();
  const prisma = app.get(PrismaService);
  const http = request(app.getHttpServer());
  const databaseName = new URL(app.get(ConfigService).getOrThrow<string>("DATABASE_URL")).pathname.toLowerCase();
  if (!databaseName.includes("test")) {
    await app.close();
    throw new Error("This E2E requires a database whose name contains 'test'.");
  }
  context.after(async () => {
    try {
      await cleanup(prisma);
    } finally {
      await app.close();
    }
  });
  await cleanup(prisma);

  const passwordHash = await hashPassword(password);
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: "BUSINESS_ADMIN" } });
  const create = (phone: string, role: UserRole) =>
    prisma.user.create({ data: { fullName: `Lifecycle ${role}`, phone, passwordHash, role, phoneVerifiedAt: new Date(), isActive: true } });
  const owner = await create(phones.owner, UserRole.RESTAURANT);
  await create(phones.customer, UserRole.CUSTOMER);
  const driver = await create(phones.driver, UserRole.DRIVER);
  await prisma.driverProfile.create({ data: { userId: driver.id, status: "APPROVED", isOnline: true, appLeaseUntil: new Date(Date.now() + 600_000) } });
  const store = await prisma.restaurant.create({
    data: {
      ownerUserId: owner.id, name: "Lifecycle Market", businessType: BusinessType.SUPERMARKET, status: RestaurantStatus.APPROVED,
      isOpen: true, phone: phones.owner, addressLine: "Al-Manara Square, Ramallah", latitude: 31.9038, longitude: 35.2034
    }
  });
  await prisma.businessMember.create({ data: { businessId: store.id, userId: owner.id, roleId: adminRole.id } });
  const category = await prisma.menuCategory.create({ data: { restaurantId: store.id, name: "Groceries", sortOrder: 0, isActive: true } });
  const item = await prisma.menuItem.create({
    data: { restaurantId: store.id, categoryId: category.id, name: "Lifecycle milk", priceMinor: 500, costPriceMinor: 300, unitLabel: "item", isAvailable: true, stockQuantity: 20 }
  });
  const [ownerToken, customerToken, driverToken] = await Promise.all([local.owner, local.customer, local.driver].map((phone) => login(http, phone)));
  const orderInput = (idempotencyKey: string) => ({
    restaurantId: store.id,
    items: [{ menuItemId: item.id, quantity: 2 }],
    deliveryLabel: "Home",
    deliveryAddressLine: "Al-Manara Square, Ramallah",
    deliveryLatitude: 31.9038,
    deliveryLongitude: 35.2034,
    paymentMethod: "CASH",
    idempotencyKey
  });
  const storeStatus = (orderId: string, status: string) =>
    http.patch(`/api/v1/restaurant/me/orders/${orderId}/status`).set("Authorization", `Bearer ${ownerToken}`).send({ status });

  await context.test("placing the same order twice with one idempotency key creates one order", async () => {
    const key = randomUUID();
    const first = await http.post("/api/v1/orders").set("Authorization", `Bearer ${customerToken}`).send(orderInput(key)).expect(201);
    const second = await http.post("/api/v1/orders").set("Authorization", `Bearer ${customerToken}`).send(orderInput(key));
    assert.ok([200, 201].includes(second.status), `replay answered ${second.status}`);
    assert.equal(second.body.id, first.body.id);
    assert.equal(await prisma.order.count({ where: { restaurantId: store.id } }), 1);
    assert.equal(first.body.status, "PLACED");
  });

  await context.test("a placed order goes all the way to delivered, with one financial record and one custody", async () => {
    const order = await prisma.order.findFirstOrThrow({ where: { restaurantId: store.id } });
    await storeStatus(order.id, "ACCEPTED").expect(200);
    await storeStatus(order.id, "PREPARING").expect(200);
    for (const line of await prisma.orderItem.findMany({ where: { orderId: order.id } })) {
      await http.put(`/api/v1/restaurant/me/orders/${order.id}/items/${line.id}/picked`).set("Authorization", `Bearer ${ownerToken}`).send({ isPicked: true }).expect(200);
    }
    await storeStatus(order.id, "READY_FOR_PICKUP").expect(200);
    const delivery = await prisma.delivery.findUniqueOrThrow({ where: { orderId: order.id } });
    assert.equal(delivery.status, "PENDING_ASSIGNMENT");
    await http.post(`/api/v1/driver/me/deliveries/${delivery.id}/accept`).set("Authorization", `Bearer ${driverToken}`).expect(201);
    for (const status of ["PICKED_UP", "ON_THE_WAY", "DELIVERED"]) {
      await http.patch(`/api/v1/driver/me/deliveries/${delivery.id}/status`).set("Authorization", `Bearer ${driverToken}`).send({ status }).expect(200);
    }
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "DELIVERED");
    assert.equal(await prisma.orderFinancialRecord.count({ where: { orderId: order.id } }), 1);
    assert.equal(await prisma.driverCashCustody.count({ where: { orderId: order.id } }), 1);
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(history.map((entry) => entry.toStatus), ["PLACED", "ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "DELIVERED"]);
  });

  await context.test("a delivered order refuses cancellation and further status changes", async () => {
    const order = await prisma.order.findFirstOrThrow({ where: { restaurantId: store.id, status: "DELIVERED" } });
    const cancel = await http.post(`/api/v1/orders/${order.id}/cancel`).set("Authorization", `Bearer ${customerToken}`).send({ reason: "too late" });
    assert.equal(cancel.status, 409);
    assert.equal((await storeStatus(order.id, "PREPARING")).status, 409);
  });

  await context.test("a customer can cancel a placed order; no money is recorded and stock returns", async () => {
    const stockBefore = (await prisma.menuItem.findUniqueOrThrow({ where: { id: item.id } })).stockQuantity;
    const placed = await http.post("/api/v1/orders").set("Authorization", `Bearer ${customerToken}`).send(orderInput(randomUUID())).expect(201);
    const stockAfterPlace = (await prisma.menuItem.findUniqueOrThrow({ where: { id: item.id } })).stockQuantity;
    const cancelled = await http.post(`/api/v1/orders/${placed.body.id}/cancel`).set("Authorization", `Bearer ${customerToken}`).send({ reason: "changed my mind" });
    assert.ok([200, 201].includes(cancelled.status), `cancel answered ${cancelled.status}`);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: placed.body.id } })).status, "CANCELLED");
    assert.equal(await prisma.orderFinancialRecord.count({ where: { orderId: placed.body.id } }), 0);
    assert.equal(await prisma.driverCashCustody.count({ where: { orderId: placed.body.id } }), 0);
    const stockAfterCancel = (await prisma.menuItem.findUniqueOrThrow({ where: { id: item.id } })).stockQuantity;
    assert.equal(stockAfterPlace, (stockBefore ?? 0) - 2);
    assert.equal(stockAfterCancel, stockBefore, "a cancelled order gives its reserved stock back");
    assert.equal((await storeStatus(placed.body.id, "ACCEPTED")).status, 409, "a cancelled order cannot be accepted");
  });
});

async function login(http: Http, phoneNumber: string): Promise<string> {
  const response = await http.post("/api/v1/auth/login").send({ countryCode: "+970", phoneNumber, password }).expect(201);
  return response.body.accessToken as string;
}

async function cleanup(prisma: PrismaService): Promise<void> {
  const users = await prisma.user.findMany({ where: { phone: { in: Object.values(phones) } }, select: { id: true } });
  if (users.length === 0) return;
  const userIds = users.map((user) => user.id);
  const stores = await prisma.restaurant.findMany({ where: { ownerUserId: { in: userIds } }, select: { id: true } });
  const storeIds = stores.map((store) => store.id);
  const orders = await prisma.order.findMany({ where: { restaurantId: { in: storeIds } }, select: { id: true } });
  const orderIds = orders.map((order) => order.id);
  // Financial rows are append-only by trigger; bypassed for this cleanup only, on a test database.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    await tx.partnerEarning.deleteMany({ where: { orderFinancialRecord: { orderId: { in: orderIds } } } });
    await tx.driverCashCustody.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.orderFinancialRecord.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.inventoryMovement.deleteMany({ where: { menuItem: { restaurantId: { in: storeIds } } } });
    await tx.notification.deleteMany({ where: { userId: { in: userIds } } });
    await tx.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.delivery.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.order.deleteMany({ where: { id: { in: orderIds } } });
    await tx.menuItem.deleteMany({ where: { restaurantId: { in: storeIds } } });
    await tx.menuCategory.deleteMany({ where: { restaurantId: { in: storeIds } } });
    await tx.businessMember.deleteMany({ where: { businessId: { in: storeIds } } });
    await tx.restaurant.deleteMany({ where: { id: { in: storeIds } } });
    await tx.auditLog.deleteMany({ where: { OR: [{ actorUserId: { in: userIds } }, { entityId: { in: userIds } }] } });
    await tx.refreshSession.deleteMany({ where: { userId: { in: userIds } } });
    await tx.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
  });
}

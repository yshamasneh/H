import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { AppModule } from "../app.module";
import { hashPassword } from "../auth/crypto.util";
import { BusinessType, RestaurantStatus, UserRole } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Financial audit F12 / remaining-work R30 on PostgreSQL: two drivers accepting the same delivery at
 * the same moment — exactly one wins, the other gets 409, and the delivery has one driver.
 * Test-only; no production code involved beyond the existing accept endpoint.
 */
const runDatabaseE2e = process.env.RUN_DATABASE_E2E === "true";
if (runDatabaseE2e && process.env.NODE_ENV === "production") {
  throw new Error("This E2E refuses to run with NODE_ENV=production.");
}

const password = "ClaimRace@12345";
const local = { owner: "0594660001", customer: "0594660002", driverA: "0594660003", driverB: "0594660004" };
const phones = Object.fromEntries(Object.entries(local).map(([key, value]) => [key, `+970${value.slice(1)}`])) as typeof local;

test("two simultaneous accepts: exactly one driver gets the delivery", { skip: !runDatabaseE2e, timeout: 120_000 }, async (context) => {
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
  const create = (phone: string, role: UserRole) =>
    prisma.user.create({ data: { fullName: `Race ${role}`, phone, passwordHash, role, phoneVerifiedAt: new Date(), isActive: true } });
  const owner = await create(phones.owner, UserRole.RESTAURANT);
  const customer = await create(phones.customer, UserRole.CUSTOMER);
  const drivers = [await create(phones.driverA, UserRole.DRIVER), await create(phones.driverB, UserRole.DRIVER)];
  for (const driver of drivers) {
    await prisma.driverProfile.create({ data: { userId: driver.id, status: "APPROVED", isOnline: true, appLeaseUntil: new Date(Date.now() + 600_000) } });
  }
  const store = await prisma.restaurant.create({
    data: { ownerUserId: owner.id, name: "Race Market", businessType: BusinessType.SUPERMARKET, status: RestaurantStatus.APPROVED, isOpen: true, phone: phones.owner, addressLine: "Race street" }
  });
  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      restaurantId: store.id,
      status: "READY_FOR_PICKUP",
      paymentMethod: "CASH",
      deliveryLabel: "Home",
      deliveryAddressLine: "Test address",
      subtotalMinor: 1000,
      deliveryFeeMinor: 500,
      totalMinor: 1500
    }
  });
  const delivery = await prisma.delivery.create({ data: { orderId: order.id, status: "PENDING_ASSIGNMENT" } });
  const tokens = await Promise.all([local.driverA, local.driverB].map((phone) => login(http, phone)));

  const responses = await Promise.all(
    tokens.map((token) => http.post(`/api/v1/driver/me/deliveries/${delivery.id}/accept`).set("Authorization", `Bearer ${token}`))
  );
  const statuses = responses.map((response) => response.status).sort();
  assert.deepEqual(statuses, [201, 409]);
  const loser = responses.find((response) => response.status === 409)!;
  assert.equal(loser.body.code, "DELIVERY_ALREADY_CLAIMED");
  const stored = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
  assert.equal(stored.status, "ASSIGNED");
  assert.ok(drivers.some((driver) => driver.id === stored.driverId));
});

async function login(http: ReturnType<typeof request>, phoneNumber: string): Promise<string> {
  const response = await http.post("/api/v1/auth/login").send({ countryCode: "+970", phoneNumber, password }).expect(201);
  return response.body.accessToken as string;
}

async function cleanup(prisma: PrismaService): Promise<void> {
  const users = await prisma.user.findMany({ where: { phone: { in: Object.values(phones) } }, select: { id: true } });
  if (users.length === 0) return;
  const userIds = users.map((user) => user.id);
  const orders = await prisma.order.findMany({ where: { customerId: { in: userIds } }, select: { id: true } });
  const orderIds = orders.map((order) => order.id);
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.delivery.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.restaurant.deleteMany({ where: { ownerUserId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: { in: userIds } }, { entityId: { in: userIds } }] } });
  await prisma.refreshSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

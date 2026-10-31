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
 * Store audit B6/M7 on PostgreSQL: an administrator marks app-review demo accounts; demo and real
 * deliveries never cross between demo and real drivers; a demo order cannot be completed, so it
 * never gets a financial record, cash custody or earnings. No login shortcut exists: every account
 * here signs in with its own password through the normal endpoint.
 */
const runDatabaseE2e = process.env.RUN_DATABASE_E2E === "true";
if (runDatabaseE2e && process.env.NODE_ENV === "production") {
  throw new Error("This E2E refuses to run with NODE_ENV=production.");
}

const password = "DemoReview@12345";
const local = { admin: "0594650001", owner: "0594650002", demoCustomer: "0594650003", realCustomer: "0594650004", demoDriver: "0594650005", realDriver: "0594650006" };
const phones = Object.fromEntries(Object.entries(local).map(([key, value]) => [key, `+970${value.slice(1)}`])) as typeof local;

type Http = ReturnType<typeof request>;

test("demo accounts stay apart from real work and never reach money", { skip: !runDatabaseE2e, timeout: 120_000 }, async (context) => {
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
  const superAdminRole = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
  const create = (phone: string, role: UserRole, extra: Record<string, unknown> = {}) =>
    prisma.user.create({ data: { fullName: `Demo test ${role}`, phone, passwordHash, role, phoneVerifiedAt: new Date(), isActive: true, ...extra } });
  await create(phones.admin, UserRole.ADMIN, { platformRoleId: superAdminRole.id });
  const owner = await create(phones.owner, UserRole.RESTAURANT);
  const demoCustomer = await create(phones.demoCustomer, UserRole.CUSTOMER);
  const realCustomer = await create(phones.realCustomer, UserRole.CUSTOMER);
  const demoDriver = await create(phones.demoDriver, UserRole.DRIVER);
  const realDriver = await create(phones.realDriver, UserRole.DRIVER);
  for (const driver of [demoDriver, realDriver]) {
    await prisma.driverProfile.create({ data: { userId: driver.id, status: "APPROVED", isOnline: true, appLeaseUntil: new Date(Date.now() + 600_000) } });
  }
  const store = await prisma.restaurant.create({
    data: { ownerUserId: owner.id, name: "Demo Market", businessType: BusinessType.SUPERMARKET, status: RestaurantStatus.APPROVED, isOpen: true, phone: phones.owner, addressLine: "Demo street" }
  });
  const adminToken = await login(http, local.admin);

  await context.test("an administrator marks customers and drivers as demo accounts, with an audit entry", async () => {
    for (const user of [demoCustomer, demoDriver]) {
      const response = await http
        .patch(`/api/v1/admin/users/${user.id}/demo`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ isDemo: true, reason: "App review account" })
        .expect(200);
      assert.equal(response.body.isDemo, true);
    }
    assert.equal(await prisma.auditLog.count({ where: { action: "USER_MARKED_DEMO", entityId: demoCustomer.id } }), 1);
    const refused = await http
      .patch(`/api/v1/admin/users/${owner.id}/demo`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ isDemo: true, reason: "Store staff must not be demo" })
      .expect(409);
    assert.equal(refused.body.code, "DEMO_ROLE_NOT_ALLOWED");
  });

  await context.test("a customer cannot mark accounts", async () => {
    const token = await login(http, local.realCustomer);
    await http.patch(`/api/v1/admin/users/${realCustomer.id}/demo`).set("Authorization", `Bearer ${token}`).send({ isDemo: true, reason: "nope" }).expect(403);
  });

  const order = async (customerId: string, isDemo: boolean) => {
    const created = await prisma.order.create({
      data: {
        customerId,
        restaurantId: store.id,
        status: "READY_FOR_PICKUP",
        paymentMethod: "CASH",
        deliveryLabel: "Home",
        deliveryAddressLine: "Test address",
        subtotalMinor: 1000,
        deliveryFeeMinor: 500,
        totalMinor: 1500,
        isDemo
      }
    });
    const delivery = await prisma.delivery.create({ data: { orderId: created.id, status: "PENDING_ASSIGNMENT" } });
    return { order: created, delivery };
  };
  const demo = await order(demoCustomer.id, true);
  const real = await order(realCustomer.id, false);

  await context.test("each driver sees only their side's deliveries and cannot claim the other side's", async () => {
    const realToken = await login(http, local.realDriver);
    const demoToken = await login(http, local.demoDriver);
    const realList = await http.get("/api/v1/driver/me/deliveries/available").set("Authorization", `Bearer ${realToken}`).expect(200);
    const realIds = realList.body.map((delivery: { id: string }) => delivery.id);
    assert.ok(realIds.includes(real.delivery.id));
    assert.ok(!realIds.includes(demo.delivery.id));
    const demoList = await http.get("/api/v1/driver/me/deliveries/available").set("Authorization", `Bearer ${demoToken}`).expect(200);
    assert.deepEqual(demoList.body.map((delivery: { id: string }) => delivery.id), [demo.delivery.id]);

    await http.post(`/api/v1/driver/me/deliveries/${demo.delivery.id}/accept`).set("Authorization", `Bearer ${realToken}`).expect(404);
    await http.post(`/api/v1/driver/me/deliveries/${real.delivery.id}/accept`).set("Authorization", `Bearer ${demoToken}`).expect(404);
    await http.post(`/api/v1/driver/me/deliveries/${demo.delivery.id}/accept`).set("Authorization", `Bearer ${demoToken}`).expect(201);
  });

  await context.test("a demo delivery moves along but cannot be completed or failed, so no money is recorded", async () => {
    const demoToken = await login(http, local.demoDriver);
    const path = `/api/v1/driver/me/deliveries/${demo.delivery.id}/status`;
    await http.patch(path).set("Authorization", `Bearer ${demoToken}`).send({ status: "PICKED_UP" }).expect(200);
    await http.patch(path).set("Authorization", `Bearer ${demoToken}`).send({ status: "ON_THE_WAY" }).expect(200);
    const delivered = await http.patch(path).set("Authorization", `Bearer ${demoToken}`).send({ status: "DELIVERED" }).expect(409);
    assert.equal(delivered.body.code, "DEMO_ORDER_CANNOT_COMPLETE");
    const failed = await http.patch(path).set("Authorization", `Bearer ${demoToken}`).send({ status: "FAILED", failureReason: "CUSTOMER_UNREACHABLE" }).expect(409);
    assert.equal(failed.body.code, "DEMO_ORDER_CANNOT_COMPLETE");
    assert.equal(await prisma.orderFinancialRecord.count({ where: { orderId: demo.order.id } }), 0);
    assert.equal(await prisma.driverCashCustody.count({ where: { orderId: demo.order.id } }), 0);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: demo.order.id } })).status, "READY_FOR_PICKUP");
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
  const orders = await prisma.order.findMany({ where: { customerId: { in: userIds } }, select: { id: true } });
  const orderIds = orders.map((order) => order.id);
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.delivery.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.restaurant.deleteMany({ where: { ownerUserId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: { in: userIds } }, { entityId: { in: userIds } }] } });
  await prisma.refreshSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

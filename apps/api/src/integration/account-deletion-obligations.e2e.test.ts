import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { AppModule } from "../app.module";
import { hashPassword } from "../auth/crypto.util";
import { UserRole } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AccountDeletionSweepService } from "../users/account-deletion-sweep.service";

/**
 * Store audit H1 (run 2): driver and store-staff deletion against REAL obligation rows on
 * PostgreSQL: an assigned delivery, an outstanding cash custody and an unpaid earnings balance.
 * Proves the scheduled path, the sweep, the cleanup of sessions, push tokens and location, and that
 * the financial rows survive, still linked by id but no longer carrying a name or phone.
 * Read-only towards money: rows are inserted with fixed amounts only to create the obligations.
 */
const runDatabaseE2e = process.env.RUN_DATABASE_E2E === "true";
if (runDatabaseE2e && process.env.NODE_ENV === "production") {
  throw new Error("This E2E refuses to run with NODE_ENV=production.");
}

const password = "Obligation@12345";
const local = { owner: "0594630001", customer: "0594630002", driverA: "0594630003", driverB: "0594630004", staff: "0594630005" };
const phones = Object.fromEntries(Object.entries(local).map(([key, value]) => [key, `+970${value.slice(1)}`])) as typeof local;
const createdIds: string[] = [];
const createdOrderIds: string[] = [];

type Http = ReturnType<typeof request>;

test("driver and store-staff deletion with real obligations", { skip: !runDatabaseE2e, timeout: 120_000 }, async (context) => {
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
  const create = async (phone: string, role: UserRole, fullName: string) => {
    const user = await prisma.user.create({ data: { fullName, phone, passwordHash, role, phoneVerifiedAt: new Date(), isActive: true } });
    createdIds.push(user.id);
    return user;
  };
  const owner = await create(phones.owner, UserRole.RESTAURANT, "Obligation Owner");
  const customer = await create(phones.customer, UserRole.CUSTOMER, "Obligation Customer");
  const driverA = await create(phones.driverA, UserRole.DRIVER, "Obligation Driver A");
  const driverB = await create(phones.driverB, UserRole.DRIVER, "Obligation Driver B");
  const staff = await create(phones.staff, UserRole.RESTAURANT, "Obligation Staff");
  for (const driver of [driverA, driverB]) {
    await prisma.driverProfile.create({
      data: { userId: driver.id, status: "APPROVED", isOnline: true, lastLatitude: 31.9, lastLongitude: 35.2, lastLocationAt: new Date() }
    });
    await prisma.pushToken.create({ data: { userId: driver.id, token: `ExponentPushToken[obligation-${driver.id}]`, platform: "android" } });
  }
  const store = await prisma.restaurant.create({
    data: { ownerUserId: owner.id, name: "Obligation Store", phone: phones.owner, addressLine: "Test street" }
  });
  const staffRole = await prisma.role.findUniqueOrThrow({ where: { key: "BUSINESS_STAFF" } });
  await prisma.businessMember.create({ data: { userId: staff.id, businessId: store.id, roleId: staffRole.id, isActive: true } });
  const rateSet = await prisma.financialRateSet.findFirstOrThrow();

  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      restaurantId: store.id,
      paymentMethod: "CASH",
      deliveryLabel: "Home",
      deliveryAddressLine: "Test address",
      subtotalMinor: 1000,
      deliveryFeeMinor: 500,
      totalMinor: 1500
    } as never
  });
  createdOrderIds.push(order.id);
  const delivery = await prisma.delivery.create({ data: { orderId: order.id, driverId: driverA.id, status: "ASSIGNED" } as never });
  const record = await prisma.orderFinancialRecord.create({
    data: {
      orderId: order.id,
      businessId: store.id,
      rateSetId: rateSet.id,
      vertical: "SUPERMARKET",
      outcome: "DELIVERED",
      isPromotionalBusiness: false,
      itemSubtotalMinor: 1000,
      deliveryFeeMinor: 500,
      cashCollectedMinor: 1500
    } as never
  });
  const custody = await prisma.driverCashCustody.create({
    data: {
      orderId: order.id,
      orderFinancialRecordId: record.id,
      driverUserId: driverA.id,
      expectedAmountMinor: 1500,
      collectedAmountMinor: 1500,
      collectedAt: new Date()
    }
  });
  const earning = await prisma.partnerEarning.create({
    data: {
      sourceType: "ORDER",
      sourceId: record.id,
      orderFinancialRecordId: record.id,
      payeeType: "DRIVER",
      payeeKey: `DRIVER:${driverB.id}`,
      driverUserId: driverB.id,
      component: "DRIVER_DELIVERY_SHARE",
      amountMinor: 300,
      occurredAt: new Date()
    } as never
  });

  await context.test("a driver with an assigned delivery and unsettled cash is scheduled, not deleted", async () => {
    const token = await login(http, local.driverA);
    const first = await http.delete("/api/v1/users/me").set("Authorization", `Bearer ${token}`).expect(202);
    assert.equal(first.body.status, "SCHEDULED");
    assert.deepEqual(first.body.blockers, ["ACTIVE_DELIVERY", "OUTSTANDING_CASH"]);
    const again = await http.delete("/api/v1/users/me").set("Authorization", `Bearer ${token}`).expect(202);
    assert.equal(again.body.scheduledFor, first.body.scheduledFor, "asking again never moves the date");
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: driverA.id } });
    assert.equal(stored.isActive, true);
    assert.equal(stored.fullName, "Obligation Driver A");
  });

  await context.test("the sweep leaves a due deletion pending while the obligations remain", async () => {
    await prisma.accountDeletionRequest.update({ where: { userId: driverA.id }, data: { scheduledFor: new Date(Date.now() - 60_000) } });
    await app.get(AccountDeletionSweepService).processDue(new Date());
    const pending = await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { userId: driverA.id } });
    assert.equal(pending.status, "PENDING");
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: driverA.id } })).isActive, true);
  });

  await context.test("once delivered and settled the sweep anonymises and clears sessions, tokens and position", async () => {
    await prisma.delivery.update({ where: { id: delivery.id }, data: { status: "DELIVERED" } });
    await prisma.driverCashCustody.update({ where: { id: custody.id }, data: { settledAmountMinor: 1500, status: "SETTLED" } });
    await app.get(AccountDeletionSweepService).processDue(new Date());

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: driverA.id }, include: { driverProfile: true } });
    assert.equal(stored.isActive, false);
    assert.equal(stored.fullName, "Deleted account");
    assert.equal(stored.phone, `deleted-${driverA.id}`);
    assert.equal(stored.driverProfile?.lastLatitude, null);
    assert.equal(stored.driverProfile?.lastLongitude, null);
    assert.equal(stored.driverProfile?.isOnline, false);
    assert.equal(await prisma.pushToken.count({ where: { userId: driverA.id } }), 0);
    assert.equal(await prisma.refreshSession.count({ where: { userId: driverA.id, revokedAt: null } }), 0);
    assert.equal((await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { userId: driverA.id } })).status, "COMPLETED");

    // The financial history survives, still linked by id, with no name or phone left to read.
    const kept = await prisma.driverCashCustody.findUniqueOrThrow({ where: { id: custody.id }, include: { driver: true } });
    assert.equal(kept.collectedAmountMinor, 1500);
    assert.equal(kept.driver.fullName, "Deleted account");
    assert.ok(!kept.driver.phone.startsWith("+"));
    assert.equal((await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } })).driverId, driverA.id);
  });

  await context.test("a driver with an unpaid earnings balance is scheduled and the earning row is untouched", async () => {
    const token = await login(http, local.driverB);
    const response = await http.delete("/api/v1/users/me").set("Authorization", `Bearer ${token}`).expect(202);
    assert.deepEqual(response.body.blockers, ["UNSETTLED_EARNINGS"]);
    await http.get("/api/v1/users/me/deletion").set("Authorization", `Bearer ${token}`).expect(200);
    const kept = await prisma.partnerEarning.findUniqueOrThrow({ where: { id: earning.id } });
    assert.equal(kept.amountMinor, 300);
  });

  await context.test("store staff are deleted at once: memberships, sessions and push tokens end", async () => {
    await prisma.pushToken.create({ data: { userId: staff.id, token: `ExponentPushToken[obligation-${staff.id}]`, platform: "android" } });
    const token = await login(http, local.staff);
    await http.delete("/api/v1/users/me").set("Authorization", `Bearer ${token}`).expect(204);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: staff.id } });
    assert.equal(stored.isActive, false);
    assert.equal(stored.phone, `deleted-${staff.id}`);
    assert.equal(await prisma.businessMember.count({ where: { userId: staff.id, isActive: true } }), 0);
    assert.equal(await prisma.pushToken.count({ where: { userId: staff.id } }), 0);
    assert.equal(await prisma.refreshSession.count({ where: { userId: staff.id, revokedAt: null } }), 0);
    await http.get("/api/v1/users/me").set("Authorization", `Bearer ${token}`).expect(401);
  });

  await context.test("the store owner is refused and keeps the account", async () => {
    const token = await login(http, local.owner);
    const response = await http.delete("/api/v1/users/me").set("Authorization", `Bearer ${token}`).expect(409);
    assert.equal(response.body.code, "BUSINESS_OWNER_DELETION_REQUIRES_ADMIN");
  });
});

async function login(http: Http, phoneNumber: string): Promise<string> {
  const response = await http.post("/api/v1/auth/login").send({ countryCode: "+970", phoneNumber, password }).expect(201);
  return response.body.accessToken as string;
}

async function cleanup(prisma: PrismaService): Promise<void> {
  const users = await prisma.user.findMany({
    where: { OR: [{ phone: { in: Object.values(phones) } }, { id: { in: createdIds } }] },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);
  const orders = await prisma.order.findMany({
    where: { OR: [{ id: { in: createdOrderIds } }, { customerId: { in: userIds } }] },
    select: { id: true }
  });
  const orderIds = orders.map((order) => order.id);
  if (orderIds.length > 0) {
    // Financial rows are append-only by database trigger. On this throwaway test database only
    // (the suite refuses any database whose name lacks "test"), the triggers are bypassed for this
    // one cleanup transaction so the suite can be re-run; production keeps them.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.partnerEarning.deleteMany({ where: { orderFinancialRecord: { orderId: { in: orderIds } } } });
      await tx.driverCashCustody.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.orderFinancialRecord.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.delivery.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.order.deleteMany({ where: { id: { in: orderIds } } });
    });
  }
  if (userIds.length === 0) return;
  await prisma.businessMember.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.restaurant.deleteMany({ where: { ownerUserId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: { in: userIds } }, { entityId: { in: userIds } }] } });
  await prisma.accountDeletionRequest.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.pushToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.refreshSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

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
import { reactivateOffers, suspendActivePlatformOffers } from "./ambient-offers.util";
import { withFinancialTriggersDisabled } from "./financial-triggers.util";

/**
 * The driver's main cash screen starts fresh after a settlement, while nothing is lost.
 *
 * "Settlement confirmed" is the admin recording a cash handover (POST /admin/accounting/cash/
 * settlements): it allocates the counted cash against the driver's outstanding custody rows and
 * writes a CashSettlement. That is the trigger. The driver's default view is the current period
 * (SHIFT = since the last handover) plus the standing balance, so after a full handover both read
 * zero; the settled period moves to the driver's History, and the ledger rows and the admin's
 * accounting views are exactly as they were.
 */

const runDatabaseE2e = process.env.RUN_DATABASE_E2E === "true";
if (runDatabaseE2e && process.env.NODE_ENV === "production") {
  throw new Error("This E2E refuses to run with NODE_ENV=production.");
}

const password = "Settle@12345";
const phones = { admin: "+970594300001", customer: "+970594300002", market: "+970594300003", driver: "+970594300004" };
const local = { admin: "0594300001", customer: "0594300002", market: "0594300003", driver: "0594300004" };
const marketLocation = { latitude: 31.9038, longitude: 35.2034 };
const customerLocation = { deliveryLatitude: 31.9038, deliveryLongitude: 35.2184 };

type Http = ReturnType<typeof request>;

test(
  "after an admin-confirmed handover the driver's main screen starts from zero, and the settled period stays in history",
  { skip: !runDatabaseE2e, timeout: 180_000 },
  async (context) => {
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
    const suspendedOfferIds = await suspendActivePlatformOffers(prisma);
    context.after(async () => {
      try {
        await cleanup(prisma);
      } finally {
        await reactivateOffers(prisma, suspendedOfferIds);
        await app.close();
      }
    });

    await cleanup(prisma);
    const actors = await createActors(http, prisma);
    const summary = async (period?: string) =>
      (
        await http
          .get(`/api/v1/driver/me/cash-summary${period ? `?period=${period}` : ""}`)
          .set("Authorization", `Bearer ${actors.driverToken}`)
          .expect(200)
      ).body;
    const history = async () =>
      (await http.get("/api/v1/driver/me/cash-handovers").set("Authorization", `Bearer ${actors.driverToken}`).expect(200)).body;

    // ---------------------------------------------------------------- 1. accumulate
    const first = await deliverOrder(http, prisma, actors);
    const second = await deliverOrder(http, prisma, actors);
    const accumulated = await summary();
    const custodyBefore = await prisma.driverCashCustody.findMany({ where: { driverUserId: actors.driverId }, orderBy: { collectedAt: "asc" } });
    const earningsBefore = await prisma.partnerEarning.findMany({ where: { driverUserId: actors.driverId } });

    await context.test("before settlement the main screen accumulates both deliveries", () => {
      assert.equal(accumulated.period, "SHIFT", "the main screen's default period is 'since last handover'");
      assert.equal(accumulated.lastHandoverAt, null);
      assert.equal(accumulated.deliveredCount, 2);
      assert.equal(custodyBefore.length, 2);
      const held = custodyBefore.reduce((sum, row) => sum + row.collectedAmountMinor, 0);
      assert.ok(held > 0);
      assert.equal(accumulated.cashCollectedMinor, held);
      assert.equal(accumulated.balance.cashOwedToPlatformMinor, held);
      assert.equal(accumulated.earningsMinor, earningsBefore.reduce((sum, row) => sum + row.amountMinor, 0));
      assert.ok(accumulated.earningsMinor > 0);
      assert.deepEqual(
        accumulated.lines.map((line: any) => line.orderId).sort(),
        [first, second].sort()
      );
    });

    // ---------------------------------------------------------------- 2. admin confirms the handover
    const reference = `SETTLE-E2E-${Date.now()}`;
    const settlement = (
      await http
        .post("/api/v1/admin/accounting/cash/settlements")
        .set("Authorization", `Bearer ${actors.adminToken}`)
        .send({ driverUserId: actors.driverId, reference, countedAmountMinor: accumulated.balance.cashOwedToPlatformMinor })
        .expect(201)
    ).body;

    await context.test("after the handover the main screen is fresh: nothing held, nothing owed, no earnings yet", async () => {
      const fresh = await summary();
      assert.ok(fresh.lastHandoverAt, "the current period now starts at the handover");
      assert.equal(fresh.cashCollectedMinor, 0);
      assert.equal(fresh.cashHandedOverMinor, 0);
      assert.equal(fresh.earningsMinor, 0);
      assert.equal(fresh.deliveredCount, 0);
      assert.equal(fresh.lines.length, 0);
      assert.equal(fresh.balance.cashOwedToPlatformMinor, 0);
      assert.equal(fresh.balance.unsettledOrderCount, 0);
      assert.equal(fresh.balance.openOrders.length, 0);
    });

    // ---------------------------------------------------------------- 3. a new delivery starts from zero
    const third = await deliverOrder(http, prisma, actors);
    const thirdCustody = await prisma.driverCashCustody.findUniqueOrThrow({ where: { orderId: third } });
    const thirdRecord = await prisma.orderFinancialRecord.findUniqueOrThrow({ where: { orderId: third } });

    await context.test("a delivery after the handover starts a new balance from zero", async () => {
      const current = await summary();
      assert.equal(current.deliveredCount, 1);
      assert.equal(current.cashCollectedMinor, thirdCustody.collectedAmountMinor, "only the new order, not the settled ones");
      assert.equal(current.balance.cashOwedToPlatformMinor, thirdCustody.collectedAmountMinor);
      assert.equal(current.earningsMinor, thirdRecord.driverShareMinor);
      assert.deepEqual(current.lines.map((line: any) => line.orderId), [third]);
      assert.deepEqual(current.balance.openOrders.map((line: any) => line.orderId), [third]);
    });

    // ---------------------------------------------------------------- 4. nothing was lost
    await context.test("the settled period is in the driver's History with its real figures", async () => {
      const past = await history();
      assert.equal(past.periods.length, 1);
      const [period] = past.periods;
      assert.equal(period.settlementId, settlement.id);
      assert.equal(period.periodStart, null, "the driver's first period");
      assert.equal(period.cashHandedOverMinor, accumulated.balance.cashOwedToPlatformMinor);
      assert.equal(period.expectedAmountMinor, accumulated.balance.cashOwedToPlatformMinor);
      assert.equal(period.countedAmountMinor, accumulated.balance.cashOwedToPlatformMinor);
      assert.equal(period.discrepancyMinor, 0);
      assert.equal(period.settledOrderCount, 2);
      assert.equal(period.deliveredCount, 2);
      assert.equal(period.earningsMinor, accumulated.earningsMinor);
      // The new, unsettled delivery belongs to the current period, never to history.
      assert.ok(Date.parse(period.settledAt) <= thirdCustody.collectedAt.getTime());
    });

    await context.test("every ledger row still exists, marked settled rather than altered or removed", async () => {
      const custodyAfter = await prisma.driverCashCustody.findMany({ where: { orderId: { in: [first, second] } }, orderBy: { collectedAt: "asc" } });
      assert.equal(custodyAfter.length, 2);
      for (const [index, row] of custodyAfter.entries()) {
        assert.equal(row.id, custodyBefore[index].id);
        assert.equal(row.collectedAmountMinor, custodyBefore[index].collectedAmountMinor, "collected amounts are untouched");
        assert.equal(row.collectedAt.getTime(), custodyBefore[index].collectedAt.getTime());
        assert.equal(row.status, "SETTLED");
        assert.equal(row.settledAmountMinor, row.collectedAmountMinor);
      }
      const earningsAfter = await prisma.partnerEarning.findMany({ where: { id: { in: earningsBefore.map((row) => row.id) } } });
      assert.equal(earningsAfter.length, earningsBefore.length, "no earning row was removed");
      assert.deepEqual(
        earningsAfter.map((row) => row.amountMinor).sort(),
        earningsBefore.map((row) => row.amountMinor).sort()
      );
      const allocations = await prisma.cashSettlementAllocation.findMany({ where: { settlementId: settlement.id } });
      assert.equal(allocations.length, 2);
      const deliveries = await prisma.delivery.count({ where: { driverId: actors.driverId, status: "DELIVERED" } });
      assert.equal(deliveries, 3);
    });

    await context.test("the driver can still look back over everything with the ALL period", async () => {
      const all = await summary("ALL");
      assert.equal(all.deliveredCount, 3);
      assert.equal(all.cashCollectedMinor, accumulated.cashCollectedMinor + thirdCustody.collectedAmountMinor);
      assert.equal(all.cashHandedOverMinor, accumulated.cashCollectedMinor);
      assert.equal(all.lines.length, 3);
    });

    await context.test("the admin's accounting views still show the full record", async () => {
      const handovers = (await http.get("/api/v1/admin/accounting/cash/settlements").set("Authorization", `Bearer ${actors.adminToken}`).expect(200)).body;
      const recorded = handovers.find((entry: any) => entry.id === settlement.id);
      assert.ok(recorded, "the handover is listed for the admin");
      assert.equal(recorded.countedAmountMinor, accumulated.balance.cashOwedToPlatformMinor);

      // The admin's per-driver view behaves exactly as before: outstanding orders by default, and the
      // full record, settled orders included, on request.
      const outstanding = JSON.stringify(
        (await http.get(`/api/v1/admin/accounting/cash/drivers/${actors.driverId}`).set("Authorization", `Bearer ${actors.adminToken}`).expect(200)).body
      );
      assert.ok(outstanding.includes(third), "the unsettled order is outstanding");
      assert.ok(!outstanding.includes(first) && !outstanding.includes(second), "settled orders are not outstanding");
      const everything = JSON.stringify(
        (
          await http
            .get(`/api/v1/admin/accounting/cash/drivers/${actors.driverId}?includeSettled=true`)
            .set("Authorization", `Bearer ${actors.adminToken}`)
            .expect(200)
        ).body
      );
      for (const orderId of [first, second, third]) {
        assert.ok(everything.includes(orderId), `the admin's full driver view still includes order ${orderId}`);
      }

      const orderView = (await http.get(`/api/v1/admin/accounting/orders/${first}`).set("Authorization", `Bearer ${actors.adminToken}`).expect(200)).body;
      assert.ok(orderView, "a settled order's financial record is still readable by the admin");
    });

    await context.test("history is the driver's own: other roles are refused", async () => {
      await http.get("/api/v1/driver/me/cash-handovers").set("Authorization", `Bearer ${actors.customerToken}`).expect(403);
      await http.get("/api/v1/driver/me/cash-handovers").expect(401);
    });
  }
);

type Actors = Awaited<ReturnType<typeof createActors>>;

async function createActors(http: Http, prisma: PrismaService) {
  const passwordHash = await hashPassword(password);
  const superAdminRole = await prisma.role.findUnique({ where: { key: "SUPER_ADMIN" } });
  assert.ok(superAdminRole, "System roles must be migrated before running this suite.");
  await prisma.user.create({
    data: { platformRoleId: superAdminRole.id, fullName: "Settle E2E Admin", phone: phones.admin, passwordHash, role: UserRole.ADMIN, phoneVerifiedAt: new Date(), isActive: true }
  });
  await prisma.user.create({
    data: { fullName: "Settle E2E Customer", phone: phones.customer, passwordHash, role: UserRole.CUSTOMER, phoneVerifiedAt: new Date(), isActive: true }
  });
  const adminToken = await login(http, local.admin);
  const customerToken = await login(http, local.customer);

  const registration = await http
    .post("/api/v1/restaurants/register")
    .send({
      ownerFullName: "Settle E2E Market Owner",
      countryCode: "+970",
      phoneNumber: local.market,
      password,
      confirmPassword: password,
      restaurantName: "Settle E2E MARKET",
      businessType: "SUPERMARKET",
      addressLine: "Settlement Street, Ramallah"
    })
    .expect(201);
  const marketId = registration.body.restaurantId as string;
  const marketToken = await login(http, local.market);
  await http.patch("/api/v1/restaurant/me").set("Authorization", `Bearer ${marketToken}`).send({ addressLine: "Settlement Street", ...marketLocation }).expect(200);
  await http.post(`/api/v1/admin/restaurants/${marketId}/approve`).set("Authorization", `Bearer ${adminToken}`).expect(201);
  await http.patch("/api/v1/restaurant/me/open-status").set("Authorization", `Bearer ${marketToken}`).send({ isOpen: true }).expect(200);
  const category = await http.post("/api/v1/restaurant/me/menu/categories").set("Authorization", `Bearer ${marketToken}`).send({ name: "Settle Section", sortOrder: 1 }).expect(201);
  const item = await http
    .post("/api/v1/restaurant/me/menu/items")
    .set("Authorization", `Bearer ${marketToken}`)
    .send({ categoryId: category.body.id, name: "Settle Olive Oil", priceMinor: 5_000, costPriceMinor: 3_500 })
    .expect(201);

  const created = await http
    .post("/api/v1/drivers/register")
    .send({ fullName: "Settle E2E Driver", countryCode: "+970", phoneNumber: local.driver, password, confirmPassword: password })
    .expect(201);
  const driverId = created.body.userId as string;
  await http.post(`/api/v1/admin/drivers/${driverId}/approve`).set("Authorization", `Bearer ${adminToken}`).expect(201);
  const driverToken = await login(http, local.driver);
  await http.patch("/api/v1/driver/me/status").set("Authorization", `Bearer ${driverToken}`).send({ isOnline: true }).expect(200);
  await http.put("/api/v1/driver/me/presence").set("Authorization", `Bearer ${driverToken}`).send({ state: "FOREGROUND" });

  return { adminToken, customerToken, marketToken, marketId, itemId: item.body.id as string, driverId, driverToken };
}

/** Place a cash order, take it to ready, and have the driver accept and deliver it. */
async function deliverOrder(http: Http, prisma: PrismaService, actors: Actors): Promise<string> {
  const order = await http
    .post("/api/v1/orders")
    .set("Authorization", `Bearer ${actors.customerToken}`)
    .send({
      restaurantId: actors.marketId,
      items: [{ menuItemId: actors.itemId, quantity: 1 }],
      deliveryLabel: "Home",
      deliveryAddressLine: "Settlement Lane 3",
      ...customerLocation,
      paymentMethod: "CASH"
    })
    .expect(201);
  const orderId = order.body.id as string;
  for (const status of ["ACCEPTED", "PREPARING", "READY_FOR_PICKUP"] as const) {
    await http.patch(`/api/v1/restaurant/me/orders/${orderId}/status`).set("Authorization", `Bearer ${actors.marketToken}`).send({ status }).expect(200);
  }
  const delivery = await prisma.delivery.findUniqueOrThrow({ where: { orderId } });
  await http.post(`/api/v1/driver/me/deliveries/${delivery.id}/accept`).set("Authorization", `Bearer ${actors.driverToken}`).expect(201);
  for (const status of ["PICKED_UP", "ON_THE_WAY", "DELIVERED"] as const) {
    await http.patch(`/api/v1/driver/me/deliveries/${delivery.id}/status`).set("Authorization", `Bearer ${actors.driverToken}`).send({ status }).expect(200);
  }
  // Keep each delivery's timestamps strictly after the previous handover.
  await new Promise((resolve) => setTimeout(resolve, 20));
  return orderId;
}

async function login(http: Http, phoneNumber: string): Promise<string> {
  const response = await http.post("/api/v1/auth/login").send({ countryCode: "+970", phoneNumber, password }).expect(201);
  return response.body.accessToken as string;
}

async function cleanup(prisma: PrismaService): Promise<void> {
  const users = await prisma.user.findMany({
    where: { phone: { in: Object.values(phones) } },
    select: { id: true, restaurant: { select: { id: true } } }
  });
  if (users.length === 0) return;
  const userIds = users.map((user) => user.id);
  const businessIds = users.flatMap((user) => (user.restaurant ? [user.restaurant.id] : []));
  const orderWhere = businessIds.length > 0 ? { restaurantId: { in: businessIds } } : { id: "" };

  await withFinancialTriggersDisabled(prisma, async () => {
    const recordIds = (
      await prisma.orderFinancialRecord.findMany({ where: businessIds.length ? { businessId: { in: businessIds } } : { id: "" }, select: { id: true } })
    ).map((record) => record.id);
    await prisma.cashSettlementAllocation.deleteMany({ where: { custody: { driverUserId: { in: userIds } } } });
    await prisma.driverCashCustody.deleteMany({ where: { driverUserId: { in: userIds } } });
    await prisma.cashSettlement.deleteMany({ where: { OR: [{ driverUserId: { in: userIds } }, { receivedByUserId: { in: userIds } }] } });
    await prisma.partnerSettlementAllocation.deleteMany({
      where: { earning: { OR: [{ driverUserId: { in: userIds } }, { orderFinancialRecordId: { in: recordIds } }] } }
    });
    await prisma.partnerSettlement.deleteMany({ where: { OR: [{ driverUserId: { in: userIds } }, { paidByUserId: { in: userIds } }] } });
    await prisma.partnerEarning.deleteMany({ where: { OR: [{ orderFinancialRecordId: { in: recordIds } }, { driverUserId: { in: userIds } }] } });
    await prisma.orderFinancialRecord.deleteMany({ where: { id: { in: recordIds } } });
  });

  await prisma.delivery.deleteMany({ where: { OR: [{ driverId: { in: userIds } }, { order: orderWhere }] } });
  await prisma.orderStatusHistory.deleteMany({ where: { changedByUserId: { in: userIds } } });
  await prisma.inventoryMovement.deleteMany({ where: { restaurantId: { in: businessIds } } });
  await prisma.order.deleteMany({
    where: { OR: [{ customerId: { in: userIds } }, ...(businessIds.length ? [{ restaurantId: { in: businessIds } }] : [])] }
  });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

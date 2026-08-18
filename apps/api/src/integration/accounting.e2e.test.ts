import "reflect-metadata";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { AppModule } from "../app.module";
import { hashPassword } from "../auth/crypto.util";
import { UserRole } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { withFinancialTriggersDisabled } from "./financial-triggers.util";

/**
 * The accounting layer, end to end against the real database.
 *
 * This suite exists because the guarantees that matter here are not in TypeScript. Double
 * settlement is prevented by a CHECK constraint, double computation by a unique index, and the
 * immutability of financial history by a trigger — none of which a test double can demonstrate.
 * So every assertion below runs through real HTTP against real PostgreSQL, and the two worked
 * examples are checked line by line against arithmetic done on paper.
 */

const runDatabaseE2e = process.env.RUN_DATABASE_E2E === "true";
if (runDatabaseE2e && process.env.NODE_ENV === "production") {
  throw new Error("The accounting E2E refuses to run with NODE_ENV=production.");
}
// The restaurant vertical is behind a launch flag; this suite values restaurant orders, so it
// opts in explicitly rather than depending on the flag's real (off) default.
// Belt and braces. The value that actually takes effect is set by scripts/run-api-e2e.mjs before
// this process starts, because imports are hoisted above this statement and ConfigModule reads the
// environment as AppModule is imported. This line only helps a run started some other way.
if (runDatabaseE2e && process.env.RESTAURANT_ORDERING_ENABLED === undefined) {
  process.env.RESTAURANT_ORDERING_ENABLED = "true";
}

const password = "Ledger@12345";
const phones = {
  admin: "+970594100001",
  customer: "+970594100002",
  restaurant: "+970594100003",
  driver: "+970594100004",
  supermarket: "+970594100005"
};
const local = {
  admin: "0594100001",
  customer: "0594100002",
  restaurant: "0594100003",
  driver: "0594100004",
  supermarket: "0594100005"
};

/** Both businesses and the delivery address sit inside the 3 km included radius, so every order in
 *  this suite carries the 10.00 minimum delivery fee and the arithmetic stays checkable by hand. */
const businessLocation = { latitude: 31.9038, longitude: 35.2034 };
const customerLocation = { deliveryLatitude: 31.9038, deliveryLongitude: 35.2184 };
const minimumDeliveryFeeMinor = 1_000;

type Http = ReturnType<typeof request>;

test(
  "the accounting layer values both verticals, tracks cash custody, and refuses to be rewritten",
  { skip: !runDatabaseE2e, timeout: 240_000 },
  async (context) => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    configureTestApp(app);
    await app.init();
    const prisma = app.get(PrismaService);
    const http = request(app.getHttpServer());
    try {
      assertSafeE2eDatabase(app.get(ConfigService).getOrThrow<string>("DATABASE_URL"));
    } catch (error) {
      await app.close();
      throw error;
    }

    context.after(async () => {
      try {
        await cleanup(prisma);
      } finally {
        await app.close();
      }
    });

    await cleanup(prisma);
    const actors = await createActors(http, prisma);

    // =========================================================================================
    let restaurantOrderId = "";
    await context.test("WORKED EXAMPLE — a 100.00 restaurant order splits to the shekel", async () => {
      const { orderId } = await placeAndDeliver(http, actors, {
        businessId: actors.restaurantId,
        token: actors.restaurantToken,
        items: [{ menuItemId: actors.mealId, quantity: 2 }]
      });
      restaurantOrderId = orderId;

      const record = await readRecord(http, actors.adminToken, orderId);

      //   items 2 x 50.00                        100.00
      //   delivery fee (minimum)                  10.00
      //   customer pays                          110.00
      assert.equal(record.itemSubtotalMinor, 10_000);
      assert.equal(record.deliveryFeeMinor, minimumDeliveryFeeMinor);
      assert.equal(record.cashCollectedMinor, 11_000);
      assert.equal(record.vertical, "RESTAURANT");
      assert.equal(record.outcome, "DELIVERED");

      //   commission 20% of 100.00                20.00
      assert.equal(record.commissionBp, 2_000);
      assert.equal(record.commissionMinor, 2_000);
      //   driver 70% of 10.00                      7.00, remainder 3.00
      assert.equal(record.driverShareMinor, 700);
      assert.equal(record.deliveryRemainderMinor, 300);

      const by = entryIndex(record);
      assert.equal(by(`BUSINESS:${actors.restaurantId}`, "BUSINESS_MERCHANDISE_NET"), 8_000);
      assert.equal(by(`PARTNER:${actors.ownerAId}`, "PLATFORM_COMMISSION_SHARE"), 1_000);
      assert.equal(by(`PARTNER:${actors.ownerBId}`, "PLATFORM_COMMISSION_SHARE"), 1_000);
      assert.equal(by(`DRIVER:${actors.driverUserId}`, "DRIVER_DELIVERY_SHARE"), 700);
      assert.equal(by(`PARTNER:${actors.deliveryOpsId}`, "DELIVERY_OPS_SHARE"), 100);
      assert.equal(by(`PARTNER:${actors.ownerAId}`, "PLATFORM_DELIVERY_SHARE"), 100);
      assert.equal(by(`PARTNER:${actors.ownerBId}`, "PLATFORM_DELIVERY_SHARE"), 100);

      //   80.00 + 10.00 + 10.00 + 7.00 + 1.00 + 1.00 + 1.00 = 110.00
      assert.equal(record.reconciliation.distributedMinor, 11_000);
      assert.equal(record.reconciliation.balancedMinor, 0, "the split must equal the cash collected");
    });

    // =========================================================================================
    await context.test("WORKED EXAMPLE — a 200.00 JOVO MARKET order pays cost plus a 40/30/30 margin", async () => {
      const { orderId } = await placeAndDeliver(http, actors, {
        businessId: actors.supermarketId,
        token: actors.supermarketToken,
        items: [{ menuItemId: actors.groceryId, quantity: 2 }]
      });

      const record = await readRecord(http, actors.adminToken, orderId);

      //   goods at retail 2 x 100.00             200.00
      //   delivery fee (minimum)                  10.00
      //   customer pays                          210.00
      assert.equal(record.vertical, "SUPERMARKET");
      assert.equal(record.itemSubtotalMinor, 20_000);
      assert.equal(record.cashCollectedMinor, 21_000);
      assert.equal(record.commissionBp, null, "a supermarket order has no commission at all");
      assert.equal(record.commissionMinor, 0);

      //   cost of goods 2 x 70.00                140.00
      //   margin 200.00 - 140.00                  60.00
      assert.equal(record.goodsCostMinor, 14_000);
      assert.equal(record.costDataComplete, true);
      assert.equal(record.marginMinor, 6_000);

      const by = entryIndex(record);
      assert.equal(by(`BUSINESS:${actors.supermarketId}`, "SUPERMARKET_GOODS_COST"), 14_000);
      assert.equal(by(`BUSINESS:${actors.supermarketId}`, "SUPERMARKET_MARGIN_SHARE"), 2_400, "40% of 60.00");
      assert.equal(by(`PARTNER:${actors.ownerAId}`, "SUPERMARKET_MARGIN_SHARE"), 1_800, "30% of 60.00");
      assert.equal(by(`PARTNER:${actors.ownerBId}`, "SUPERMARKET_MARGIN_SHARE"), 1_800, "30% of 60.00");
      assert.equal(by(`DRIVER:${actors.driverUserId}`, "DRIVER_DELIVERY_SHARE"), 700);
      assert.equal(by(`PARTNER:${actors.deliveryOpsId}`, "DELIVERY_OPS_SHARE"), 100);

      //   partner 140.00 + 24.00 = 164.00, owners 19.00 each, Abdullah 1.00, driver 7.00 = 210.00
      const partnerTotal = payeeTotal(record, `BUSINESS:${actors.supermarketId}`);
      assert.equal(partnerTotal, 16_400);
      assert.equal(payeeTotal(record, `PARTNER:${actors.ownerAId}`), 1_900);
      assert.equal(payeeTotal(record, `PARTNER:${actors.ownerBId}`), 1_900);
      assert.equal(record.reconciliation.distributedMinor, 21_000);
      assert.equal(record.reconciliation.balancedMinor, 0);
    });

    // =========================================================================================
    await context.test("an order is valued exactly once, however many times it is asked for", async () => {
      const records = await prisma.orderFinancialRecord.count({ where: { orderId: restaurantOrderId } });
      assert.equal(records, 1);
      // The database, not the service, is what makes this impossible.
      await assert.rejects(
        () =>
          prisma.orderFinancialRecord.create({
            data: {
              orderId: restaurantOrderId,
              businessId: actors.restaurantId,
              rateSetId: actors.rateSetV1Id,
              vertical: "RESTAURANT",
              outcome: "DELIVERED",
              isPromotionalBusiness: false,
              commissionBp: 2_000,
              itemSubtotalMinor: 1,
              deliveryFeeMinor: 0,
              cashCollectedMinor: 1
            }
          }),
        /Unique constraint|duplicate key/i
      );
    });

    // =========================================================================================
    await context.test("cash custody is recorded as collected, and separately from the driver's pay", async () => {
      const custody = await prisma.driverCashCustody.findMany({
        where: { driverUserId: actors.driverUserId },
        orderBy: { collectedAt: "asc" }
      });
      assert.equal(custody.length, 2, "one per delivered order");
      assert.equal(custody[0]!.collectedAmountMinor, 11_000);
      assert.equal(custody[1]!.collectedAmountMinor, 21_000);
      assert.equal(custody.every((row) => row.settledAmountMinor === 0), true, "collected is not settled");

      const cash = await http
        .get("/api/v1/admin/accounting/cash/drivers")
        .set("Authorization", `Bearer ${actors.adminToken}`)
        .expect(200);
      const driverRow = cash.body.find((row: { driverUserId: string }) => row.driverUserId === actors.driverUserId);
      assert.ok(driverRow);
      assert.equal(driverRow.outstandingMinor, 32_000, "the driver is holding 320.00 of customers' cash");
      assert.equal(driverRow.earningsMinor, 1_400, "and has earned 14.00, which is a different number");
      assert.equal(driverRow.earningsPaidMinor, 0);
    });

    // =========================================================================================
    await context.test("a partial handover settles only as far as the money goes", async () => {
      const settlement = await http
        .post("/api/v1/admin/accounting/cash/settlements")
        .set("Authorization", `Bearer ${actors.adminToken}`)
        .send({
          driverUserId: actors.driverUserId,
          reference: "LEDGER-E2E-HANDOVER-1",
          // The driver hands over 150.00 of the 320.00 they are holding.
          countedAmountMinor: 15_000,
          note: "Partial handover at the end of the shift."
        })
        .expect(201);

      assert.equal(settlement.body.expectedAmountMinor, 32_000);
      assert.equal(settlement.body.countedAmountMinor, 15_000);
      assert.equal(settlement.body.discrepancyMinor, -17_000, "a shortfall is recorded, not smoothed over");

      // Allocated oldest first: the 110.00 order clears fully, the 210.00 order takes the rest.
      const custody = await prisma.driverCashCustody.findMany({
        where: { driverUserId: actors.driverUserId },
        orderBy: { collectedAt: "asc" }
      });
      assert.equal(custody[0]!.settledAmountMinor, 11_000);
      assert.equal(custody[0]!.status, "SETTLED");
      assert.equal(custody[1]!.settledAmountMinor, 4_000);
      assert.equal(custody[1]!.status, "PARTIALLY_SETTLED", "never marked settled for money not received");

      const cash = await http
        .get("/api/v1/admin/accounting/cash/drivers")
        .set("Authorization", `Bearer ${actors.adminToken}`)
        .expect(200);
      const driverRow = cash.body.find((row: { driverUserId: string }) => row.driverUserId === actors.driverUserId);
      assert.equal(driverRow.outstandingMinor, 17_000, "320.00 collected less 150.00 handed over");
    });

    // =========================================================================================
    await context.test("the same handover cannot be posted twice", async () => {
      const duplicate = await http
        .post("/api/v1/admin/accounting/cash/settlements")
        .set("Authorization", `Bearer ${actors.adminToken}`)
        .send({
          driverUserId: actors.driverUserId,
          reference: "LEDGER-E2E-HANDOVER-1",
          countedAmountMinor: 15_000
        })
        .expect(409);
      assert.equal(duplicate.body.code, "CASH_SETTLEMENT_DUPLICATE");

      // And the balance is untouched by the refused attempt.
      const custody = await prisma.driverCashCustody.findMany({
        where: { driverUserId: actors.driverUserId },
        orderBy: { collectedAt: "asc" }
      });
      assert.equal(custody[0]!.settledAmountMinor, 11_000);
      assert.equal(custody[1]!.settledAmountMinor, 4_000);
    });

    // =========================================================================================
    await context.test("an order that is already fully settled cannot be settled again", async () => {
      const settled = await prisma.driverCashCustody.findFirst({
        where: { driverUserId: actors.driverUserId, status: "SETTLED" }
      });
      assert.ok(settled);

      const refused = await http
        .post("/api/v1/admin/accounting/cash/settlements")
        .set("Authorization", `Bearer ${actors.adminToken}`)
        .send({
          driverUserId: actors.driverUserId,
          reference: "LEDGER-E2E-HANDOVER-DOUBLE",
          countedAmountMinor: 11_000,
          custodyIds: [settled.id]
        })
        .expect(409);
      assert.equal(refused.body.code, "CASH_SETTLEMENT_ORDER_ALREADY_SETTLED");

      // The last line of defence is the database itself, not the check above.
      await assert.rejects(
        () =>
          prisma.driverCashCustody.update({
            where: { id: settled.id },
            data: { settledAmountMinor: settled.collectedAmountMinor + 1 }
          }),
        /DriverCashCustody_never_oversettled|violates check constraint/i
      );
    });

    // =========================================================================================
    await context.test("the rest of the cash clears the remaining balance exactly", async () => {
      const settlement = await http
        .post("/api/v1/admin/accounting/cash/settlements")
        .set("Authorization", `Bearer ${actors.adminToken}`)
        .send({
          driverUserId: actors.driverUserId,
          reference: "LEDGER-E2E-HANDOVER-2",
          countedAmountMinor: 17_000
        })
        .expect(201);
      assert.equal(settlement.body.expectedAmountMinor, 17_000);
      assert.equal(settlement.body.discrepancyMinor, 0);

      const custody = await prisma.driverCashCustody.findMany({ where: { driverUserId: actors.driverUserId } });
      assert.equal(custody.every((row) => row.status === "SETTLED"), true);
      assert.equal(
        custody.reduce((sum, row) => sum + row.settledAmountMinor, 0),
        32_000
      );
    });

    // =========================================================================================
    await context.test("a driver's pay is a separate event from handing the cash back", async () => {
      const payout = await http
        .post("/api/v1/admin/accounting/settlements")
        .set("Authorization", `Bearer ${actors.adminToken}`)
        .send({
          driverUserId: actors.driverUserId,
          amountMinor: 1_400,
          method: "CASH",
          reference: "LEDGER-E2E-DRIVER-PAY-1",
          note: "Two deliveries at 7.00 each."
        })
        .expect(201);
      assert.equal(payout.body.amountMinor, 1_400);

      const cash = await http
        .get("/api/v1/admin/accounting/cash/drivers")
        .set("Authorization", `Bearer ${actors.adminToken}`)
        .expect(200);
      const driverRow = cash.body.find((row: { driverUserId: string }) => row.driverUserId === actors.driverUserId);
      assert.equal(driverRow.earningsMinor, 1_400);
      assert.equal(driverRow.earningsPaidMinor, 1_400);
      assert.equal(driverRow.outstandingMinor, 0, "and the cash balance is its own, already-cleared number");

      // Paying more than was earned is a correction, not something a payout screen may do.
      const overpay = await http
        .post("/api/v1/admin/accounting/settlements")
        .set("Authorization", `Bearer ${actors.adminToken}`)
        .send({
          driverUserId: actors.driverUserId,
          amountMinor: 100,
          method: "CASH",
          reference: "LEDGER-E2E-DRIVER-PAY-OVER"
        })
        .expect(409);
      assert.equal(overpay.body.code, "PARTNER_SETTLEMENT_EXCEEDS_BALANCE");
    });

    // =========================================================================================
    let costEntryId = "";
    await context.test("a supermarket cost is reported by the partner and split only once approved", async () => {
      const proposed = await http
        .post("/api/v1/restaurant/me/operating-costs")
        .set("Authorization", `Bearer ${actors.supermarketToken}`)
        .send({
          category: "WAREHOUSE_RENT",
          description: "Warehouse rent, August",
          amountMinor: 250_000,
          incurredOn: "2026-08-01",
          isRecurring: true,
          periodLabel: "2026-08"
        })
        .expect(201);
      costEntryId = proposed.body.id as string;

      assert.equal(proposed.body.status, "PROPOSED");
      assert.equal(proposed.body.approverUserId, null);
      assert.deepEqual(proposed.body.shares, [], "nothing is charged to anyone before approval");
      const beforeApproval = await prisma.partnerEarning.count({ where: { operatingCostEntryId: costEntryId } });
      assert.equal(beforeApproval, 0);

      // The supermarket side has no route to approve its own request.
      await http
        .post(`/api/v1/admin/accounting/operating-costs/${costEntryId}/decision`)
        .set("Authorization", `Bearer ${actors.supermarketToken}`)
        .send({ approve: true })
        .expect(403);
    });

    await context.test("approving a cost charges it 40/30/30 and freezes the rates used", async () => {
      const approved = await http
        .post(`/api/v1/admin/accounting/operating-costs/${costEntryId}/decision`)
        .set("Authorization", `Bearer ${actors.adminToken}`)
        .send({ approve: true, note: "Checked against the signed lease." })
        .expect(201);

      assert.equal(approved.body.status, "APPROVED");
      assert.ok(approved.body.approverUserId, "an approved cost names who decided");
      assert.ok(approved.body.decidedAt);

      //   2,500.00 of rent: partner 1,000.00, Mohammad 750.00, Khaldoun 750.00
      const shares = new Map<string, number>(
        approved.body.shares.map((share: { payeeKey: string; amountMinor: number }) => [share.payeeKey, share.amountMinor])
      );
      assert.equal(shares.get(`BUSINESS:${actors.supermarketId}`), -100_000);
      assert.equal(shares.get(`PARTNER:${actors.ownerAId}`), -75_000);
      assert.equal(shares.get(`PARTNER:${actors.ownerBId}`), -75_000);
      assert.equal([...shares.values()].reduce((sum, value) => sum + value, 0), -250_000);

      const entry = await prisma.operatingCostEntry.findUniqueOrThrow({ where: { id: costEntryId } });
      assert.ok(entry.rateSetId, "the split's rates are frozen onto the entry");
    });

    await context.test("a decided cost cannot be decided again, and a month cannot be entered twice", async () => {
      const again = await http
        .post(`/api/v1/admin/accounting/operating-costs/${costEntryId}/decision`)
        .set("Authorization", `Bearer ${actors.adminToken}`)
        .send({ approve: false })
        .expect(409);
      assert.equal(again.body.code, "OPERATING_COST_ALREADY_DECIDED");

      const duplicateMonth = await http
        .post("/api/v1/restaurant/me/operating-costs")
        .set("Authorization", `Bearer ${actors.supermarketToken}`)
        .send({
          category: "WAREHOUSE_RENT",
          description: "Warehouse rent, August (again)",
          amountMinor: 250_000,
          incurredOn: "2026-08-01",
          isRecurring: true,
          periodLabel: "2026-08"
        })
        .expect(409);
      assert.equal(duplicateMonth.body.code, "OPERATING_COST_DUPLICATE_PERIOD");
    });

    await context.test("a rejected cost is recorded as rejected and charges nobody", async () => {
      const proposed = await http
        .post("/api/v1/restaurant/me/operating-costs")
        .set("Authorization", `Bearer ${actors.supermarketToken}`)
        .send({
          category: "OTHER",
          description: "A new delivery van",
          amountMinor: 8_000_000,
          incurredOn: "2026-08-05"
        })
        .expect(201);

      const rejected = await http
        .post(`/api/v1/admin/accounting/operating-costs/${proposed.body.id}/decision`)
        .set("Authorization", `Bearer ${actors.adminToken}`)
        .send({ approve: false, note: "Not this quarter." })
        .expect(201);
      assert.equal(rejected.body.status, "REJECTED");
      assert.equal(rejected.body.decisionNote, "Not this quarter.");
      assert.deepEqual(rejected.body.shares, []);
      assert.equal(await prisma.partnerEarning.count({ where: { operatingCostEntryId: proposed.body.id } }), 0);
    });

    // =========================================================================================
    await context.test("changing a rate never restates an order that was already taken", async () => {
      const before = await readRecord(http, actors.adminToken, restaurantOrderId);
      assert.equal(before.commissionBp, 2_000);
      assert.equal(before.commissionMinor, 2_000);

      // The commission drops to 10%, effective immediately.
      const newRates = await http
        .post("/api/v1/admin/accounting/rates")
        .set("Authorization", `Bearer ${actors.adminToken}`)
        .send({
          effectiveFrom: new Date().toISOString(),
          restaurantCommissionBp: 1_000,
          note: "Accounting E2E: commission halved."
        })
        .expect(201);
      assert.equal(newRates.body.restaurantCommissionBp, 1_000);
      assert.equal(newRates.body.isCurrent, true);
      // Everything not restated carries over rather than resetting.
      assert.equal(newRates.body.supermarketPartnerMarginBp, 4_000);
      assert.equal(newRates.body.driverDeliveryShareBp, 7_000);

      const after = await readRecord(http, actors.adminToken, restaurantOrderId);
      assert.equal(after.commissionBp, 2_000, "yesterday's order keeps yesterday's rate");
      assert.equal(after.commissionMinor, 2_000);
      assert.equal(after.rateSetVersion, before.rateSetVersion);

      // A new order taken after the change is valued at the new rate.
      const { orderId } = await placeAndDeliver(http, actors, {
        businessId: actors.restaurantId,
        token: actors.restaurantToken,
        items: [{ menuItemId: actors.mealId, quantity: 2 }]
      });
      const fresh = await readRecord(http, actors.adminToken, orderId);
      assert.equal(fresh.commissionBp, 1_000);
      assert.equal(fresh.commissionMinor, 1_000, "10% of 100.00");
      assert.equal(fresh.reconciliation.balancedMinor, 0);
      // The restaurant keeps more of the same order than it did before the change.
      const by = entryIndex(fresh);
      assert.equal(by(`BUSINESS:${actors.restaurantId}`, "BUSINESS_MERCHANDISE_NET"), 9_000);
    });

    // =========================================================================================
    await context.test("financial history refuses to be edited or deleted", async () => {
      const earning = await prisma.partnerEarning.findFirstOrThrow({
        where: { orderFinancialRecord: { orderId: restaurantOrderId } }
      });
      await assert.rejects(
        () => prisma.partnerEarning.update({ where: { id: earning.id }, data: { amountMinor: 1 } }),
        /append-only/i
      );
      await assert.rejects(
        () => prisma.partnerEarning.delete({ where: { id: earning.id } }),
        /append-only/i
      );

      const record = await prisma.orderFinancialRecord.findFirstOrThrow({ where: { orderId: restaurantOrderId } });
      await assert.rejects(
        () => prisma.orderFinancialRecord.update({ where: { id: record.id }, data: { commissionMinor: 0 } }),
        /append-only/i
      );

      // And a rate set, so a published version can never be quietly rewritten under old orders.
      await assert.rejects(
        () =>
          prisma.financialRateSet.update({
            where: { id: actors.rateSetV1Id },
            data: { restaurantCommissionBp: 1 }
          }),
        /append-only/i
      );

      // The amount is exactly what it was.
      const unchanged = await prisma.partnerEarning.findUniqueOrThrow({ where: { id: earning.id } });
      assert.equal(unchanged.amountMinor, earning.amountMinor);
    });

    await context.test("a correction is a new, attributed entry rather than an edit", async () => {
      const record = await prisma.orderFinancialRecord.findFirstOrThrow({ where: { orderId: restaurantOrderId } });
      const before = await prisma.partnerEarning.aggregate({
        where: { driverUserId: actors.driverUserId },
        _sum: { amountMinor: true }
      });

      await http
        .post("/api/v1/admin/accounting/adjustments")
        .set("Authorization", `Bearer ${actors.adminToken}`)
        .send({
          orderFinancialRecordId: record.id,
          reason: "Reviewed: the driver is charged for the failed handover.",
          entries: [
            { driverUserId: actors.driverUserId, amountMinor: -500 },
            { partnerKey: "OWNER_A", amountMinor: 250 },
            { partnerKey: "OWNER_B", amountMinor: 250 }
          ]
        })
        .expect(201);

      const after = await prisma.partnerEarning.aggregate({
        where: { driverUserId: actors.driverUserId },
        _sum: { amountMinor: true }
      });
      assert.equal((after._sum.amountMinor ?? 0) - (before._sum.amountMinor ?? 0), -500);

      // The original entitlement is untouched; the correction sits beside it with its own reason.
      const adjustments = await prisma.financialAdjustment.findMany({ where: { orderFinancialRecordId: record.id } });
      assert.equal(adjustments.length, 1);
      assert.match(adjustments[0]!.reason, /failed handover/);
      assert.equal(adjustments[0]!.createdByUserId, actors.adminUserId);
    });

    // =========================================================================================
    await context.test("subscriptions bill each restaurant once a month, and never a promotional partner", async () => {
      const first = await http
        .post("/api/v1/admin/accounting/subscriptions/generate")
        .set("Authorization", `Bearer ${actors.adminToken}`)
        .send({ periodYear: 2026, periodMonth: 8 })
        .expect(201);
      assert.ok(first.body.created >= 1);

      const charge = await prisma.subscriptionCharge.findFirst({
        where: { businessId: actors.restaurantId, periodYear: 2026, periodMonth: 8 }
      });
      assert.ok(charge, "the standard restaurant is billed");
      assert.equal(charge.amountMinor, 15_000, "150.00 ILS");

      const earnings = await prisma.partnerEarning.findMany({ where: { subscriptionChargeId: charge.id } });
      assert.equal(earnings.reduce((sum, row) => sum + row.amountMinor, 0), 0, "a transfer, not new cash");
      assert.equal(earnings.find((row) => row.businessId === actors.restaurantId)?.amountMinor, -15_000);

      // Re-running the month must not charge anybody twice.
      const rerun = await http
        .post("/api/v1/admin/accounting/subscriptions/generate")
        .set("Authorization", `Bearer ${actors.adminToken}`)
        .send({ periodYear: 2026, periodMonth: 8 })
        .expect(201);
      assert.equal(rerun.body.created, 0);
      assert.equal(
        await prisma.subscriptionCharge.count({ where: { businessId: actors.restaurantId, periodYear: 2026, periodMonth: 8 } }),
        1
      );

      // A promotional partner is skipped rather than billed zero.
      await prisma.restaurant.update({ where: { id: actors.restaurantId }, data: { isPromotionalPartner: true } });
      await http
        .post("/api/v1/admin/accounting/subscriptions/generate")
        .set("Authorization", `Bearer ${actors.adminToken}`)
        .send({ periodYear: 2026, periodMonth: 9 })
        .expect(201);
      assert.equal(
        await prisma.subscriptionCharge.count({ where: { businessId: actors.restaurantId, periodYear: 2026, periodMonth: 9 } }),
        0
      );
      await prisma.restaurant.update({ where: { id: actors.restaurantId }, data: { isPromotionalPartner: false } });
    });

    // =========================================================================================
    await context.test("the balances view answers who is owed what, and traces it to its parts", async () => {
      const balances = await http
        .get("/api/v1/admin/accounting/balances")
        .set("Authorization", `Bearer ${actors.adminToken}`)
        .expect(200);

      const ownerA = balances.body.find((row: { payeeKey: string }) => row.payeeKey === `PARTNER:${actors.ownerAId}`);
      assert.ok(ownerA, "a platform owner has a balance");
      assert.equal(ownerA.earnedMinor - ownerA.paidMinor, ownerA.outstandingMinor);
      assert.ok(ownerA.byComponent.length > 1, "and it is broken down by where it came from");
      assert.equal(
        ownerA.byComponent.reduce((sum: number, part: { amountMinor: number }) => sum + part.amountMinor, 0),
        ownerA.earnedMinor,
        "the parts add up to the total"
      );

      const driver = balances.body.find((row: { payeeKey: string }) => row.payeeKey === `DRIVER:${actors.driverUserId}`);
      assert.ok(driver);
      assert.equal(driver.paidMinor, 1_400);
    });

    await context.test("reading the books and moving money are different authorities", async () => {
      // The supermarket owner is not an administrator at all.
      await http
        .get("/api/v1/admin/accounting/balances")
        .set("Authorization", `Bearer ${actors.supermarketToken}`)
        .expect(403);
      // And an unauthenticated caller sees nothing.
      await http.get("/api/v1/admin/accounting/overview").expect(401);
    });
  }
);

// ============================================================================== test scaffolding

type Actors = {
  adminToken: string;
  adminUserId: string;
  customerToken: string;
  restaurantToken: string;
  restaurantId: string;
  mealId: string;
  supermarketToken: string;
  supermarketId: string;
  groceryId: string;
  driverToken: string;
  driverUserId: string;
  ownerAId: string;
  ownerBId: string;
  deliveryOpsId: string;
  rateSetV1Id: string;
};

async function createActors(http: Http, prisma: PrismaService): Promise<Actors> {
  const passwordHash = await hashPassword(password);
  const superAdminRole = await prisma.role.findUnique({ where: { key: "SUPER_ADMIN" } });
  assert.ok(superAdminRole, "System roles must be migrated before running the accounting E2E suite.");
  const admin = await prisma.user.create({
    data: {
      platformRoleId: superAdminRole.id,
      fullName: "Ledger E2E Admin",
      phone: phones.admin,
      passwordHash,
      role: UserRole.ADMIN,
      phoneVerifiedAt: new Date(),
      isActive: true
    }
  });
  await prisma.user.create({
    data: {
      fullName: "Ledger E2E Customer",
      phone: phones.customer,
      passwordHash,
      role: UserRole.CUSTOMER,
      phoneVerifiedAt: new Date(),
      isActive: true
    }
  });

  const adminToken = await login(http, local.admin);
  const customerToken = await login(http, local.customer);

  const restaurant = await registerBusiness(http, adminToken, {
    ownerFullName: "Ledger E2E Restaurant Owner",
    phoneNumber: local.restaurant,
    restaurantName: "Ledger E2E Kitchen",
    businessType: "RESTAURANT"
  });
  // 50.00 a plate, so two of them are exactly the 100.00 in the worked example.
  const mealId = await createProduct(http, restaurant.token, restaurant.categoryId, {
    name: "Ledger Mixed Grill",
    priceMinor: 5_000
  });

  const supermarket = await registerBusiness(http, adminToken, {
    ownerFullName: "Ledger E2E Supermarket Owner",
    phoneNumber: local.supermarket,
    restaurantName: "Ledger E2E JOVO MARKET",
    businessType: "SUPERMARKET"
  });
  // Bought at 70.00, sold at 100.00, so two of them give the 200.00 retail / 140.00 cost example.
  const groceryId = await createProduct(http, supermarket.token, supermarket.categoryId, {
    name: "Ledger Olive Oil 2L",
    priceMinor: 10_000,
    costPriceMinor: 7_000
  });

  const driverRegistration = await http
    .post("/api/v1/drivers/register")
    .send({
      fullName: "Ledger E2E Driver",
      countryCode: "+970",
      phoneNumber: local.driver,
      password,
      confirmPassword: password
    })
    .expect(201);
  const driverUserId = driverRegistration.body.userId as string;
  await http
    .post(`/api/v1/admin/drivers/${driverUserId}/approve`)
    .set("Authorization", `Bearer ${adminToken}`)
    .expect(201);
  const driverToken = await login(http, local.driver);
  await http
    .patch("/api/v1/driver/me/status")
    .set("Authorization", `Bearer ${driverToken}`)
    .send({ isOnline: true })
    .expect(200);

  const partners = await prisma.partnerAccount.findMany();
  const partnerId = (key: string) => {
    const account = partners.find((candidate) => candidate.key === key);
    assert.ok(account, `partner account ${key} must be seeded before the accounting layer can be used`);
    return account.id;
  };
  const rateSetV1 = await prisma.financialRateSet.findFirstOrThrow({ where: { version: 1 } });

  return {
    adminToken,
    adminUserId: admin.id,
    customerToken,
    restaurantToken: restaurant.token,
    restaurantId: restaurant.id,
    mealId,
    supermarketToken: supermarket.token,
    supermarketId: supermarket.id,
    groceryId,
    driverToken,
    driverUserId,
    ownerAId: partnerId("OWNER_A"),
    ownerBId: partnerId("OWNER_B"),
    deliveryOpsId: partnerId("DELIVERY_OPS"),
    rateSetV1Id: rateSetV1.id
  };
}

async function registerBusiness(
  http: Http,
  adminToken: string,
  input: { ownerFullName: string; phoneNumber: string; restaurantName: string; businessType: string }
): Promise<{ id: string; token: string; categoryId: string }> {
  const registration = await http
    .post("/api/v1/restaurants/register")
    .send({
      ownerFullName: input.ownerFullName,
      countryCode: "+970",
      phoneNumber: input.phoneNumber,
      password,
      confirmPassword: password,
      restaurantName: input.restaurantName,
      businessType: input.businessType,
      addressLine: "Ledger Integration Street, Ramallah",
      description: "Created by the accounting end-to-end test."
    })
    .expect(201);
  const id = registration.body.restaurantId as string;
  const token = await login(http, input.phoneNumber);

  await http
    .patch("/api/v1/restaurant/me")
    .set("Authorization", `Bearer ${token}`)
    .send({ addressLine: "Ledger Integration Street", ...businessLocation })
    .expect(200);
  await http.post(`/api/v1/admin/restaurants/${id}/approve`).set("Authorization", `Bearer ${adminToken}`).expect(201);
  await http
    .patch("/api/v1/restaurant/me/open-status")
    .set("Authorization", `Bearer ${token}`)
    .send({ isOpen: true })
    .expect(200);

  const category = await http
    .post("/api/v1/restaurant/me/menu/categories")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: "Ledger Section", sortOrder: 1 })
    .expect(201);

  return { id, token, categoryId: category.body.id as string };
}

async function createProduct(
  http: Http,
  token: string,
  categoryId: string,
  input: { name: string; priceMinor: number; costPriceMinor?: number }
): Promise<string> {
  const response = await http
    .post("/api/v1/restaurant/me/menu/items")
    .set("Authorization", `Bearer ${token}`)
    .send({ categoryId, ...input })
    .expect(201);
  return response.body.id as string;
}

/** Place an order and walk it through to DELIVERED exactly as the real screens do. */
async function placeAndDeliver(
  http: Http,
  actors: Actors,
  input: { businessId: string; token: string; items: { menuItemId: string; quantity: number }[] }
): Promise<{ orderId: string }> {
  const order = await http
    .post("/api/v1/orders")
    .set("Authorization", `Bearer ${actors.customerToken}`)
    .send({
      restaurantId: input.businessId,
      items: input.items,
      deliveryLabel: "Home",
      deliveryAddressLine: "Ledger Customer Address",
      ...customerLocation,
      paymentMethod: "CASH"
    })
    .expect(201);
  const orderId = order.body.id as string;
  assert.equal(order.body.deliveryFeeMinor, minimumDeliveryFeeMinor, "this suite relies on the minimum fee");

  for (const status of ["ACCEPTED", "PREPARING", "READY_FOR_PICKUP"] as const) {
    await http
      .patch(`/api/v1/restaurant/me/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${input.token}`)
      .send({ status })
      .expect(200);
  }

  const available = await http
    .get("/api/v1/driver/me/deliveries/available")
    .set("Authorization", `Bearer ${actors.driverToken}`)
    .expect(200);
  const delivery = available.body.find((candidate: { order: { id: string } }) => candidate.order.id === orderId);
  assert.ok(delivery, "the ready order should be offered to the online driver");
  await http
    .post(`/api/v1/driver/me/deliveries/${delivery.id}/accept`)
    .set("Authorization", `Bearer ${actors.driverToken}`)
    .expect(201);
  for (const status of ["PICKED_UP", "ON_THE_WAY", "DELIVERED"] as const) {
    await http
      .patch(`/api/v1/driver/me/deliveries/${delivery.id}/status`)
      .set("Authorization", `Bearer ${actors.driverToken}`)
      .send({ status })
      .expect(200);
  }
  return { orderId };
}

type RecordView = {
  vertical: string;
  outcome: string;
  rateSetVersion: number;
  commissionBp: number | null;
  commissionMinor: number;
  itemSubtotalMinor: number;
  deliveryFeeMinor: number;
  cashCollectedMinor: number;
  goodsCostMinor: number;
  costDataComplete: boolean;
  marginMinor: number;
  driverShareMinor: number;
  deliveryRemainderMinor: number;
  entries: { payeeKey: string; component: string; amountMinor: number }[];
  reconciliation: { distributedMinor: number; cashCollectedMinor: number; balancedMinor: number };
};

async function readRecord(http: Http, adminToken: string, orderId: string): Promise<RecordView> {
  const response = await http
    .get(`/api/v1/admin/accounting/orders/${orderId}`)
    .set("Authorization", `Bearer ${adminToken}`)
    .expect(200);
  return response.body as RecordView;
}

/** One entitlement, by party and reason. Returns 0 when the party has none of that component. */
function entryIndex(record: RecordView): (payeeKey: string, component: string) => number {
  return (payeeKey, component) =>
    record.entries.find((entry) => entry.payeeKey === payeeKey && entry.component === component)?.amountMinor ?? 0;
}

function payeeTotal(record: RecordView, payeeKey: string): number {
  return record.entries
    .filter((entry) => entry.payeeKey === payeeKey)
    .reduce((sum, entry) => sum + entry.amountMinor, 0);
}

function configureTestApp(app: INestApplication): void {
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
}

async function login(http: Http, phoneNumber: string): Promise<string> {
  const response = await http
    .post("/api/v1/auth/login")
    .send({ countryCode: "+970", phoneNumber, password })
    .expect(201);
  return response.body.accessToken as string;
}

/**
 * Remove everything this suite created, in dependency order.
 *
 * Financial rows are RESTRICT-referenced and the ledger refuses ordinary deletes, so the triggers
 * are dropped for the duration of the cleanup and immediately restored. That is deliberately an
 * explicit, visible act — which is exactly the property the triggers exist to give.
 */
async function cleanup(prisma: PrismaService): Promise<void> {
  const users = await prisma.user.findMany({
    where: { phone: { in: Object.values(phones) } },
    select: { id: true, restaurant: { select: { id: true } } }
  });
  const businessIds = users.flatMap((user) => (user.restaurant ? [user.restaurant.id] : []));
  const userIds = users.map((user) => user.id);
  if (userIds.length === 0 && businessIds.length === 0) {
    await deleteSuiteRateSets(prisma);
    return;
  }
  // Orders are keyed by restaurantId, while the accounting tables are keyed by businessId — the
  // same identifier under two names, so the two filters are written out separately rather than
  // shared.
  const orderWhere = businessIds.length > 0 ? { restaurantId: { in: businessIds } } : { id: "" };
  const businessWhere = businessIds.length > 0 ? { businessId: { in: businessIds } } : { id: "" };

  await withFinancialTriggersDisabled(prisma, async () => {
    const recordIds = (
      await prisma.orderFinancialRecord.findMany({ where: businessWhere, select: { id: true } })
    ).map((record) => record.id);
    const adjustmentIds = (
      await prisma.financialAdjustment.findMany({
        where: { orderFinancialRecordId: { in: recordIds } },
        select: { id: true }
      })
    ).map((adjustment) => adjustment.id);
    const costIds = (
      await prisma.operatingCostEntry.findMany({
        where: { OR: [businessWhere, { proposedByUserId: { in: userIds } }, { approverUserId: { in: userIds } }] },
        select: { id: true }
      })
    ).map((entry) => entry.id);
    // Generating a month's subscriptions bills every approved restaurant, not only this suite's,
    // so the charges are found by who raised them rather than by which business they landed on.
    const subscriptionIds = (
      await prisma.subscriptionCharge.findMany({
        where: { OR: [businessWhere, { createdByUserId: { in: userIds } }] },
        select: { id: true }
      })
    ).map((charge) => charge.id);

    await prisma.cashSettlementAllocation.deleteMany({ where: { custody: { driverUserId: { in: userIds } } } });
    await prisma.driverCashCustody.deleteMany({ where: { driverUserId: { in: userIds } } });
    await prisma.cashSettlement.deleteMany({
      where: { OR: [{ driverUserId: { in: userIds } }, { receivedByUserId: { in: userIds } }] }
    });
    await prisma.partnerSettlementAllocation.deleteMany({
      where: {
        earning: {
          OR: [
            { driverUserId: { in: userIds } },
            { orderFinancialRecordId: { in: recordIds } },
            { operatingCostEntryId: { in: costIds } },
            { subscriptionChargeId: { in: subscriptionIds } },
            { adjustmentId: { in: adjustmentIds } }
          ]
        }
      }
    });
    await prisma.partnerSettlement.deleteMany({
      where: {
        OR: [
          { driverUserId: { in: userIds } },
          { paidByUserId: { in: userIds } },
          ...(businessIds.length ? [{ businessId: { in: businessIds } }] : [])
        ]
      }
    });
    await prisma.partnerEarning.deleteMany({
      where: {
        OR: [
          { orderFinancialRecordId: { in: recordIds } },
          { adjustmentId: { in: adjustmentIds } },
          { operatingCostEntryId: { in: costIds } },
          { subscriptionChargeId: { in: subscriptionIds } },
          { driverUserId: { in: userIds } }
        ]
      }
    });
    await prisma.financialAdjustment.deleteMany({ where: { id: { in: adjustmentIds } } });
    await prisma.orderFinancialRecord.deleteMany({ where: { id: { in: recordIds } } });
    await prisma.operatingCostEntry.deleteMany({ where: { id: { in: costIds } } });
    await prisma.subscriptionCharge.deleteMany({ where: { id: { in: subscriptionIds } } });
  });

  await prisma.delivery.deleteMany({ where: { OR: [{ driverId: { in: userIds } }, { order: orderWhere }] } });
  await prisma.orderStatusHistory.deleteMany({ where: { changedByUserId: { in: userIds } } });
  await prisma.inventoryMovement.deleteMany({ where: { restaurantId: { in: businessIds } } });
  await prisma.order.deleteMany({
    where: { OR: [{ customerId: { in: userIds } }, ...(businessIds.length ? [{ restaurantId: { in: businessIds } }] : [])] }
  });
  await prisma.offer.deleteMany({ where: { restaurantId: { in: businessIds } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  // Rate sets go before their author does: the author reference is RESTRICT, exactly so that
  // removing a person can never quietly detach them from a rate they published.
  await detachSuiteRateSets(prisma);
  await deleteSuiteRateSets(prisma);
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

/** Rate sets this suite published, so a rerun starts from the migration's version 1 again. */
async function deleteSuiteRateSets(prisma: PrismaService): Promise<void> {
  await withFinancialTriggersDisabled(prisma, async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM "FinancialRateSet" WHERE "note" LIKE 'Accounting E2E%'`);
  });
}

/** Orders stamped with a rate set this suite is about to remove would block its deletion. */
async function detachSuiteRateSets(prisma: PrismaService): Promise<void> {
  const suiteSets = await prisma.financialRateSet.findMany({
    where: { note: { startsWith: "Accounting E2E" } },
    select: { id: true }
  });
  if (suiteSets.length === 0) return;
  await prisma.order.updateMany({
    where: { financialRateSetId: { in: suiteSets.map((set) => set.id) } },
    data: { financialRateSetId: null }
  });
}

function assertSafeE2eDatabase(databaseUrl: string): void {
  const parsed = new URL(databaseUrl);
  const databaseName = parsed.pathname.replace(/^\//, "").toLowerCase();
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHosts.has(parsed.hostname) && !databaseName.includes("test")) {
    throw new Error("The accounting E2E requires a local database or a database whose name contains 'test'.");
  }
}

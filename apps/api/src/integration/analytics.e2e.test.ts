import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import assert from "node:assert/strict";
import { test } from "node:test";
import { AnalyticsService } from "../analytics/analytics.service";
import { AppModule } from "../app.module";
import { hashPassword } from "../auth/crypto.util";
import { BusinessType, FulfillmentAdjustmentStatus, OrderStatus, RestaurantStatus, UserRole } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/**
 * The three analytics reports against real PostgreSQL, so the raw SQL (effective packed lines,
 * UTC bucketing, the period bounds) is exercised exactly as production runs it. Every expected
 * figure below is worked out by hand from the seeded orders.
 *
 * Products: Labneh (item), Tomatoes (kg), Bread (item), Olive oil (item, only ever a substitute).
 *
 *   O1 C1 DELIVERED  Sun 27 Sep 23:30 Hebron (20:30Z)  Labneh 2 x 9.99 = 19.98, Bread 1 x 4.25
 *   O2 C1 DELIVERED  Mon 28 Sep 00:30 Hebron (21:30Z on the 27th!)
 *                    Tomatoes ordered 1 kg, re-weighed and APPROVED at 1.250 kg = 10.00; Bread 3 x 4.25 = 12.75
 *   O3 C2 DELIVERED  Sun 11 Jan 00:15 Hebron, winter (22:15Z on the 10th)
 *                    Labneh 1 x 12.50; Bread substituted (APPROVED) by Olive oil 1 x 25.00
 *   O6 C2 DELIVERED  Mon 28 Sep 12:00 Hebron: Tomatoes 2 kg x 8.00 = 16.00, adjustment only PENDING
 *   O7 C3 DELIVERED  Tue 5 May 12:00 Hebron: Bread 1 x 4.25
 *   O4 C3 CANCELLED and O5 C3 DELIVERY_FAILED: excluded everywhere.
 *
 *   Bread     qty 1+3+1 = 5.000   revenue 425+1275+425 = 2125   orders 3
 *   Tomatoes  qty 1.250+2.000 = 3.250   revenue 1000+1600 = 2600   orders 2
 *   Labneh    qty 2+1 = 3.000     revenue 1998+1250 = 3248      orders 2
 *   Olive oil qty 1.000           revenue 2500                  orders 1
 *   Total revenue 2125+2600+3248+2500 = 10473 over 5 delivered orders.
 */
const runDatabaseE2e = process.env.RUN_DATABASE_E2E === "true";
const phones = ["+970594900171", "+970594900172", "+970594900173", "+970594900174"];

test(
  "analytics: best sellers, peak local times and returning customers, from DELIVERED orders only",
  { skip: !runDatabaseE2e, timeout: 60_000 },
  async (context) => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    const prisma = app.get(PrismaService);
    const analytics = app.get(AnalyticsService);

    const databaseUrl = app.get(ConfigService).getOrThrow<string>("DATABASE_URL");
    if (!new URL(databaseUrl).pathname.toLowerCase().includes("test")) {
      await app.close();
      throw new Error("This E2E requires a database whose name contains 'test'.");
    }

    const cleanup = async () => {
      const users = await prisma.user.findMany({ where: { phone: { in: phones } }, select: { id: true } });
      const ids = users.map((user) => user.id);
      if (ids.length === 0) return;
      await prisma.order.deleteMany({ where: { customerId: { in: ids } } });
      const store = await prisma.restaurant.findFirst({ where: { ownerUserId: { in: ids } }, select: { id: true } });
      if (store) {
        await prisma.menuItem.deleteMany({ where: { restaurantId: store.id } });
        await prisma.menuCategory.deleteMany({ where: { restaurantId: store.id } });
        await prisma.restaurant.delete({ where: { id: store.id } });
      }
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    };
    context.after(async () => {
      try {
        await cleanup();
      } finally {
        await app.close();
      }
    });
    await cleanup();

    const passwordHash = await hashPassword("Analytics@12345");
    const user = (phone: string, role: UserRole, fullName: string) =>
      prisma.user.create({ data: { fullName, phone, passwordHash, role, phoneVerifiedAt: new Date(), isActive: true } });
    const owner = await user(phones[0], UserRole.RESTAURANT, "Analytics Owner");
    const [c1, c2, c3] = await Promise.all([
      user(phones[1], UserRole.CUSTOMER, "C1"),
      user(phones[2], UserRole.CUSTOMER, "C2"),
      user(phones[3], UserRole.CUSTOMER, "C3")
    ]);
    const store = await prisma.restaurant.create({
      data: {
        ownerUserId: owner.id,
        name: "Analytics Market",
        businessType: BusinessType.SUPERMARKET,
        status: RestaurantStatus.APPROVED,
        isOpen: true,
        phone: phones[0],
        addressLine: "Hebron",
        latitude: 31.53,
        longitude: 35.09
      }
    });
    const category = await prisma.menuCategory.create({ data: { restaurantId: store.id, name: "All", sortOrder: 0, isActive: true } });
    const product = (name: string, priceMinor: number, unitLabel = "item") =>
      prisma.menuItem.create({
        data: { restaurantId: store.id, categoryId: category.id, name, priceMinor, costPriceMinor: 100, unitLabel, isAvailable: true }
      });
    const labneh = await product("Labneh", 1250);
    const tomatoes = await product("Tomatoes", 800, "kg");
    const bread = await product("Bread", 425);
    const oliveOil = await product("Olive oil", 2500);

    type Line = {
      menuItem: { id: string; name: string };
      quantity: number;
      priceMinor: number;
      adjustment?: { status: FulfillmentAdjustmentStatus; milli: number; unitPriceMinor: number; lineTotalMinor: number; replacementId?: string };
    };
    async function order(customerId: string, status: OrderStatus, createdAt: string, lines: Line[]) {
      const subtotal = lines.reduce((sum, line) => sum + (line.adjustment?.status === "APPROVED" ? line.adjustment.lineTotalMinor : line.priceMinor * line.quantity), 0);
      const created = await prisma.order.create({
        data: {
          customerId,
          restaurantId: store.id,
          status,
          paymentMethod: "CASH",
          deliveryLabel: "Home",
          deliveryAddressLine: "Street",
          subtotalMinor: subtotal,
          deliveryFeeMinor: 1000,
          totalMinor: subtotal + 1000,
          createdAt: new Date(createdAt)
        }
      });
      for (const line of lines) {
        const item = await prisma.orderItem.create({
          data: {
            orderId: created.id,
            menuItemId: line.menuItem.id,
            nameSnapshot: line.menuItem.name,
            priceMinorSnapshot: line.priceMinor,
            quantity: line.quantity
          }
        });
        if (line.adjustment) {
          await prisma.fulfillmentAdjustment.create({
            data: {
              orderItemId: item.id,
              proposedByUserId: owner.id,
              replacementMenuItemId: line.adjustment.replacementId ?? null,
              actualQuantityMilli: line.adjustment.milli,
              unitPriceMinor: line.adjustment.unitPriceMinor,
              lineTotalMinor: line.adjustment.lineTotalMinor,
              status: line.adjustment.status
            }
          });
        }
      }
    }

    await order(c1.id, OrderStatus.DELIVERED, "2026-09-27T20:30:00Z", [
      { menuItem: labneh, quantity: 2, priceMinor: 999 },
      { menuItem: bread, quantity: 1, priceMinor: 425 }
    ]);
    await order(c1.id, OrderStatus.DELIVERED, "2026-09-27T21:30:00Z", [
      { menuItem: tomatoes, quantity: 1, priceMinor: 800, adjustment: { status: "APPROVED", milli: 1250, unitPriceMinor: 800, lineTotalMinor: 1000 } },
      { menuItem: bread, quantity: 3, priceMinor: 425 }
    ]);
    await order(c2.id, OrderStatus.DELIVERED, "2026-01-10T22:15:00Z", [
      { menuItem: labneh, quantity: 1, priceMinor: 1250 },
      { menuItem: bread, quantity: 1, priceMinor: 425, adjustment: { status: "APPROVED", milli: 1000, unitPriceMinor: 2500, lineTotalMinor: 2500, replacementId: oliveOil.id } }
    ]);
    await order(c3.id, OrderStatus.CANCELLED, "2026-09-27T21:10:00Z", [{ menuItem: labneh, quantity: 10, priceMinor: 999 }]);
    await order(c3.id, OrderStatus.DELIVERY_FAILED, "2026-09-28T10:00:00Z", [{ menuItem: bread, quantity: 5, priceMinor: 425 }]);
    await order(c2.id, OrderStatus.DELIVERED, "2026-09-28T09:00:00Z", [
      { menuItem: tomatoes, quantity: 2, priceMinor: 800, adjustment: { status: "PENDING", milli: 900, unitPriceMinor: 800, lineTotalMinor: 720 } }
    ]);
    await order(c3.id, OrderStatus.DELIVERED, "2026-05-05T09:00:00Z", [{ menuItem: bread, quantity: 1, priceMinor: 425 }]);

    const scope = { restaurantId: store.id };

    // Best sellers, all time, by quantity.
    const byQuantity = await analytics.topProducts(scope);
    assert.deepEqual(
      byQuantity.items.map((row) => [row.rank, row.name, row.quantityMilli, row.revenueMinor, row.orders]),
      [
        [1, "Bread", 5000, 2125, 3],
        [2, "Tomatoes", 3250, 2600, 2],
        [3, "Labneh", 3000, 3248, 2],
        [4, "Olive oil", 1000, 2500, 1]
      ]
    );
    assert.deepEqual(byQuantity.totals, { deliveredOrders: 5, productsSold: 4, revenueMinor: 10473 });
    assert.equal(byQuantity.items.find((row) => row.name === "Tomatoes")!.unitLabel, "kg");

    const byRevenue = await analytics.topProducts({ ...scope, sortBy: "revenue", limit: 2 });
    assert.deepEqual(byRevenue.items.map((row) => [row.name, row.revenueMinor]), [["Labneh", 3248], ["Tomatoes", 2600]]);
    assert.equal(byRevenue.totals.revenueMinor, 10473, "totals cover every product, not only the rows returned");

    // One local day, Monday 28 September: O2 (00:30, still the 27th in UTC) and O6 — not O1 at 23:30 on the 27th.
    const monday = await analytics.topProducts({ ...scope, fromDate: "2026-09-28", toDate: "2026-09-28" });
    assert.deepEqual(monday.items.map((row) => [row.name, row.quantityMilli, row.revenueMinor]), [
      ["Tomatoes", 3250, 2600],
      ["Bread", 3000, 1275]
    ]);
    assert.equal(monday.totals.deliveredOrders, 2);
    const sunday = await analytics.topProducts({ ...scope, fromDate: "2026-09-27", toDate: "2026-09-27" });
    assert.deepEqual(sunday.items.map((row) => row.name).sort(), ["Bread", "Labneh"]);

    // Peak times in Hebron local time.
    const peak = await analytics.peakTimes(scope);
    assert.equal(peak.totalOrders, 5);
    assert.equal(peak.byHour[23].orders, 1); // O1
    assert.equal(peak.byHour[0].orders, 2); // O2 (summer) and O3 (winter), both just after local midnight
    assert.equal(peak.byHour[12].orders, 2); // O6 and O7
    assert.equal(peak.byHour[20].orders + peak.byHour[21].orders + peak.byHour[22].orders, 0, "never UTC hours");
    assert.deepEqual(peak.byWeekday.map((row) => row.orders), [2, 2, 1, 0, 0, 0, 0]); // Sun O1,O3 · Mon O2,O6 · Tue O7
    assert.equal(peak.byWeekdayHour[1][0], 1);
    assert.equal(peak.byWeekdayHour[0][0], 1);

    // Returning customers: C1 and C2 have two delivered orders each, C3 one (its others did not deliver).
    const retention = await analytics.customerRetention(scope);
    assert.deepEqual(
      { ...retention, period: undefined },
      {
        period: undefined,
        customers: 3,
        oneTimeCustomers: 1,
        returningCustomers: 2,
        returningRateBp: 6667,
        deliveredOrders: 5,
        ordersFromReturningCustomers: 4
      }
    );
    const mondayRetention = await analytics.customerRetention({ ...scope, fromDate: "2026-09-28", toDate: "2026-09-28" });
    assert.equal(mondayRetention.customers, 2);
    assert.equal(mondayRetention.returningCustomers, 0);
    assert.equal(mondayRetention.returningRateBp, 0);

    // The session time zone must not move any bound: re-run a period query under a different one.
    await prisma.$executeRawUnsafe(`SET TIME ZONE 'America/Los_Angeles'`);
    const mondayAgain = await analytics.topProducts({ ...scope, fromDate: "2026-09-28", toDate: "2026-09-28" });
    assert.equal(mondayAgain.totals.deliveredOrders, 2);
    const peakAgain = await analytics.peakTimes(scope);
    assert.deepEqual(peakAgain.byHour, peak.byHour);
    await prisma.$executeRawUnsafe(`RESET TIME ZONE`);
  }
);

import "reflect-metadata";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { io as connectSocket, type Socket } from "socket.io-client";
import request from "supertest";
import { AppModule } from "../app.module";
import { hashPassword } from "../auth/crypto.util";
import { UserRole } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { PushSenderService } from "../realtime/push-sender.service";
import { withFinancialTriggersDisabled } from "./financial-triggers.util";

/**
 * Driver alerts, live tracking and the driver's cash screen, end to end against real PostgreSQL.
 *
 * What a unit test cannot show, and this does: the alert is written to the push outbox in the same
 * transaction as the delivery; the admin socket really receives a driver's position; the ledger
 * rows the accounting layer writes are exactly what the driver's screen reads; and the new routes
 * refuse everyone they should.
 */

const runDatabaseE2e = process.env.RUN_DATABASE_E2E === "true";
if (runDatabaseE2e && process.env.NODE_ENV === "production") {
  throw new Error("This E2E refuses to run with NODE_ENV=production.");
}
if (runDatabaseE2e && process.env.RESTAURANT_ORDERING_ENABLED === undefined) {
  process.env.RESTAURANT_ORDERING_ENABLED = "true";
}

const password = "Tracking@12345";
const phones = {
  admin: "+970594200001",
  customer: "+970594200002",
  market: "+970594200003",
  driverA: "+970594200004",
  driverB: "+970594200005",
  driverOffline: "+970594200006"
};
const local = {
  admin: "0594200001",
  customer: "0594200002",
  market: "0594200003",
  driverA: "0594200004",
  driverB: "0594200005",
  driverOffline: "0594200006"
};
const marketLocation = { latitude: 31.9038, longitude: 35.2034 };
const customerLocation = { deliveryLatitude: 31.9038, deliveryLongitude: 35.2184 };

type Http = ReturnType<typeof request>;

test(
  "on-shift drivers are alerted, admins see them live, and the driver's cash screen matches the ledger",
  { skip: !runDatabaseE2e, timeout: 240_000 },
  async (context) => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    // A real listening server, so the socket layer is exercised over a real connection.
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const prisma = app.get(PrismaService);
    const http = request(app.getHttpServer());
    const sockets: Socket[] = [];
    const realFetch = globalThis.fetch;

    const databaseName = new URL(app.get(ConfigService).getOrThrow<string>("DATABASE_URL")).pathname.toLowerCase();
    if (!databaseName.includes("test")) {
      await app.close();
      throw new Error("This E2E requires a database whose name contains 'test'.");
    }

    context.after(async () => {
      globalThis.fetch = realFetch;
      for (const socket of sockets) socket.disconnect();
      try {
        await cleanup(prisma);
      } finally {
        await app.close();
      }
    });

    await cleanup(prisma);
    const actors = await createActors(http, prisma);

    const adminSocket = await openSocket(baseUrl, actors.adminToken, sockets);
    const driverASocket = await openSocket(baseUrl, actors.driverAToken, sockets);
    const customerSocket = await openSocket(baseUrl, actors.customerToken, sockets);
    const adminEvents: { event: string; payload: any }[] = [];
    const driverAEvents: { event: string; payload: any }[] = [];
    const customerEvents: { event: string; payload: any }[] = [];
    for (const event of ["driver.location.updated", "driver.status.changed", "driver.presence.changed", "delivery.status.changed"]) {
      adminSocket.on(event, (payload) => adminEvents.push({ event, payload }));
    }
    driverASocket.on("delivery.available", (payload) => driverAEvents.push({ event: "delivery.available", payload }));
    customerSocket.onAny((event, payload) => customerEvents.push({ event, payload }));

    // ------------------------------------------------------------------ the alert
    const order = await placeOrder(http, actors);
    await advanceToReady(http, actors, order.id);

    await context.test("driver A and B (on shift) are alerted; the offline driver is not", async () => {
      const alertFor = (userId: string) =>
        prisma.notification.findMany({ where: { userId, type: "DELIVERY_AVAILABLE" } });
      const [a, b, off] = await Promise.all([
        alertFor(actors.driverAId),
        alertFor(actors.driverBId),
        alertFor(actors.driverOfflineId)
      ]);
      assert.equal(a.length, 1);
      assert.equal(b.length, 1);
      assert.equal(off.length, 0);

      const delivery = await prisma.delivery.findUniqueOrThrow({ where: { orderId: order.id } });
      assert.equal(a[0].relatedEntityId, delivery.id);
      assert.ok(!a[0].body.includes("Secret Lane"), "no customer address on a lock screen");

      const outbox = await prisma.pushDelivery.findMany({ where: { notificationId: a[0].id } });
      assert.equal(outbox.length, 1, "one queued push for driver A's one registered device");
      assert.equal(outbox[0].status, "PENDING");
    });

    await context.test("an open driver app is told over the socket, and the customer is told nothing about drivers", async () => {
      await eventually(() => driverAEvents.some((entry) => entry.event === "delivery.available"));
      assert.ok(!customerEvents.some((entry) => entry.event === "delivery.available" || entry.event.includes("location")));
    });

    await context.test("the push worker sends the JOVO channel and sound, expiring stale alerts", async () => {
      const sent: any[] = [];
      globalThis.fetch = (async (url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "[]"));
        if (String(url).includes("getReceipts")) return new Response(JSON.stringify({ data: {} }), { status: 200 });
        sent.push(...body);
        return new Response(JSON.stringify({ data: body.map((_: unknown, index: number) => ({ status: "ok", id: `t-${index}` })) }), {
          status: 200
        });
      }) as typeof fetch;
      await app.get(PushSenderService).processOnce();
      globalThis.fetch = realFetch;

      const toA = sent.find((message) => message.to === actors.driverAToken_push);
      const toB = sent.find((message) => message.to === actors.driverBToken_push);
      assert.ok(toA && toB, "both on-shift drivers' devices receive the alert");
      assert.equal(toA.channelId, "delivery-alerts");
      assert.equal(toA.sound, "default", "Android: the sound comes from the channel");
      assert.equal(toA.ttl, 120);
      assert.equal(toA.priority, "high");
      assert.equal(toA.data.type, "DELIVERY_AVAILABLE");
      assert.equal(toB.sound, "jovo_delivery.wav", "iOS: the bundled JOVO sound file");
      assert.equal(toB.channelId, "delivery-alerts");
    });

    // ------------------------------------------------------------------ the driver accepts
    const delivery = await prisma.delivery.findUniqueOrThrow({ where: { orderId: order.id } });
    await http
      .post(`/api/v1/driver/me/deliveries/${delivery.id}/accept`)
      .set("Authorization", `Bearer ${actors.driverAToken}`)
      .expect(201);

    await context.test("the driver profile reports the persisted shift, so a reopened app shows the truth", async () => {
      const profile = await http.get("/api/v1/driver/me").set("Authorization", `Bearer ${actors.driverAToken}`).expect(200);
      assert.equal(profile.body.isOnline, true);
      const off = await http.get("/api/v1/driver/me").set("Authorization", `Bearer ${actors.driverOfflineToken}`).expect(200);
      assert.equal(off.body.isOnline, false);
    });

    // ------------------------------------------------------------------ live tracking
    await context.test("a driver's reported position reaches the admin socket and the REST views", async () => {
      adminEvents.length = 0;
      await http
        .patch("/api/v1/driver/me/location")
        .set("Authorization", `Bearer ${actors.driverAToken}`)
        .send({ latitude: 31.9051, longitude: 35.2101 })
        .expect(200);

      await eventually(() => adminEvents.some((entry) => entry.event === "driver.location.updated"));
      const moved = adminEvents.find((entry) => entry.event === "driver.location.updated")!.payload;
      assert.equal(moved.userId, actors.driverAId);
      assert.equal(moved.latitude, 31.9051);
      assert.equal(moved.longitude, 35.2101);
      assert.ok(!Number.isNaN(Date.parse(moved.lastLocationAt)));

      const live = await http.get("/api/v1/admin/drivers/locations").set("Authorization", `Bearer ${actors.adminToken}`).expect(200);
      const byId = new Map<string, any>(live.body.map((entry: any) => [entry.userId, entry]));
      const a = byId.get(actors.driverAId);
      assert.equal(a.latitude, 31.9051);
      assert.equal(a.activeDelivery.orderId, order.id);
      assert.equal(a.activeDelivery.restaurantName, "Tracking E2E MARKET");
      assert.ok(byId.has(actors.driverBId), "an on-shift driver with no fix is still listed");
      assert.equal(byId.get(actors.driverBId).latitude, null);
      assert.ok(!byId.has(actors.driverOfflineId), "an offline driver with no job is not on the map");

      const tracking = await http
        .get(`/api/v1/admin/drivers/tracking/orders/${order.id}`)
        .set("Authorization", `Bearer ${actors.adminToken}`)
        .expect(200);
      assert.equal(tracking.body.driver.userId, actors.driverAId);
      assert.equal(tracking.body.driver.latitude, 31.9051);
      assert.equal(tracking.body.deliveryStatus, "ASSIGNED");
      assert.deepEqual(tracking.body.pickup, { name: "Tracking E2E MARKET", ...marketLocation });
      assert.equal(tracking.body.destination.latitude, customerLocation.deliveryLatitude);
    });

    await context.test("delivery progress is announced to admins, naming the driver", async () => {
      adminEvents.length = 0;
      await http
        .patch(`/api/v1/driver/me/deliveries/${delivery.id}/status`)
        .set("Authorization", `Bearer ${actors.driverAToken}`)
        .send({ status: "PICKED_UP" })
        .expect(200);
      await eventually(() => adminEvents.some((entry) => entry.event === "delivery.status.changed"));
      const changed = adminEvents.find((entry) => entry.event === "delivery.status.changed")!.payload;
      assert.equal(changed.orderId, order.id);
      assert.equal(changed.status, "PICKED_UP");
      assert.equal(changed.driverUserId, actors.driverAId);
    });

    await context.test("only admins with the driver permission can see positions", async () => {
      for (const path of ["/api/v1/admin/drivers/locations", `/api/v1/admin/drivers/tracking/orders/${order.id}`]) {
        await http.get(path).set("Authorization", `Bearer ${actors.driverAToken}`).expect(403);
        await http.get(path).set("Authorization", `Bearer ${actors.customerToken}`).expect(403);
        await http.get(path).set("Authorization", `Bearer ${actors.marketToken}`).expect(403);
        await http.get(path).expect(401);
      }
      await http
        .get("/api/v1/admin/drivers/tracking/orders/00000000-0000-4000-8000-000000000000")
        .set("Authorization", `Bearer ${actors.adminToken}`)
        .expect(404);
      await http.get("/api/v1/admin/drivers/tracking/orders/not-a-uuid").set("Authorization", `Bearer ${actors.adminToken}`).expect(400);
    });

    await context.test("a customer cannot join the driver's room to see the position over the socket", async () => {
      const seen: unknown[] = [];
      customerSocket.on("driver.location.updated", (payload) => seen.push(payload));
      customerSocket.emit("order.subscribe", { orderId: order.id });
      await http
        .patch("/api/v1/driver/me/location")
        .set("Authorization", `Bearer ${actors.driverAToken}`)
        .send({ latitude: 31.906, longitude: 35.211 })
        .expect(200);
      await sleep(400);
      assert.equal(seen.length, 0);
    });

    // ------------------------------------------------------------------ the cash screen
    for (const status of ["ON_THE_WAY", "DELIVERED"] as const) {
      await http
        .patch(`/api/v1/driver/me/deliveries/${delivery.id}/status`)
        .set("Authorization", `Bearer ${actors.driverAToken}`)
        .send({ status })
        .expect(200);
    }

    await context.test("the cash summary is read from the ledger and keeps cash and pay apart", async () => {
      const record = await prisma.orderFinancialRecord.findUniqueOrThrow({ where: { orderId: order.id } });
      const custody = await prisma.driverCashCustody.findUniqueOrThrow({ where: { orderId: order.id } });
      const earning = await prisma.partnerEarning.findFirstOrThrow({
        where: { driverUserId: actors.driverAId, orderFinancialRecordId: record.id }
      });

      const response = await http
        .get("/api/v1/driver/me/cash-summary?period=ALL")
        .set("Authorization", `Bearer ${actors.driverAToken}`)
        .expect(200);
      const summary = response.body;

      assert.equal(summary.cashCollectedMinor, custody.collectedAmountMinor);
      assert.equal(summary.cashCollectedMinor, record.cashCollectedMinor);
      assert.equal(summary.earningsMinor, earning.amountMinor);
      assert.equal(summary.earningsMinor, record.driverShareMinor);
      assert.equal(summary.balance.cashOwedToPlatformMinor, custody.collectedAmountMinor, "settlement is gross: earnings are not netted");
      assert.equal(summary.balance.earningsOwedToDriverMinor, earning.amountMinor);
      assert.notEqual(summary.balance.cashOwedToPlatformMinor, summary.cashCollectedMinor - summary.earningsMinor);
      assert.equal(summary.deliveredCount, 1);
      assert.equal(summary.lines.length, 1);
      assert.equal(summary.lines[0].orderId, order.id);
      assert.equal(summary.lines[0].restaurantName, "Tracking E2E MARKET");
      assert.equal(summary.lines[0].outcome, "DELIVERED");
      assert.equal(summary.lines[0].cashCollectedMinor, custody.collectedAmountMinor);
      assert.equal(summary.lines[0].earningMinor, earning.amountMinor);
    });

    await context.test("driver B, who delivered nothing, sees nothing of driver A's money", async () => {
      const response = await http
        .get("/api/v1/driver/me/cash-summary?period=ALL")
        .set("Authorization", `Bearer ${actors.driverBToken}`)
        .expect(200);
      assert.equal(response.body.cashCollectedMinor, 0);
      assert.equal(response.body.earningsMinor, 0);
      assert.equal(response.body.lines.length, 0);
    });

    await context.test("a handover moves cash owed and starts a new shift, without touching earnings", async () => {
      const before = (
        await http.get("/api/v1/driver/me/cash-summary?period=ALL").set("Authorization", `Bearer ${actors.driverAToken}`).expect(200)
      ).body;
      await http
        .post("/api/v1/admin/accounting/cash/settlements")
        .set("Authorization", `Bearer ${actors.adminToken}`)
        .send({
          driverUserId: actors.driverAId,
          reference: `TRACKING-E2E-${Date.now()}`,
          countedAmountMinor: before.balance.cashOwedToPlatformMinor
        })
        .expect(201);

      const after = (
        await http.get("/api/v1/driver/me/cash-summary?period=ALL").set("Authorization", `Bearer ${actors.driverAToken}`).expect(200)
      ).body;
      assert.equal(after.balance.cashOwedToPlatformMinor, 0);
      assert.equal(after.balance.unsettledOrderCount, 0);
      assert.equal(after.cashHandedOverMinor, before.cashCollectedMinor);
      assert.equal(after.cashCollectedMinor, before.cashCollectedMinor, "collected is history; it does not shrink");
      assert.equal(after.earningsMinor, before.earningsMinor);
      assert.equal(after.balance.earningsOwedToDriverMinor, before.balance.earningsOwedToDriverMinor, "the handover does not pay the driver");

      const shift = (
        await http.get("/api/v1/driver/me/cash-summary?period=SHIFT").set("Authorization", `Bearer ${actors.driverAToken}`).expect(200)
      ).body;
      assert.ok(shift.lastHandoverAt);
      assert.equal(shift.cashCollectedMinor, 0, "a new shift starts at the handover");
      assert.equal(shift.lines.length, 0);
    });

    await context.test("an unknown period is rejected", async () => {
      await http.get("/api/v1/driver/me/cash-summary?period=FOREVER").set("Authorization", `Bearer ${actors.driverAToken}`).expect(400);
      await http.get("/api/v1/driver/me/cash-summary").set("Authorization", `Bearer ${actors.customerToken}`).expect(403);
    });

    // ------------------------------------------------------------------ alerts need the app running
    const deliveryIdByOrder = new Map<string, string>();
    const alertsFor = (userId: string, sinceOrderId?: string) =>
      prisma.notification.count({
        where: {
          userId,
          type: "DELIVERY_AVAILABLE",
          ...(sinceOrderId
            ? { relatedEntityId: (deliveryIdByOrder.get(sinceOrderId) ?? "00000000-0000-4000-8000-000000000000") }
            : {})
        }
      });
    async function readyOrder(): Promise<string> {
      const placed = await placeOrder(http, actors);
      await advanceToReady(http, actors, placed.id);
      const row = await prisma.delivery.findUniqueOrThrow({ where: { orderId: placed.id } });
      deliveryIdByOrder.set(placed.id, row.id);
      return placed.id;
    }

    await context.test("online + app open = alerted; online + app CLOSED = no alert is attempted", async () => {
      // Driver B is on shift. First the app is open...
      await reportPresence(http, actors.driverBToken, "FOREGROUND").then((response) => assert.equal(response.status, 200));
      await reportPresence(http, actors.driverAToken, "FOREGROUND");
      const open = await readyOrder();
      assert.equal(await alertsFor(actors.driverBId, open), 1, "app open: alerted");
      const queuedOpen = await prisma.pushDelivery.count({
        where: { notification: { userId: actors.driverBId, relatedEntityId: deliveryIdByOrder.get(open) } }
      });
      assert.equal(queuedOpen, 1);

      // ...then the app is closed (logout / lease gone) while the online flag is still set.
      const closed = await reportPresence(http, actors.driverBToken, "CLOSED");
      assert.equal(closed.body.appOpen, false);
      const stillOnline = await http.get("/api/v1/driver/me").set("Authorization", `Bearer ${actors.driverBToken}`).expect(200);
      assert.equal(stillOnline.body.isOnline, true, "the online flag is untouched: it is the stale flag the lease overrides");
      const afterClose = await readyOrder();
      assert.equal(await alertsFor(actors.driverBId, afterClose), 0, "app closed: no alert row");
      assert.equal(
        await prisma.pushDelivery.count({
          where: { notification: { userId: actors.driverBId, relatedEntityId: deliveryIdByOrder.get(afterClose) } }
        }),
        0,
        "and no push was attempted"
      );
      assert.equal(await alertsFor(actors.driverAId, afterClose), 1, "the driver whose app is open still is");
    });

    await context.test("offline + app open = no alert; a lapsed lease is treated as closed", async () => {
      await reportPresence(http, actors.driverOfflineToken, "FOREGROUND");
      const offline = await http.get("/api/v1/driver/me").set("Authorization", `Bearer ${actors.driverOfflineToken}`).expect(200);
      assert.equal(offline.body.isOnline, false);
      const order = await readyOrder();
      assert.equal(await alertsFor(actors.driverOfflineId, order), 0, "offline: not alerted even with the app open");

      // A lease that ran out on its own: the phone stopped reporting (force-closed).
      await reportPresence(http, actors.driverBToken, "FOREGROUND");
      await prisma.driverProfile.update({
        where: { userId: actors.driverBId },
        data: { appLeaseUntil: new Date(Date.now() - 1_000) }
      });
      const lapsed = await readyOrder();
      assert.equal(await alertsFor(actors.driverBId, lapsed), 0, "lease lapsed: treated as closed");
    });

    await context.test("the admin sees who is connected, live, and tells them apart from the merely approved", async () => {
      await reportPresence(http, actors.driverBToken, "CLOSED");
      adminEvents.length = 0;
      await reportPresence(http, actors.driverBToken, "FOREGROUND");
      await eventually(() => adminEvents.some((entry) => entry.event === "driver.presence.changed"));
      const opened = adminEvents.find((entry) => entry.event === "driver.presence.changed")!.payload;
      assert.equal(opened.userId, actors.driverBId);
      assert.equal(opened.appOpen, true);
      assert.equal(opened.appState, "FOREGROUND");
      assert.ok(Date.parse(opened.appLeaseUntil) > Date.now());

      const heartbeats = adminEvents.length;
      await reportPresence(http, actors.driverBToken, "FOREGROUND");
      await sleep(250);
      assert.equal(adminEvents.length, heartbeats, "a routine heartbeat is not broadcast");

      const list = await http.get("/api/v1/admin/drivers").set("Authorization", `Bearer ${actors.adminToken}`).expect(200);
      const byId = new Map<string, any>(list.body.map((row: any) => [row.userId, row]));
      assert.equal(byId.get(actors.driverBId).appOpen, true);
      assert.equal(byId.get(actors.driverBId).isOnline, true);
      assert.equal(byId.get(actors.driverOfflineId).isOnline, false);
      await reportPresence(http, actors.driverBToken, "CLOSED");
      const afterClose = await http.get("/api/v1/admin/drivers").set("Authorization", `Bearer ${actors.adminToken}`).expect(200);
      const closedRow = afterClose.body.find((row: any) => row.userId === actors.driverBId);
      assert.equal(closedRow.isOnline, true, "still marked online");
      assert.equal(closedRow.appOpen, false, "but not connected");
    });

    await context.test("only a driver can report presence", async () => {
      await http.put("/api/v1/driver/me/presence").send({ state: "FOREGROUND" }).expect(401);
      await http.put("/api/v1/driver/me/presence").set("Authorization", `Bearer ${actors.customerToken}`).send({ state: "FOREGROUND" }).expect(403);
      await http.put("/api/v1/driver/me/presence").set("Authorization", `Bearer ${actors.driverAToken}`).send({ state: "SLEEPING" }).expect(400);
    });

    // ------------------------------------------------------------------ cash rounding, worked example
    await context.test("WORKED EXAMPLE — a 23.40 order is collected as 24.00 and the ledger still balances to the agora", async () => {
      const overviewBefore = (await http.get("/api/v1/admin/accounting/overview").set("Authorization", `Bearer ${actors.adminToken}`).expect(200)).body;

      const placed = await placeOrder(http, actors, actors.roundingItemId, 1);
      // The order itself stays exact...
      assert.equal(placed.body.subtotalMinor, 1_340);
      assert.equal(placed.body.deliveryFeeMinor, 1_000);
      assert.equal(placed.body.totalMinor, 2_340);
      // ...and the customer is told the cash due, rounded UP.
      assert.equal(placed.body.cashDueMinor, 2_400);
      assert.equal(placed.body.cashRoundingMinor, 60);

      await advanceToReady(http, actors, placed.id);
      await reportPresence(http, actors.driverAToken, "FOREGROUND");
      const available = await http.get("/api/v1/driver/me/deliveries/available").set("Authorization", `Bearer ${actors.driverAToken}`).expect(200);
      const offered = available.body.find((candidate: any) => candidate.order.id === placed.id);
      assert.equal(offered.order.totalMinor, 2_340);
      assert.equal(offered.order.cashDueMinor, 2_400, "the driver is told to collect 24.00");
      await http.post(`/api/v1/driver/me/deliveries/${offered.id}/accept`).set("Authorization", `Bearer ${actors.driverAToken}`).expect(201);
      for (const status of ["PICKED_UP", "ON_THE_WAY", "DELIVERED"] as const) {
        await http.patch(`/api/v1/driver/me/deliveries/${offered.id}/status`).set("Authorization", `Bearer ${actors.driverAToken}`).send({ status }).expect(200);
      }

      const record = (await http.get(`/api/v1/admin/accounting/orders/${placed.id}`).set("Authorization", `Bearer ${actors.adminToken}`).expect(200)).body;
      //   items 13.40 + delivery 10.00               23.40   exact order value
      //   rounded UP to a whole shekel               24.00   cash collected
      //   difference                                  0.60   CASH_ROUNDING -> platform account
      assert.equal(record.itemSubtotalMinor, 1_340);
      assert.equal(record.deliveryFeeMinor, 1_000);
      assert.equal(record.cashCollectedMinor, 2_400);
      assert.equal(record.cashRoundingMinor, 60);
      assert.equal(record.driverShareMinor, 700, "the driver's 70% of the exact 10.00 fee is unchanged");

      const rounding = record.entries.filter((entry: any) => entry.component === "CASH_ROUNDING");
      assert.equal(rounding.length, 1, "exactly one rounding row");
      assert.equal(rounding[0].amountMinor, 60);
      assert.equal(rounding[0].payeeType, "PARTNER");
      const account = await prisma.partnerAccount.findUniqueOrThrow({ where: { key: "PLATFORM_ROUNDING" } });
      assert.equal(rounding[0].payeeKey, `PARTNER:${account.id}`, "held by the dedicated platform account, not an owner or partner");

      const sumAll = record.entries.reduce((sum: number, entry: any) => sum + entry.amountMinor, 0);
      const sumWithoutRounding = record.entries
        .filter((entry: any) => entry.component !== "CASH_ROUNDING")
        .reduce((sum: number, entry: any) => sum + entry.amountMinor, 0);
      assert.equal(sumWithoutRounding, 2_340, "every partner's share still adds up to the exact order value");
      assert.equal(sumAll, 2_400, "and with the rounding row, to the cash actually collected");
      assert.equal(record.reconciliation.distributedMinor, 2_400);
      assert.equal(record.reconciliation.balancedMinor, 0, "the ledger balances exactly");

      const custody = await prisma.driverCashCustody.findUniqueOrThrow({ where: { orderId: placed.id } });
      assert.equal(custody.collectedAmountMinor, 2_400, "the driver holds the 24.00 that was collected");
      const stored = await prisma.order.findUniqueOrThrow({ where: { id: placed.id } });
      assert.equal(stored.totalMinor, 2_340, "the order itself was never rewritten");

      const overviewAfter = (await http.get("/api/v1/admin/accounting/overview").set("Authorization", `Bearer ${actors.adminToken}`).expect(200)).body;
      assert.equal(
        overviewAfter.ledgerImbalanceMinor - overviewBefore.ledgerImbalanceMinor,
        0,
        "the platform-wide ledger imbalance did not move"
      );

      const summary = (await http.get("/api/v1/driver/me/cash-summary?period=ALL").set("Authorization", `Bearer ${actors.driverAToken}`).expect(200)).body;
      const line = summary.lines.find((candidate: any) => candidate.orderId === placed.id);
      assert.equal(line.cashCollectedMinor, 2_400, "the driver's screen shows what they actually hold");
      assert.equal(summary.balance.cashOwedToPlatformMinor, 2_400);

      const customerView = (await http.get(`/api/v1/orders/${placed.id}`).set("Authorization", `Bearer ${actors.customerToken}`).expect(200)).body;
      assert.equal(customerView.totalMinor, 2_340);
      assert.equal(customerView.cashDueMinor, 2_400);
    });

    await context.test("the database itself refuses a rounding row that is not a small platform credit", async () => {
      const record = await prisma.orderFinancialRecord.findFirstOrThrow({ where: { cashRoundingMinor: 60 } });
      const account = await prisma.partnerAccount.findUniqueOrThrow({ where: { key: "PLATFORM_ROUNDING" } });
      const attempt = (amountMinor: number, payee: { partnerAccountId?: string; driverUserId?: string }) =>
        prisma.partnerEarning.create({
          data: {
            sourceType: "ORDER",
            sourceId: record.id,
            orderFinancialRecordId: record.id,
            payeeType: payee.driverUserId ? "DRIVER" : "PARTNER",
            payeeKey: payee.driverUserId ? `DRIVER:${payee.driverUserId}` : `PARTNER:${payee.partnerAccountId}`,
            partnerAccountId: payee.partnerAccountId ?? null,
            driverUserId: payee.driverUserId ?? null,
            component: "CASH_ROUNDING",
            amountMinor,
            occurredAt: new Date()
          }
        });
      await assert.rejects(attempt(150, { partnerAccountId: account.id }), /cash_rounding_shape|check constraint/i, "a shekel or more is not rounding");
      await assert.rejects(attempt(-10, { partnerAccountId: account.id }), /cash_rounding_shape|check constraint/i, "rounding is never a debit");
      await assert.rejects(attempt(10, { driverUserId: actors.driverAId }), /cash_rounding_shape|check constraint|payee/i, "rounding never goes to a driver");
    });
  }
);

// ---------------------------------------------------------------------------------------------
type Actors = Awaited<ReturnType<typeof createActors>>;

async function createActors(http: Http, prisma: PrismaService) {
  const passwordHash = await hashPassword(password);
  const superAdminRole = await prisma.role.findUnique({ where: { key: "SUPER_ADMIN" } });
  assert.ok(superAdminRole, "System roles must be migrated before running this suite.");
  const admin = await prisma.user.create({
    data: {
      platformRoleId: superAdminRole.id,
      fullName: "Tracking E2E Admin",
      phone: phones.admin,
      passwordHash,
      role: UserRole.ADMIN,
      phoneVerifiedAt: new Date(),
      isActive: true
    }
  });
  await prisma.user.create({
    data: {
      fullName: "Tracking E2E Customer",
      phone: phones.customer,
      passwordHash,
      role: UserRole.CUSTOMER,
      phoneVerifiedAt: new Date(),
      isActive: true
    }
  });
  const adminToken = await login(http, local.admin);
  const customerToken = await login(http, local.customer);

  const registration = await http
    .post("/api/v1/restaurants/register")
    .send({
      ownerFullName: "Tracking E2E Market Owner",
      countryCode: "+970",
      phoneNumber: local.market,
      password,
      confirmPassword: password,
      restaurantName: "Tracking E2E MARKET",
      businessType: "SUPERMARKET",
      addressLine: "Tracking Integration Street, Ramallah"
    })
    .expect(201);
  const marketId = registration.body.restaurantId as string;
  const marketToken = await login(http, local.market);
  await http
    .patch("/api/v1/restaurant/me")
    .set("Authorization", `Bearer ${marketToken}`)
    .send({ addressLine: "Tracking Integration Street", ...marketLocation })
    .expect(200);
  await http.post(`/api/v1/admin/restaurants/${marketId}/approve`).set("Authorization", `Bearer ${adminToken}`).expect(201);
  await http.patch("/api/v1/restaurant/me/open-status").set("Authorization", `Bearer ${marketToken}`).send({ isOpen: true }).expect(200);
  const category = await http
    .post("/api/v1/restaurant/me/menu/categories")
    .set("Authorization", `Bearer ${marketToken}`)
    .send({ name: "Tracking Section", sortOrder: 1 })
    .expect(201);
  const item = await http
    .post("/api/v1/restaurant/me/menu/items")
    .set("Authorization", `Bearer ${marketToken}`)
    .send({ categoryId: category.body.id, name: "Tracking Olive Oil", priceMinor: 5_000, costPriceMinor: 3_500 })
    .expect(201);
  // 13.40 + the 10.00 minimum delivery fee = 23.40, which is collected as 24.00 (rounded UP).
  const roundingItem = await http
    .post("/api/v1/restaurant/me/menu/items")
    .set("Authorization", `Bearer ${marketToken}`)
    .send({ categoryId: category.body.id, name: "Tracking Rounding Item", priceMinor: 1_340, costPriceMinor: 900 })
    .expect(201);

  async function driver(fullName: string, phone: string, online: boolean, platform: "android" | "ios") {
    const created = await http
      .post("/api/v1/drivers/register")
      .send({ fullName, countryCode: "+970", phoneNumber: phone, password, confirmPassword: password })
      .expect(201);
    const userId = created.body.userId as string;
    await http.post(`/api/v1/admin/drivers/${userId}/approve`).set("Authorization", `Bearer ${adminToken}`).expect(201);
    const token = await login(http, phone);
    if (online) {
      await http.patch("/api/v1/driver/me/status").set("Authorization", `Bearer ${token}`).send({ isOnline: true }).expect(200);
    }
    const pushToken = `ExponentPushToken[tracking-e2e-${userId}]`;
    await http
      .post("/api/v1/users/me/push-tokens")
      .set("Authorization", `Bearer ${token}`)
      .send({ token: pushToken, platform })
      .expect(201);
    return { userId, token, pushToken };
  }
  const driverA = await driver("Tracking E2E Driver A", local.driverA, true, "android");
  const driverB = await driver("Tracking E2E Driver B", local.driverB, true, "ios");
  const driverOffline = await driver("Tracking E2E Driver Offline", local.driverOffline, false, "android");

  return {
    adminToken,
    adminUserId: admin.id,
    customerToken,
    marketToken,
    marketId,
    itemId: item.body.id as string,
    roundingItemId: roundingItem.body.id as string,
    driverAId: driverA.userId,
    driverAToken: driverA.token,
    driverAToken_push: driverA.pushToken,
    driverBId: driverB.userId,
    driverBToken: driverB.token,
    driverBToken_push: driverB.pushToken,
    driverOfflineId: driverOffline.userId,
    driverOfflineToken: driverOffline.token
  };
}

async function placeOrder(http: Http, actors: Actors, itemId = actors.itemId, quantity = 2): Promise<{ id: string; body: any }> {
  const order = await http
    .post("/api/v1/orders")
    .set("Authorization", `Bearer ${actors.customerToken}`)
    .send({
      restaurantId: actors.marketId,
      items: [{ menuItemId: itemId, quantity }],
      deliveryLabel: "Home",
      deliveryAddressLine: "Secret Lane 12",
      ...customerLocation,
      paymentMethod: "CASH"
    })
    .expect(201);
  return { id: order.body.id as string, body: order.body };
}

async function reportPresence(http: Http, token: string, state: "FOREGROUND" | "BACKGROUND" | "CLOSED") {
  return http.put("/api/v1/driver/me/presence").set("Authorization", `Bearer ${token}`).send({ state });
}

async function advanceToReady(http: Http, actors: Actors, orderId: string): Promise<void> {
  for (const status of ["ACCEPTED", "PREPARING", "READY_FOR_PICKUP"] as const) {
    await http
      .patch(`/api/v1/restaurant/me/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${actors.marketToken}`)
      .send({ status })
      .expect(200);
  }
}

async function login(http: Http, phoneNumber: string): Promise<string> {
  const response = await http.post("/api/v1/auth/login").send({ countryCode: "+970", phoneNumber, password }).expect(201);
  return response.body.accessToken as string;
}

async function openSocket(baseUrl: string, token: string, registry: Socket[]): Promise<Socket> {
  const socket = connectSocket(baseUrl, { auth: { token }, transports: ["websocket"], forceNew: true });
  registry.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
    setTimeout(() => reject(new Error("socket did not connect")), 5_000);
  });
  // The gateway joins rooms after authenticating; give it a beat so emits are not raced.
  await sleep(150);
  return socket;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function eventually(check: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await sleep(50);
  }
  assert.fail("expected event did not arrive in time");
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
      await prisma.orderFinancialRecord.findMany({
        where: businessIds.length ? { businessId: { in: businessIds } } : { id: "" },
        select: { id: true }
      })
    ).map((record) => record.id);
    await prisma.cashSettlementAllocation.deleteMany({ where: { custody: { driverUserId: { in: userIds } } } });
    await prisma.driverCashCustody.deleteMany({ where: { driverUserId: { in: userIds } } });
    await prisma.cashSettlement.deleteMany({
      where: { OR: [{ driverUserId: { in: userIds } }, { receivedByUserId: { in: userIds } }] }
    });
    await prisma.partnerSettlementAllocation.deleteMany({
      where: { earning: { OR: [{ driverUserId: { in: userIds } }, { orderFinancialRecordId: { in: recordIds } }] } }
    });
    await prisma.partnerSettlement.deleteMany({ where: { OR: [{ driverUserId: { in: userIds } }, { paidByUserId: { in: userIds } }] } });
    await prisma.partnerEarning.deleteMany({
      where: { OR: [{ orderFinancialRecordId: { in: recordIds } }, { driverUserId: { in: userIds } }] }
    });
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

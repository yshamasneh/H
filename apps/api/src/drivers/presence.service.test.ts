import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigService } from "@nestjs/config";
import { FakeRealtimeGateway } from "../realtime/testing/fake-realtime-gateway";
import { DriversService } from "./drivers.service";
import { FakeDriversPrisma } from "./testing/fake-prisma";

function createService(config?: ConfigService) {
  const prisma = new FakeDriversPrisma();
  const realtime = new FakeRealtimeGateway();
  const service = new DriversService(prisma as never, realtime as never, config);
  return { prisma, realtime, service };
}

const presenceEvents = (realtime: FakeRealtimeGateway) =>
  realtime.emitted.filter((event) => event.event === "driver.presence.changed");
const profileOf = (prisma: FakeDriversPrisma, userId: string) => prisma.driverProfiles.find((row) => row.userId === userId)!;

test("a foreground heartbeat opens a short lease, and is announced to admins only when it changes something", async () => {
  const { prisma, realtime, service } = createService();
  const driver = prisma.seedDriver({ isOnline: true });

  const first = await service.reportPresence(driver.userId, "FOREGROUND");
  assert.equal(first.appOpen, true);
  assert.ok(Math.abs(first.appLeaseUntil!.getTime() - (Date.now() + 120_000)) < 2_000);
  assert.equal(presenceEvents(realtime).length, 1, "the app opening is news");

  await service.reportPresence(driver.userId, "FOREGROUND");
  await service.reportPresence(driver.userId, "FOREGROUND");
  assert.equal(presenceEvents(realtime).length, 1, "a routine heartbeat is not");
  assert.ok(presenceEvents(realtime).every((event) => event.room === "admins"));
});

test("going to the background buys a longer grace and is announced; closing ends the lease", async () => {
  const { prisma, realtime, service } = createService();
  const driver = prisma.seedDriver({ isOnline: true });
  await service.reportPresence(driver.userId, "FOREGROUND");

  const background = await service.reportPresence(driver.userId, "BACKGROUND");
  assert.equal(profileOf(prisma, driver.userId).appState, "BACKGROUND");
  assert.ok(Math.abs(background.appLeaseUntil!.getTime() - (Date.now() + 30 * 60_000)) < 2_000);

  const closed = await service.reportPresence(driver.userId, "CLOSED");
  assert.equal(closed.appOpen, false);
  assert.equal(closed.appLeaseUntil, null);
  assert.equal(profileOf(prisma, driver.userId).appState, null);

  const payloads = presenceEvents(realtime).map((event) => event.payload as { appState: string | null; appOpen: boolean });
  assert.deepEqual(payloads.map((payload) => [payload.appState, payload.appOpen]), [
    ["FOREGROUND", true],
    ["BACKGROUND", true],
    [null, false]
  ]);
});

test("going online counts as the app being open, so a driver who just tapped the switch is immediately alertable", async () => {
  const { prisma, service } = createService();
  const driver = prisma.seedDriver({ isOnline: false });

  await service.setOnlineStatus(driver.userId, true);

  const stored = profileOf(prisma, driver.userId);
  assert.equal(stored.isOnline, true);
  assert.equal(stored.appState, "FOREGROUND");
  assert.ok(stored.appLeaseUntil!.getTime() > Date.now());
});

test("going offline does not touch the lease: the app may well still be open", async () => {
  const { prisma, service } = createService();
  const driver = prisma.seedDriver({ isOnline: true });
  await service.reportPresence(driver.userId, "FOREGROUND");
  const lease = profileOf(prisma, driver.userId).appLeaseUntil;

  await service.setOnlineStatus(driver.userId, false);

  assert.equal(profileOf(prisma, driver.userId).appLeaseUntil, lease);
});

test("a location fix renews the lease in the state the app last announced, and says whether a delivery is still being tracked", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const driver = prisma.seedDriver({ isOnline: true });
  await service.reportPresence(driver.userId, "BACKGROUND");

  const idle = await service.updateLocation(driver.userId, 31.9, 35.2);
  assert.equal(idle.hasActiveDelivery, false, "nothing to track: the phone should stop its background task");
  assert.equal(profileOf(prisma, driver.userId).appState, "BACKGROUND");
  assert.ok(profileOf(prisma, driver.userId).appLeaseUntil!.getTime() - Date.now() > 25 * 60_000);

  const order = prisma.seedOrder(restaurant.id);
  prisma.seedOrderItem(order.id);
  prisma.seedDelivery(order.id, { driverId: driver.userId, status: "ON_THE_WAY" as never });
  assert.equal((await service.updateLocation(driver.userId, 31.9, 35.2)).hasActiveDelivery, true);
});

test("the tracking flag goes false the moment the delivery completes", async () => {
  const { prisma, service } = createService();
  const restaurant = prisma.seedRestaurant();
  const driver = prisma.seedDriver({ isOnline: true });
  const order = prisma.seedOrder(restaurant.id);
  prisma.seedOrderItem(order.id);
  const delivery = prisma.seedDelivery(order.id, { driverId: driver.userId, status: "ASSIGNED" as never });
  assert.equal((await service.updateLocation(driver.userId, 31.9, 35.2)).hasActiveDelivery, true);

  await service.updateDeliveryStatus(driver.userId, delivery.id, "PICKED_UP");
  await service.updateDeliveryStatus(driver.userId, delivery.id, "ON_THE_WAY");
  await service.updateDeliveryStatus(driver.userId, delivery.id, "DELIVERED");

  assert.equal((await service.updateLocation(driver.userId, 31.9, 35.2)).hasActiveDelivery, false);
});

test("the lease durations come from configuration when it is provided", async () => {
  const config = new ConfigService({
    DRIVER_PRESENCE_FOREGROUND_LEASE_SECONDS: 30,
    DRIVER_PRESENCE_BACKGROUND_GRACE_MINUTES: 5
  });
  const { prisma, service } = createService(config);
  const driver = prisma.seedDriver({ isOnline: true });

  const foreground = await service.reportPresence(driver.userId, "FOREGROUND");
  assert.ok(Math.abs(foreground.appLeaseUntil!.getTime() - (Date.now() + 30_000)) < 2_000);
  const background = await service.reportPresence(driver.userId, "BACKGROUND");
  assert.ok(Math.abs(background.appLeaseUntil!.getTime() - (Date.now() + 5 * 60_000)) < 2_000);
});

test("admin views tell a driver who is on shift with the app open from one who is only approved or has a stale online flag", async () => {
  const { prisma, service } = createService();
  const connected = prisma.seedDriver({ isOnline: true });
  const staleOnline = prisma.seedDriver({ isOnline: true });
  const merelyApproved = prisma.seedDriver({ isOnline: false });
  await service.reportPresence(connected.userId, "FOREGROUND");
  // The stale one reported in long ago and never again: online flag still set, app long gone.
  profileOf(prisma, staleOnline.userId).appState = "BACKGROUND";
  profileOf(prisma, staleOnline.userId).appLeaseUntil = new Date(Date.now() - 3 * 3_600_000);

  const all = await service.adminListDrivers();
  const byId = new Map(all.map((view) => [view.userId, view]));
  assert.equal(byId.get(connected.userId)!.isOnline && byId.get(connected.userId)!.appOpen, true);
  assert.equal(byId.get(staleOnline.userId)!.isOnline, true);
  assert.equal(byId.get(staleOnline.userId)!.appOpen, false, "online flag alone is not 'connected'");
  assert.equal(byId.get(merelyApproved.userId)!.isOnline, false);
  assert.equal(byId.get(merelyApproved.userId)!.appOpen, false);

  const live = await service.adminListDriverLocations();
  const liveById = new Map(live.map((view) => [view.userId, view]));
  assert.equal(liveById.get(connected.userId)!.appOpen, true);
  assert.equal(liveById.get(staleOnline.userId)!.appOpen, false);
  assert.ok(!liveById.has(merelyApproved.userId));
});

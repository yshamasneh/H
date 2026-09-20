import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ageLabel,
  applyLocationUpdate,
  applyOnlineChange,
  applyPresenceUpdate,
  connectionState,
  countConnections,
  freshness,
  hasPosition,
  isLocationUpdate,
  sortForList,
  type TrackedDriver
} from "./driver-tracking";

const now = Date.parse("2026-09-20T12:00:00.000Z");
const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();

function driver(overrides: Partial<TrackedDriver> = {}): TrackedDriver {
  return {
    userId: "d1",
    fullName: "Omar",
    phone: "+970590000001",
    status: "APPROVED",
    isOnline: true,
    appState: "FOREGROUND",
    appLeaseUntil: new Date(now + 60_000).toISOString(),
    appOpen: true,
    latitude: 31.83,
    longitude: 35.14,
    lastLocationAt: ago(5),
    activeDelivery: null,
    ...overrides
  };
}

test("a fix from the last minute is live, up to five minutes is recent, older is stale", () => {
  assert.equal(freshness(ago(10), now), "live");
  assert.equal(freshness(ago(60), now), "live");
  assert.equal(freshness(ago(61), now), "recent");
  assert.equal(freshness(ago(300), now), "recent");
  assert.equal(freshness(ago(301), now), "stale");
});

test("a driver who has never reported, or reported nonsense, has no fix", () => {
  assert.equal(freshness(null, now), "none");
  assert.equal(freshness("not a date", now), "none");
});

test("age reads in seconds, minutes, then hours, and never goes negative on a skewed clock", () => {
  assert.deepEqual(ageLabel(ago(12), now), { unit: "seconds", value: 12 });
  assert.deepEqual(ageLabel(ago(150), now), { unit: "minutes", value: 2 });
  assert.deepEqual(ageLabel(ago(7300), now), { unit: "hours", value: 2 });
  assert.deepEqual(ageLabel(new Date(now + 5000).toISOString(), now), { unit: "seconds", value: 0 });
  assert.equal(ageLabel(null, now), null);
});

test("a position needs both coordinates to be finite numbers", () => {
  assert.equal(hasPosition({ latitude: 31.8, longitude: 35.1 }), true);
  assert.equal(hasPosition({ latitude: null, longitude: 35.1 }), false);
  assert.equal(hasPosition({ latitude: 31.8, longitude: Number.NaN }), false);
});

test("a live position moves the matching driver and leaves everyone else untouched", () => {
  const list = [driver(), driver({ userId: "d2", fullName: "Sami", latitude: 31.9 })];
  const next = applyLocationUpdate(list, { userId: "d1", latitude: 31.84, longitude: 35.15, lastLocationAt: ago(1) });

  assert.equal(next[0].latitude, 31.84);
  assert.equal(next[0].longitude, 35.15);
  assert.equal(next[0].lastLocationAt, ago(1));
  assert.equal(next[1], list[1], "the other driver's row is the same object, so nothing re-renders for them");
});

test("an older fix never overwrites a newer one, as can happen when a socket reconnects", () => {
  const list = [driver({ lastLocationAt: ago(5) })];
  const next = applyLocationUpdate(list, { userId: "d1", latitude: 30, longitude: 34, lastLocationAt: ago(30) });

  assert.equal(next, list);
  assert.equal(next[0].latitude, 31.83);
});

test("a position for a driver not in the list is ignored, and malformed payloads are refused", () => {
  const list = [driver()];
  assert.equal(applyLocationUpdate(list, { userId: "someone-new", latitude: 31, longitude: 35, lastLocationAt: ago(1) }), list);
  assert.equal(applyLocationUpdate(list, null), list);
  assert.equal(applyLocationUpdate(list, { userId: "d1", latitude: "31", longitude: 35, lastLocationAt: ago(1) }), list);
  assert.equal(applyLocationUpdate(list, { userId: "d1", latitude: 91, longitude: 35, lastLocationAt: ago(1) }), list);
  assert.equal(isLocationUpdate({ userId: "d1", latitude: 31, longitude: 35, lastLocationAt: "garbage" }), false);
});

test("the list leads with fresh drivers on a delivery, and ends with drivers who have no position yet", () => {
  const drivers = [
    driver({ userId: "none", fullName: "Aya", latitude: null, longitude: null, lastLocationAt: null }),
    driver({ userId: "stale", fullName: "Bilal", lastLocationAt: ago(1000) }),
    driver({ userId: "idle", fullName: "Dana", lastLocationAt: ago(10) }),
    driver({
      userId: "busy",
      fullName: "Zaid",
      lastLocationAt: ago(10),
      activeDelivery: { deliveryId: "x", orderId: "o", status: "ON_THE_WAY", restaurantName: "JOVO MARKET" }
    })
  ];

  assert.deepEqual(sortForList(drivers, now).map((entry) => entry.userId), ["busy", "idle", "stale", "none"]);
});

// ---- who is actually connected -----------------------------------------------------------------------

const inSeconds = (seconds: number) => new Date(now + seconds * 1000).toISOString();

test("online with the app running is connected; online with the app gone quiet is not; offline is offline", () => {
  assert.equal(connectionState({ isOnline: true, appLeaseUntil: inSeconds(30) }, now), "connected");
  assert.equal(connectionState({ isOnline: true, appLeaseUntil: inSeconds(-1) }, now), "online-app-closed");
  assert.equal(connectionState({ isOnline: true, appLeaseUntil: null }, now), "online-app-closed", "never reported in");
  assert.equal(connectionState({ isOnline: false, appLeaseUntil: inSeconds(30) }, now), "offline", "app open but off shift");
});

test("a driver fades from connected on the admin's own clock as the lease runs out, with no event needed", () => {
  const lease = inSeconds(30);
  assert.equal(connectionState({ isOnline: true, appLeaseUntil: lease }, now), "connected");
  assert.equal(connectionState({ isOnline: true, appLeaseUntil: lease }, now + 29_000), "connected");
  assert.equal(connectionState({ isOnline: true, appLeaseUntil: lease }, now + 31_000), "online-app-closed");
});

test("the counts tell connected drivers apart from stale online flags and from the merely approved", () => {
  const counts = countConnections(
    [
      { isOnline: true, appLeaseUntil: inSeconds(60) },
      { isOnline: true, appLeaseUntil: inSeconds(60) },
      { isOnline: true, appLeaseUntil: inSeconds(-3_600) },
      { isOnline: false, appLeaseUntil: null },
      { isOnline: false, appLeaseUntil: inSeconds(60) }
    ],
    now
  );
  assert.deepEqual(counts, { connected: 2, onlineAppClosed: 1, offline: 2 });
});

test("a live presence change updates only that driver, and an unknown driver is ignored", () => {
  const list = [driver(), driver({ userId: "d2", fullName: "Sami" })];
  const next = applyPresenceUpdate(list, {
    userId: "d1",
    isOnline: true,
    appState: "BACKGROUND",
    appLeaseUntil: inSeconds(1_800),
    appOpen: true
  });
  assert.equal(next[0].appState, "BACKGROUND");
  assert.equal(next[0].appLeaseUntil, inSeconds(1_800));
  assert.equal(next[1], list[1], "the other driver's row is untouched");

  const unknown = { userId: "nobody", isOnline: true, appState: null, appLeaseUntil: null, appOpen: false };
  assert.equal(applyPresenceUpdate(list, unknown), list);
});

test("the app closing shows as a live change to online-but-not-connected", () => {
  const list = [driver()];
  const [after] = applyPresenceUpdate(list, { userId: "d1", isOnline: true, appState: null, appLeaseUntil: null, appOpen: false });
  assert.equal(after.isOnline, true, "still marked online");
  assert.equal(connectionState(after, now), "online-app-closed");
});

test("malformed presence events are refused", () => {
  const list = [driver()];
  assert.equal(applyPresenceUpdate(list, null), list);
  assert.equal(applyPresenceUpdate(list, { userId: "d1" }), list);
  assert.equal(applyPresenceUpdate(list, { userId: "d1", isOnline: "yes", appState: null, appLeaseUntil: null }), list);
  assert.equal(applyPresenceUpdate(list, { userId: "d1", isOnline: true, appState: "SLEEPING", appLeaseUntil: null }), list);
  assert.equal(applyPresenceUpdate(list, { userId: "d1", isOnline: true, appState: null, appLeaseUntil: "garbage" }), list);
});

test("going on or off shift changes only the online flag", () => {
  const list = [driver(), driver({ userId: "d2" })];
  const off = applyOnlineChange(list, { userId: "d1", isOnline: false });
  assert.equal(off[0].isOnline, false);
  assert.equal(off[0].appLeaseUntil, list[0].appLeaseUntil, "the lease is untouched");
  assert.equal(off[1], list[1]);
  assert.equal(applyOnlineChange(list, { userId: "d1", isOnline: true }), list, "no change, no new array");
  assert.equal(applyOnlineChange(list, { userId: 5 }), list);
});

test("the list puts connected drivers first, then stale online flags, then off-shift drivers", () => {
  const drivers = [
    driver({ userId: "off", fullName: "Aya", isOnline: false, appLeaseUntil: null }),
    driver({ userId: "stale", fullName: "Bilal", appLeaseUntil: inSeconds(-600), lastLocationAt: ago(5) }),
    driver({ userId: "connected", fullName: "Zaid", lastLocationAt: ago(400) })
  ];
  assert.deepEqual(sortForList(drivers, now).map((entry) => entry.userId), ["connected", "stale", "off"]);
});

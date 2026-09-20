import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ageLabel,
  applyLocationUpdate,
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

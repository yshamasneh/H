import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeliveryView } from "../../core/api";
import {
  deliveryPins,
  externalNavigationUrl,
  formatDistance,
  haversineMeters,
  navigationTarget
} from "./navigation-target";

function delivery(
  overrides: Partial<DeliveryView> & { store?: [number | null, number | null]; home?: [number | null, number | null] } = {}
): DeliveryView {
  const { store = [31.84, 35.15], home = [31.86, 35.17], ...rest } = overrides;
  return {
    id: "d1",
    status: "ASSIGNED",
    order: {
      id: "o1",
      deliveryLabel: "Home",
      deliveryAddressLine: "12 Main St",
      totalMinor: 3200,
      paymentMethod: "CASH",
      latitude: home[0],
      longitude: home[1]
    },
    restaurant: { id: "r1", name: "JOVO MARKET", addressLine: "Market St", latitude: store[0], longitude: store[1] },
    assignedAt: null,
    pickedUpAt: null,
    onTheWayAt: null,
    deliveredAt: null,
    createdAt: "2026-09-20T10:00:00.000Z",
    ...rest
  } as DeliveryView;
}

test("an accepted delivery heads to the store first", () => {
  const target = navigationTarget(delivery({ status: "ASSIGNED" }));
  assert.equal(target?.kind, "pickup");
  assert.deepEqual(target?.coordinate, { latitude: 31.84, longitude: 35.15 });
  assert.equal(target?.label, "JOVO MARKET");
});

test("once the goods are collected the target is the customer, and stays so on the way", () => {
  for (const status of ["PICKED_UP", "ON_THE_WAY"] as const) {
    const target = navigationTarget(delivery({ status }));
    assert.equal(target?.kind, "customer");
    assert.deepEqual(target?.coordinate, { latitude: 31.86, longitude: 35.17 });
  }
});

test("a finished delivery has no target", () => {
  assert.equal(navigationTarget(delivery({ status: "DELIVERED" })), null);
  assert.equal(navigationTarget(delivery({ status: "CANCELLED" as never })), null);
});

test("a store or order without coordinates gives no target instead of navigating to 0,0", () => {
  assert.equal(navigationTarget(delivery({ status: "ASSIGNED", store: [null, null] })), null);
  assert.equal(navigationTarget(delivery({ status: "ON_THE_WAY", home: [null, null] })), null);
});

const palette = { driver: "blue", store: "green", destination: "orange" };

test("the map shows the driver, the store and the destination as three distinct markers", () => {
  const pins = deliveryPins(delivery(), { latitude: 31.8, longitude: 35.1 }, { driver: "You" }, palette);
  assert.deepEqual(pins.map((pin) => pin.id), ["driver", "store", "destination"]);
  assert.deepEqual(pins.map((pin) => pin.color), ["blue", "green", "orange"]);
  assert.deepEqual(pins.map((pin) => pin.shape), ["dot", "dot", "pin"]);
});

test("a marker with no coordinate is left off the map rather than drawn at 0,0", () => {
  const pins = deliveryPins(delivery({ store: [null, null], home: [31.86, 35.17] }), null, { driver: "You" }, palette);
  assert.deepEqual(pins.map((pin) => pin.id), ["destination"]);
  assert.deepEqual(
    deliveryPins(null, { latitude: 1, longitude: 2 }, { driver: "You" }, palette).map((pin) => pin.id),
    ["driver"]
  );
});

test("distance is a great-circle figure: a degree of latitude is about 111 km", () => {
  const meters = haversineMeters({ latitude: 31, longitude: 35 }, { latitude: 32, longitude: 35 });
  assert.ok(Math.abs(meters - 111_195) < 300, `got ${meters}`);
  assert.equal(haversineMeters({ latitude: 31.9, longitude: 35.2 }, { latitude: 31.9, longitude: 35.2 }), 0);
});

test("short distances read in metres and long ones in kilometres, in the locale's own script", () => {
  assert.equal(formatDistance(180, "en"), "180 m");
  assert.equal(formatDistance(4, "en"), "10 m", "never shows 0 m for a driver who is right there");
  assert.equal(formatDistance(1_450, "en"), "1.5 km");
  assert.match(formatDistance(1_450, "ar"), /كم$/);
  assert.match(formatDistance(180, "ar"), /م$/);
});

test("the hand-off link opens turn-by-turn driving directions on each platform", () => {
  const point = { latitude: 31.86, longitude: 35.17 };
  assert.equal(externalNavigationUrl("android", point), "google.navigation:q=31.860000,35.170000&mode=d");
  assert.equal(externalNavigationUrl("ios", point), "http://maps.apple.com/?daddr=31.860000,35.170000&dirflg=d");
  assert.equal(
    externalNavigationUrl("web", point),
    "https://www.google.com/maps/dir/?api=1&destination=31.860000,35.170000&travelmode=driving"
  );
});

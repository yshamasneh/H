import assert from "node:assert/strict";
import { test } from "node:test";
import { distanceMeters, shouldDeliverFix, type Fix } from "./position-throttle";

const base: Fix = { latitude: 31.83804, longitude: 35.14047, at: 1_000_000 };

test("the first fix always passes", () => {
  assert.equal(shouldDeliverFix(null, base), true);
});

test("a nearby fix inside 10 s is dropped, so the server is not hit on every browser tick", () => {
  assert.equal(shouldDeliverFix(base, { ...base, at: base.at + 3_000, latitude: base.latitude + 0.00005 }), false);
});

test("a fix after 10 s passes even if the driver has not moved", () => {
  assert.equal(shouldDeliverFix(base, { ...base, at: base.at + 10_000 }), true);
});

test("a fix 30 m or more away passes immediately", () => {
  // 0.0004 degrees of latitude is about 44 m.
  assert.equal(shouldDeliverFix(base, { ...base, at: base.at + 1_000, latitude: base.latitude + 0.0004 }), true);
});

test("distance is in metres and symmetric", () => {
  const other = { latitude: base.latitude + 0.001, longitude: base.longitude };
  const d = distanceMeters(base, other);
  assert.ok(d > 105 && d < 117, String(d));
  assert.ok(Math.abs(d - distanceMeters(other, base)) < 1e-6);
  assert.equal(distanceMeters(base, base), 0);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateDistanceMeters, calculateOrderFees, defaultDeliveryPricing } from "./pricing";

test("delivery pricing keeps the configured minimum inside the included radius", () => {
  const fees = calculateOrderFees(
    { latitude: 31.9038, longitude: 35.2034 },
    { latitude: 31.904, longitude: 35.204 }
  );
  assert.equal(fees.deliveryFeeMinor, defaultDeliveryPricing.minimumFeeMinor);
  assert.ok(fees.deliveryDistanceMeters < defaultDeliveryPricing.includedDistanceMeters);
});

test("delivery pricing charges each started kilometer beyond the included radius", () => {
  const config = { ...defaultDeliveryPricing, includedDistanceMeters: 0, ratePerKilometerMinor: 200 };
  const fees = calculateOrderFees(
    { latitude: 31.9038, longitude: 35.2034 },
    { latitude: 31.9038, longitude: 35.2184 },
    config
  );
  assert.ok(fees.deliveryDistanceMeters > 1_300 && fees.deliveryDistanceMeters < 1_500);
  assert.equal(fees.deliveryFeeMinor, config.minimumFeeMinor + 2 * config.ratePerKilometerMinor);
});

test("distance is zero for identical coordinates", () => {
  const location = { latitude: 31.9038, longitude: 35.2034 };
  assert.equal(calculateDistanceMeters(location, location), 0);
});

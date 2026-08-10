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

test("the minimum delivery fee funds the intended driver and partner shares", () => {
  // At the minimum distance the fee is 10.00 ILS: the driver's 70% share is 7.00 and the
  // remaining 3.00 divides into exactly 1.00 for each of the three delivery-fee partners.
  assert.equal(defaultDeliveryPricing.minimumFeeMinor, 1_000);

  const driverShareMinor = defaultDeliveryPricing.minimumFeeMinor * 0.7;
  assert.equal(driverShareMinor, 700);

  const remainderMinor = defaultDeliveryPricing.minimumFeeMinor - driverShareMinor;
  assert.equal(remainderMinor, 300);
  assert.equal(remainderMinor % 3, 0);
  assert.equal(remainderMinor / 3, 100);
});

test("a 70% driver share never exceeds the fee collected at any distance in range", () => {
  // The flat-amount alternative went negative at short distances; a percentage cannot.
  for (let distance = 0; distance <= defaultDeliveryPricing.maximumDistanceMeters; distance += 500) {
    const { deliveryFeeMinor } = calculateOrderFees(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0 },
      { ...defaultDeliveryPricing, includedDistanceMeters: 0 }
    );
    const feeAtDistance = deliveryFeeMinor + Math.ceil(distance / 1_000) * defaultDeliveryPricing.ratePerKilometerMinor;
    const driverShare = Math.round(feeAtDistance * 0.7);
    assert.ok(driverShare < feeAtDistance, `driver share ${driverShare} must stay under fee ${feeAtDistance}`);
    assert.ok(feeAtDistance - driverShare > 0);
  }
});

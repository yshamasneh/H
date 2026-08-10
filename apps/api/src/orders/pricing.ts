export type Coordinates = { latitude: number; longitude: number };

export type DeliveryPricingConfig = {
  minimumFeeMinor: number;
  includedDistanceMeters: number;
  ratePerKilometerMinor: number;
  maximumDistanceMeters: number;
  serviceFeeMinor: number;
};

export type OrderFees = {
  deliveryDistanceMeters: number;
  deliveryFeeMinor: number;
  serviceFeeMinor: number;
};

const earthRadiusMeters = 6_371_000;

export const defaultDeliveryPricing: DeliveryPricingConfig = {
  // 10.00 ILS covers the intended driver economics: at the minimum distance the driver's 70%
  // share is 7.00 and the remaining 3.00 splits one shekel each three ways.
  minimumFeeMinor: 1_000,
  includedDistanceMeters: 3_000,
  ratePerKilometerMinor: 150,
  maximumDistanceMeters: 25_000,
  serviceFeeMinor: 200
};

export function calculateDistanceMeters(origin: Coordinates, destination: Coordinates): number {
  const latitudeDelta = degreesToRadians(destination.latitude - origin.latitude);
  const longitudeDelta = degreesToRadians(destination.longitude - origin.longitude);
  const originLatitude = degreesToRadians(origin.latitude);
  const destinationLatitude = degreesToRadians(destination.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitude) * Math.cos(destinationLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine)));
}

export function calculateOrderFees(
  origin: Coordinates,
  destination: Coordinates,
  config: DeliveryPricingConfig = defaultDeliveryPricing
): OrderFees {
  const deliveryDistanceMeters = calculateDistanceMeters(origin, destination);
  const additionalMeters = Math.max(0, deliveryDistanceMeters - config.includedDistanceMeters);
  const additionalKilometers = Math.ceil(additionalMeters / 1_000);
  return {
    deliveryDistanceMeters,
    deliveryFeeMinor: config.minimumFeeMinor + additionalKilometers * config.ratePerKilometerMinor,
    serviceFeeMinor: config.serviceFeeMinor
  };
}

function degreesToRadians(value: number): number {
  return value * Math.PI / 180;
}

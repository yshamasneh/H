/**
 * Placeholder fee calculation. Real pricing (distance-based delivery fees, promos,
 * restaurant-specific service fees, etc.) is out of scope for this phase; this
 * function is the single point to swap in a real rules engine later without
 * touching order-creation logic.
 */
const FLAT_DELIVERY_FEE_MINOR = 500;
const FLAT_SERVICE_FEE_MINOR = 200;

export type OrderFees = {
  deliveryFeeMinor: number;
  serviceFeeMinor: number;
};

export function calculateOrderFees(_subtotalMinor: number): OrderFees {
  return {
    deliveryFeeMinor: FLAT_DELIVERY_FEE_MINOR,
    serviceFeeMinor: FLAT_SERVICE_FEE_MINOR
  };
}

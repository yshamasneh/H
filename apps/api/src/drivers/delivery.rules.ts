import { DeliveryFailureReason, DeliveryFaultParty, DeliveryStatus, OrderStatus } from "../generated/prisma/client";
import type { DriverDeliveryStatusAction } from "./drivers.dto";

export const deliveryStatusTransitions: Record<DriverDeliveryStatusAction, DeliveryStatus> = {
  PICKED_UP: DeliveryStatus.PICKED_UP,
  ON_THE_WAY: DeliveryStatus.ON_THE_WAY,
  DELIVERED: DeliveryStatus.DELIVERED,
  FAILED: DeliveryStatus.FAILED
};

export const allowedDeliveryTransitions: Record<DeliveryStatus, DeliveryStatus[]> = {
  [DeliveryStatus.PENDING_ASSIGNMENT]: [DeliveryStatus.CANCELLED],
  [DeliveryStatus.ASSIGNED]: [DeliveryStatus.PICKED_UP, DeliveryStatus.FAILED, DeliveryStatus.CANCELLED],
  [DeliveryStatus.PICKED_UP]: [DeliveryStatus.ON_THE_WAY, DeliveryStatus.FAILED, DeliveryStatus.CANCELLED],
  [DeliveryStatus.ON_THE_WAY]: [DeliveryStatus.DELIVERED, DeliveryStatus.FAILED, DeliveryStatus.CANCELLED],
  [DeliveryStatus.DELIVERED]: [],
  [DeliveryStatus.CANCELLED]: [],
  [DeliveryStatus.FAILED]: []
};

/**
 * A driver may only move a delivery while its order is still awaiting handover. Without this a
 * cancelled order's delivery stays actionable and the driver can walk it to DELIVERED, resurrecting
 * an order that was already cancelled — and, once financial records exist, collecting cash that no
 * entitlement row explains.
 */
export const orderStatusesAllowingDeliveryProgress: OrderStatus[] = [OrderStatus.READY_FOR_PICKUP];

/** Delivery states that no longer represent an active courier task. */
export const terminalDeliveryStatuses: DeliveryStatus[] = [
  DeliveryStatus.DELIVERED,
  DeliveryStatus.CANCELLED,
  DeliveryStatus.FAILED
];

/** Delivery states a driver is still committed to — one at a time, so a driver cannot hoard jobs. */
export const activeDeliveryStatuses: DeliveryStatus[] = [
  DeliveryStatus.ASSIGNED,
  DeliveryStatus.PICKED_UP,
  DeliveryStatus.ON_THE_WAY
];

/**
 * The driver's share of a delivery's fee, per the resolved revenue model: a percentage, not a flat
 * amount. A flat amount breaks at the minimum fee (it can exceed the whole fee collected), so the
 * payout scales with `deliveryFeeMinor` (see orders/pricing.ts) instead of staying fixed.
 *
 * TODO(revenue-model): the remaining 30% (delivery-ops partner / owner A / owner B, three-way
 * split) is not computed anywhere yet — only the driver's own share exists so far.
 */
export const driverSharePercent = 0.7;

/** The driver's payout for one delivery, in minor units, given that order's actual delivery fee. */
export function calculateDriverShareMinor(deliveryFeeMinor: number): number {
  return Math.round(deliveryFeeMinor * driverSharePercent);
}

/**
 * The default party a failure is attributed to, applied once and stored on the delivery.
 *
 * This is a starting attribution, not a liability policy: it decides what the record says, and a
 * later phase decides what the record costs. Driver-related failures deliberately resolve to
 * UNDETERMINED so nothing is charged to a driver without a human looking at it.
 */
export const defaultFaultParty: Record<DeliveryFailureReason, DeliveryFaultParty> = {
  [DeliveryFailureReason.CUSTOMER_REFUSED]: DeliveryFaultParty.CUSTOMER,
  [DeliveryFailureReason.CUSTOMER_UNREACHABLE]: DeliveryFaultParty.CUSTOMER,
  [DeliveryFailureReason.WRONG_ADDRESS]: DeliveryFaultParty.CUSTOMER,
  [DeliveryFailureReason.BUSINESS_ERROR]: DeliveryFaultParty.BUSINESS,
  [DeliveryFailureReason.DRIVER_ISSUE]: DeliveryFaultParty.UNDETERMINED,
  [DeliveryFailureReason.OTHER]: DeliveryFaultParty.UNDETERMINED
};

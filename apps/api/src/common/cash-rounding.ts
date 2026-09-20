/**
 * Cash is settled in whole shekels.
 *
 * There is no card payment, so a driver making change in agorot leads to disputes about who owes
 * whom two agorot. The amount actually asked of the customer, and therefore held by the driver, is
 * the order total rounded UP to the next whole shekel (23.40 becomes 24.00; 24.00 stays 24.00).
 *
 * This changes only what is *collected*. The order's own total, subtotal, fees, discounts and every
 * split derived from them stay exact to the agora. The difference between the two is recorded as
 * its own ledger entry (see EarningComponent.CASH_ROUNDING) so nothing about it is implicit.
 */
export const cashRoundingUnitMinor = 100;

/** The cash due at the door for an order total, in minor units: rounded up to a whole shekel. */
export function roundCashUpMinor(totalMinor: number): number {
  if (!Number.isInteger(totalMinor)) {
    throw new Error(`Cash amounts are whole minor units; received ${totalMinor}`);
  }
  if (totalMinor <= 0) return 0;
  return Math.ceil(totalMinor / cashRoundingUnitMinor) * cashRoundingUnitMinor;
}

/** What rounding added on top of the exact total, in minor units: always 0 to 99. */
export function cashRoundingMinor(totalMinor: number): number {
  return roundCashUpMinor(totalMinor) - Math.max(0, totalMinor);
}

/** Both figures a view needs, so no caller re-derives one from the other. */
export function cashDue(totalMinor: number): { cashDueMinor: number; cashRoundingMinor: number } {
  const cashDueMinor = roundCashUpMinor(totalMinor);
  return { cashDueMinor, cashRoundingMinor: cashDueMinor - Math.max(0, totalMinor) };
}

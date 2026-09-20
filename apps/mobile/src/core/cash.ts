/**
 * Cash is collected rounded UP to a whole shekel, and the server says how much (cashDueMinor). The phone
 * never works this out for itself: it displays the server's figure. An API older than cash rounding sends
 * no cashDueMinor, in which case the exact total is the amount due, exactly as before.
 */
export type CashDueFields = { totalMinor: number; cashDueMinor?: number; cashRoundingMinor?: number };

export function cashDueMinorOf(order: CashDueFields): number {
  return order.cashDueMinor ?? order.totalMinor;
}

/** The rounding included in the cash due, 0 when there is none. */
export function cashRoundingMinorOf(order: CashDueFields): number {
  return order.cashRoundingMinor ?? cashDueMinorOf(order) - order.totalMinor;
}

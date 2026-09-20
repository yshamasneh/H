import type { OrderFinancialOutcome } from "../generated/prisma/enums";
import type { DriverCashPeriod } from "./drivers.types";

/**
 * Period boundaries for the driver's cash screen.
 *
 * There is no shift record in the schema, and inventing one would create a second source of truth
 * for something the ledger already answers. For a courier who carries cash, a shift ends when they
 * hand it over, so "SHIFT" means "since the last handover" — the natural operational unit — and the
 * calendar periods are there for looking back. Calendar boundaries use the server's local clock,
 * which the runtime image pins to Asia/Hebron, the same clock store opening hours are read on.
 */
export function resolvePeriodStart(
  period: DriverCashPeriod,
  now: Date,
  lastHandoverAt: Date | null
): Date | null {
  switch (period) {
    case "SHIFT":
      return lastHandoverAt;
    case "TODAY":
      return startOfDay(now);
    case "WEEK": {
      // The week starts on Saturday, which is how the local working week runs.
      const start = startOfDay(now);
      start.setDate(start.getDate() - ((start.getDay() + 1) % 7));
      return start;
    }
    case "MONTH":
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case "ALL":
      return null;
  }
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export type CustodyFact = {
  orderId: string;
  collectedAmountMinor: number;
  settledAmountMinor: number;
  collectedAt: Date;
};

export type EarningFact = {
  orderId: string | null;
  amountMinor: number;
  occurredAt: Date;
};

export type OrderFact = {
  restaurantName: string;
  deliveryLabel: string;
  outcome: OrderFinancialOutcome | null;
};

export type CashLine = {
  orderId: string;
  restaurantName: string | null;
  deliveryLabel: string | null;
  outcome: OrderFinancialOutcome | null;
  occurredAt: Date;
  /** What the driver took from the customer for this order. Zero on a failed delivery. */
  cashCollectedMinor: number;
  /** How much of that has already been handed back. */
  cashHandedOverMinor: number;
  /** What is still to be handed over for this order. */
  cashOwedToPlatformMinor: number;
  /** The driver's own delivery-fee share for this order, paid separately from the cash. */
  earningMinor: number;
};

/**
 * Joins the ledger's custody rows and earning rows into one line per order.
 *
 * Nothing here is calculated: every figure is a value already written by the accounting layer at
 * the moment the order reached its outcome. This only lines the two ledgers up by order so the
 * driver can see which orders make up each total, and it keeps them in separate fields so cash and
 * pay can never be read as one number.
 */
export function buildCashLines(
  custody: CustodyFact[],
  earnings: EarningFact[],
  orders: Map<string, OrderFact>
): CashLine[] {
  const lines = new Map<string, CashLine>();
  const line = (orderId: string, at: Date): CashLine => {
    let existing = lines.get(orderId);
    if (!existing) {
      const order = orders.get(orderId);
      existing = {
        orderId,
        restaurantName: order?.restaurantName ?? null,
        deliveryLabel: order?.deliveryLabel ?? null,
        outcome: order?.outcome ?? null,
        occurredAt: at,
        cashCollectedMinor: 0,
        cashHandedOverMinor: 0,
        cashOwedToPlatformMinor: 0,
        earningMinor: 0
      };
      lines.set(orderId, existing);
    }
    return existing;
  };

  for (const row of custody) {
    const entry = line(row.orderId, row.collectedAt);
    entry.cashCollectedMinor += row.collectedAmountMinor;
    entry.cashHandedOverMinor += row.settledAmountMinor;
    entry.cashOwedToPlatformMinor += row.collectedAmountMinor - row.settledAmountMinor;
  }
  for (const row of earnings) {
    if (!row.orderId) continue;
    line(row.orderId, row.occurredAt).earningMinor += row.amountMinor;
  }
  return [...lines.values()].sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime());
}

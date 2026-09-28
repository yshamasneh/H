/**
 * Receiving a driver's cash on the phone — the mobile twin of apps/admin/src/cash-handover.ts and the
 * money parser in apps/admin/src/money.ts, kept identical in behaviour so a handover recorded from
 * either console means the same thing. Amounts are integer agorot; nothing here rounds.
 */

export type CustodyLineLike = { custodyId: string; outstandingMinor: number };

/** What the receiver should be holding: the driver's whole balance, or just the ticked orders. */
export function expectedHandoverMinor(
  driverOutstandingMinor: number,
  lines: CustodyLineLike[],
  selected: ReadonlySet<string>
): number {
  if (selected.size === 0) return driverOutstandingMinor;
  return lines.filter((line) => selected.has(line.custodyId)).reduce((sum, line) => sum + line.outstandingMinor, 0);
}

/** counted - expected: negative is short, positive is over, zero matches. Null until a count is typed. */
export function handoverDifferenceMinor(countedMinor: number | null, expectedMinor: number): number | null {
  return countedMinor === null ? null : countedMinor - expectedMinor;
}

/** Whole days the oldest cash has been with the driver (0 = collected today or not at all). */
export function carryingDays(oldestOutstandingAt: string | null, now: Date): number {
  if (!oldestOutstandingAt) return 0;
  const elapsed = now.getTime() - new Date(oldestOutstandingAt).getTime();
  return elapsed <= 0 ? 0 : Math.floor(elapsed / 86_400_000);
}

/** Cash held longer than this is flagged so it is chased first. */
export const overdueCarryingDays = 2;

// The exact money parser and formatter now live in core/money.ts so the offers screens share them.
export { formatMinorPlain, parseMoneyToMinor } from "../../core/money";

/**
 * The idempotency reference for one handover form: stable for the life of the form, so a retry after
 * a dropped connection re-sends it and the server refuses the duplicate instead of recording twice.
 */
export function suggestReference(prefix: string, date: Date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${day}-${random}`;
}

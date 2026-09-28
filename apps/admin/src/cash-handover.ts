/**
 * The arithmetic behind a driver's cash handover, shared by the form and its receipt so both say
 * the same thing. Amounts are agorot; nothing here rounds.
 *
 * The meaning is the server's (see AccountingService.recordCashSettlement): with no orders ticked
 * the handover settles oldest-first up to the counted amount; with orders ticked it settles those.
 * This only works out what the receiver should expect to be holding.
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

/** Cash held longer than this is flagged in the list so it is chased first. */
export const overdueCarryingDays = 2;

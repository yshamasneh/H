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

const arabicIndicZero = 0x0660;
const easternArabicIndicZero = 0x06f0;

/**
 * A typed amount ("12.5", "١٢٫٥٠") as agorot, or null. Parsed digit by digit, never via
 * `Number(text) * 100` (1.15 * 100 is 114.99999…). Anything ambiguous is refused, not guessed.
 */
export function parseMoneyToMinor(input: string): number | null {
  let text = "";
  for (const char of input.trim()) {
    const code = char.codePointAt(0)!;
    if (code >= arabicIndicZero && code <= arabicIndicZero + 9) text += String(code - arabicIndicZero);
    else if (code >= easternArabicIndicZero && code <= easternArabicIndicZero + 9) text += String(code - easternArabicIndicZero);
    else if (char === "٫" || char === ",") text += ".";
    else if (/\s/.test(char)) continue;
    else text += char;
  }
  const match = /^(\d*)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const [, whole = "", fraction = ""] = match;
  if (whole === "" && fraction === "") return null;
  if (fraction.length > 2) return null;
  const scaled = Number(`${whole || "0"}${fraction.padEnd(2, "0")}`);
  return Number.isSafeInteger(scaled) ? scaled : null;
}

/** Agorot as a plain editable amount: 32050 -> "320.50". */
export function formatMinorPlain(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const absolute = Math.abs(minor);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

/**
 * The idempotency reference for one handover form: stable for the life of the form, so a retry after
 * a dropped connection re-sends it and the server refuses the duplicate instead of recording twice.
 */
export function suggestReference(prefix: string, date: Date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${day}-${random}`;
}

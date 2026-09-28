/**
 * Display rules for the analytics screen. Pure, so each can be tested without a browser.
 * Every conversion is integer arithmetic: nothing here divides money or quantities as floats.
 */

export const analyticsTimeZone = "Asia/Hebron";

export const periodPresets = ["all", "today", "last7", "last30", "thisMonth", "custom"] as const;
export type PeriodPreset = (typeof periodPresets)[number];

export type LocalDate = { year: number; month: number; day: number };

/** Today's calendar date in Hebron, whatever time zone the browser is in. */
export function hebronToday(now: Date): LocalDate {
  const parts: Record<string, string> = {};
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: analyticsTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  for (const part of formatter.formatToParts(now)) parts[part.type] = part.value;
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

export function formatLocalDate(date: LocalDate): string {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

function addDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** The API's day range for a preset. "last7" is today and the six days before it. */
export function presetRange(preset: Exclude<PeriodPreset, "custom">, now: Date): { fromDate?: string; toDate?: string } {
  const today = hebronToday(now);
  switch (preset) {
    case "all":
      return {};
    case "today":
      return { fromDate: formatLocalDate(today), toDate: formatLocalDate(today) };
    case "last7":
      return { fromDate: formatLocalDate(addDays(today, -6)), toDate: formatLocalDate(today) };
    case "last30":
      return { fromDate: formatLocalDate(addDays(today, -29)), toDate: formatLocalDate(today) };
    case "thisMonth":
      return { fromDate: formatLocalDate({ ...today, day: 1 }), toDate: formatLocalDate(today) };
  }
}

/** Thousandths of a unit as a plain number: 3000 -> "3", 1250 -> "1.25", 5 -> "0.005". */
export function formatQuantityMilli(milli: number): string {
  const sign = milli < 0 ? "-" : "";
  const absolute = Math.abs(milli);
  const whole = Math.floor(absolute / 1000);
  const fraction = String(absolute % 1000).padStart(3, "0").replace(/0+$/, "");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** Basis points as a percentage with two decimals: 6667 -> "66.67%". */
export function formatRateBp(bp: number): string {
  return `${Math.floor(bp / 100)}.${String(bp % 100).padStart(2, "0")}%`;
}

/** Weekdays in the order an Arabic-speaking week is read: Saturday first. 0 = Sunday. */
export const weekdayDisplayOrder = [6, 0, 1, 2, 3, 4, 5];

/**
 * A count's step on a five-step sequential scale (0 = none, 1-4 = light to dark), relative to the
 * busiest cell. Zero always maps to step 0, and any non-zero count to at least step 1, so an hour
 * with one order is never drawn as empty.
 */
export function heatStep(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count * 4) / max))) as 1 | 2 | 3 | 4;
}

/** A bar's length as a whole-number percent of the longest one (0 for an empty chart). */
export function barPercent(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.max(1, Math.round((value * 100) / max));
}

/** The busiest entries, for the one-line summary above a chart; ties are all named. */
export function busiest<T extends { orders: number }>(rows: T[]): T[] {
  const max = Math.max(0, ...rows.map((row) => row.orders));
  return max === 0 ? [] : rows.filter((row) => row.orders === max);
}

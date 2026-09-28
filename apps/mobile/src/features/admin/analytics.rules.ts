/**
 * Display rules for the admin analytics screen — the mobile twin of apps/admin/src/analytics-view.ts,
 * kept identical in behaviour so both consoles show the same numbers the same way. Integer
 * arithmetic only: nothing here divides money or quantities as floats.
 */

export const analyticsTimeZone = "Asia/Hebron";

export const periodPresets = ["all", "today", "last7", "last30", "thisMonth", "custom"] as const;
export type PeriodPreset = (typeof periodPresets)[number];

export type LocalDate = { year: number; month: number; day: number };

/**
 * Today's calendar date in Hebron, whatever time zone the phone is set to. Falls back to the
 * device's own date only if this JS engine cannot resolve the zone.
 */
export function hebronToday(now: Date): LocalDate {
  try {
    const parts: Record<string, string> = {};
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: analyticsTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    for (const part of formatter.formatToParts(now)) parts[part.type] = part.value;
    const date = { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
    if (Number.isInteger(date.year) && Number.isInteger(date.month) && Number.isInteger(date.day)) return date;
  } catch {
    // fall through
  }
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
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

const arabicIndicZero = 0x0660;
const easternArabicIndicZero = 0x06f0;

/**
 * A typed custom date ("2026-09-28", Arabic-Indic digits accepted) normalised to YYYY-MM-DD, or
 * null while it is not yet a real calendar day. There is no native date picker in the app.
 */
export function normalizeTypedDate(input: string): string | null {
  let latin = "";
  for (const char of input.trim()) {
    const code = char.codePointAt(0)!;
    if (code >= arabicIndicZero && code <= arabicIndicZero + 9) latin += String(code - arabicIndicZero);
    else if (code >= easternArabicIndicZero && code <= easternArabicIndicZero + 9) latin += String(code - easternArabicIndicZero);
    else if (char === "/" || char === ".") latin += "-";
    else latin += char;
  }
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(latin);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return formatLocalDate({ year, month, day });
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

/** A count's step on a five-step single-hue scale; any non-zero count is at least step 1. */
export function heatStep(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count * 4) / max))) as 1 | 2 | 3 | 4;
}

/** A bar's length as a whole-number percent of the longest one; a non-zero value is always visible. */
export function barPercent(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.max(1, Math.round((value * 100) / max));
}

/** The busiest entries; ties are all named, and an empty chart has none. */
export function busiest<T extends { orders: number }>(rows: T[]): T[] {
  const max = Math.max(0, ...rows.map((row) => row.orders));
  return max === 0 ? [] : rows.filter((row) => row.orders === max);
}

export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/**
 * The 24 hourly counts to chart: every day together, or one weekday's row of the weekday x hour
 * grid. This is how the web console's heatmap is shown on a phone — the same grid, one day at a
 * time — so no figure the web shows is missing here.
 */
export function hoursFor(
  peak: { byHour: { hour: number; orders: number }[]; byWeekdayHour: number[][] },
  weekday: number | "all"
): { hour: number; orders: number }[] {
  if (weekday === "all") return peak.byHour;
  return peak.byWeekdayHour[weekday].map((orders, hour) => ({ hour, orders }));
}

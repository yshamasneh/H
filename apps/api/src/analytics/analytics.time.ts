/**
 * Local time for analytics.
 *
 * Orders are stored in UTC. The people reading "busiest hour" and "busiest day" live in Hebron, so
 * every hour and weekday here is Asia/Hebron wall-clock time, daylight saving included: an order at
 * 21:30 UTC on a September Sunday was placed at 00:30 on Monday for the customer, and that is where
 * it has to be counted.
 *
 * The database only groups orders into UTC hour buckets (see AnalyticsService); the buckets are
 * placed onto local hours here. That is exact because Asia/Hebron's offset is always a whole
 * number of hours (+2 or +3) and its clock changes happen on the hour, so one UTC hour is always
 * exactly one local hour. `localHourOf` refuses an instant that is not on the hour so that
 * assumption can never be broken silently.
 */

export const analyticsTimeZone = "Asia/Hebron";

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: analyticsTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  weekday: "short"
});

const weekdayIndex: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday, as in `Date#getDay`. */
  weekday: number;
};

export function localParts(instant: Date): LocalParts {
  const parts: Record<string, string> = {};
  for (const part of partsFormatter.formatToParts(instant)) parts[part.type] = part.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: weekdayIndex[parts.weekday]
  };
}

/** Minutes the local clock is ahead of UTC at this instant (120 in winter, 180 in summer). */
export function offsetMinutesAt(instant: Date): number {
  const local = localParts(instant);
  const asIfUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  const wholeSeconds = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((asIfUtc - wholeSeconds) / 60_000);
}

/** The local hour (0-23) and weekday of a UTC hour bucket. */
export function localHourOf(bucketStart: Date): { hour: number; weekday: number } {
  if (bucketStart.getTime() % 3_600_000 !== 0) {
    throw new Error(`Analytics buckets start on the hour; received ${bucketStart.toISOString()}`);
  }
  const local = localParts(bucketStart);
  if (local.minute !== 0) {
    throw new Error(`${analyticsTimeZone} is not on a whole-hour offset at ${bucketStart.toISOString()}`);
  }
  return { hour: local.hour, weekday: local.weekday };
}

const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar date typed by an operator, "2026-09-28", or null when it is not a real date. */
export function parseLocalDate(value: string): { year: number; month: number; day: number } | null {
  const match = isoDate.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

/**
 * The UTC instant at which a Hebron calendar day begins: local midnight on a normal day, and on a
 * day whose clock change skips midnight, the first instant that exists on that date.
 *
 * Local midnight falls 2 or 3 hours before midnight UTC of the same date, and the zone only ever
 * changes on a whole UTC hour, so the first whole UTC hour from four hours before that whose local
 * date is the requested one is exactly where the day starts.
 */
export function startOfLocalDayUtc(date: { year: number; month: number; day: number }): Date {
  const utcMidnight = Date.UTC(date.year, date.month - 1, date.day);
  for (let hoursBefore = 4; hoursBefore >= 0; hoursBefore -= 1) {
    const candidate = new Date(utcMidnight - hoursBefore * 3_600_000);
    const local = localParts(candidate);
    if (local.year === date.year && local.month === date.month && local.day === date.day) return candidate;
  }
  throw new Error(`Could not place the start of ${date.year}-${date.month}-${date.day} in ${analyticsTimeZone}`);
}

/** The next calendar date after this one. */
export function nextLocalDate(date: { year: number; month: number; day: number }) {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

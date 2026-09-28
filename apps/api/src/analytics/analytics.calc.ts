import { localHourOf } from "./analytics.time";

/** Counts from SQL arrive as bigint; anything past 2^53 cannot be shown exactly and is refused. */
export function exactNumber(value: bigint | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const number = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(number) || (typeof value === "bigint" && BigInt(number) !== value)) {
    throw new Error(`Analytics value ${String(value)} is not an exact integer`);
  }
  return number;
}

export type PeakTimes = {
  totalOrders: number;
  /** 24 entries, local hour 0-23. */
  byHour: { hour: number; orders: number }[];
  /** 7 entries, 0 = Sunday … 6 = Saturday. */
  byWeekday: { weekday: number; orders: number }[];
  /** [weekday][hour] order counts. */
  byWeekdayHour: number[][];
};

/** Places UTC hour buckets (epoch seconds of the bucket start) onto local hours and weekdays. */
export function foldHourBuckets(buckets: { bucketEpochSeconds: number; orders: number }[]): PeakTimes {
  const byWeekdayHour = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  let totalOrders = 0;
  for (const bucket of buckets) {
    const { hour, weekday } = localHourOf(new Date(bucket.bucketEpochSeconds * 1000));
    byWeekdayHour[weekday][hour] += bucket.orders;
    totalOrders += bucket.orders;
  }
  return {
    totalOrders,
    byHour: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      orders: byWeekdayHour.reduce((sum, row) => sum + row[hour], 0)
    })),
    byWeekday: byWeekdayHour.map((row, weekday) => ({ weekday, orders: row.reduce((sum, count) => sum + count, 0) })),
    byWeekdayHour
  };
}

/** part / whole in basis points (10000 = 100%), rounded half up with integers only. 0 when whole is 0. */
export function ratioBp(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.floor((part * 20_000 + whole) / (whole * 2));
}

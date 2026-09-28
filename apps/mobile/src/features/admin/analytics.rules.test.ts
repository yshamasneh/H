import assert from "node:assert/strict";
import { test } from "node:test";
import {
  barPercent,
  busiest,
  formatQuantityMilli,
  formatRateBp,
  heatStep,
  hebronToday,
  hoursFor,
  normalizeTypedDate,
  presetRange,
  weekdayDisplayOrder
} from "./analytics.rules";

test("today is Hebron's date, even when UTC is still on the previous day", () => {
  // 21:30 UTC on Sunday 27 September is 00:30 on Monday 28 in Hebron (UTC+3).
  assert.deepEqual(hebronToday(new Date("2026-09-27T21:30:00Z")), { year: 2026, month: 9, day: 28 });
  assert.deepEqual(hebronToday(new Date("2026-09-27T20:59:00Z")), { year: 2026, month: 9, day: 27 });
  // Winter (UTC+2).
  assert.deepEqual(hebronToday(new Date("2026-01-10T22:15:00Z")), { year: 2026, month: 1, day: 11 });
});

test("period presets are whole Hebron days, identical to the web console's", () => {
  const now = new Date("2026-09-27T21:30:00Z");
  assert.deepEqual(presetRange("all", now), {});
  assert.deepEqual(presetRange("today", now), { fromDate: "2026-09-28", toDate: "2026-09-28" });
  assert.deepEqual(presetRange("last7", now), { fromDate: "2026-09-22", toDate: "2026-09-28" });
  assert.deepEqual(presetRange("last30", now), { fromDate: "2026-08-30", toDate: "2026-09-28" });
  assert.deepEqual(presetRange("thisMonth", now), { fromDate: "2026-09-01", toDate: "2026-09-28" });
});

test("typed custom dates accept Arabic digits and separators, and refuse impossible days", () => {
  assert.equal(normalizeTypedDate("2026-09-28"), "2026-09-28");
  assert.equal(normalizeTypedDate("٢٠٢٦-٠٩-٢٨"), "2026-09-28");
  assert.equal(normalizeTypedDate("2026/9/1"), "2026-09-01");
  assert.equal(normalizeTypedDate("2026-02-30"), null);
  assert.equal(normalizeTypedDate("28-09-2026"), null);
  assert.equal(normalizeTypedDate(""), null);
});

test("quantities and rates are shown exactly from integers", () => {
  assert.equal(formatQuantityMilli(3000), "3");
  assert.equal(formatQuantityMilli(1250), "1.25");
  assert.equal(formatQuantityMilli(5), "0.005");
  assert.equal(formatRateBp(6667), "66.67%");
  assert.equal(formatRateBp(10_000), "100.00%");
  assert.equal(formatRateBp(5), "0.05%");
});

test("scales: the heat step and bar length never hide a non-zero count", () => {
  assert.equal(heatStep(0, 10), 0);
  assert.equal(heatStep(1, 10), 1);
  assert.equal(heatStep(10, 10), 4);
  assert.equal(barPercent(1, 1000), 1);
  assert.equal(barPercent(0, 10), 0);
  assert.equal(barPercent(5, 0), 0);
});

test("busiest names every tie and nothing on an empty chart", () => {
  assert.deepEqual(busiest([{ hour: 0, orders: 2 }, { hour: 12, orders: 2 }, { hour: 1, orders: 1 }]).map((row) => row.hour), [0, 12]);
  assert.deepEqual(busiest([{ hour: 0, orders: 0 }]), []);
});

test("the hour chart shows all days together or one weekday's row of the grid", () => {
  const byWeekdayHour = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  byWeekdayHour[1][0] = 3; // Monday 00:00
  byWeekdayHour[0][23] = 1; // Sunday 23:00
  const byHour = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    orders: byWeekdayHour.reduce((sum, row) => sum + row[hour], 0)
  }));
  const peak = { byHour, byWeekdayHour };
  assert.equal(hoursFor(peak, "all")[0].orders, 3);
  assert.equal(hoursFor(peak, 1)[0].orders, 3);
  assert.equal(hoursFor(peak, 0)[0].orders, 0);
  assert.equal(hoursFor(peak, 0)[23].orders, 1);
  assert.equal(hoursFor(peak, 6).length, 24);
  assert.deepEqual([...weekdayDisplayOrder].sort(), [0, 1, 2, 3, 4, 5, 6]);
});

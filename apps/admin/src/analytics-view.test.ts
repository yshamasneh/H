import assert from "node:assert/strict";
import { test } from "node:test";
import {
  barPercent,
  busiest,
  formatQuantityMilli,
  formatRateBp,
  heatStep,
  hebronToday,
  presetRange,
  weekdayDisplayOrder
} from "./analytics-view";

test("today is Hebron's date, even when UTC is still on the previous day", () => {
  // 21:30 UTC on Sunday 27 September is 00:30 on Monday 28 in Hebron (UTC+3).
  assert.deepEqual(hebronToday(new Date("2026-09-27T21:30:00Z")), { year: 2026, month: 9, day: 28 });
  assert.deepEqual(hebronToday(new Date("2026-09-27T20:59:00Z")), { year: 2026, month: 9, day: 27 });
  // Winter (UTC+2): 22:15 UTC on 10 January is 00:15 on the 11th.
  assert.deepEqual(hebronToday(new Date("2026-01-10T22:15:00Z")), { year: 2026, month: 1, day: 11 });
});

test("period presets are whole Hebron days", () => {
  const now = new Date("2026-09-27T21:30:00Z"); // Monday 28 Sep, 00:30 in Hebron
  assert.deepEqual(presetRange("all", now), {});
  assert.deepEqual(presetRange("today", now), { fromDate: "2026-09-28", toDate: "2026-09-28" });
  assert.deepEqual(presetRange("last7", now), { fromDate: "2026-09-22", toDate: "2026-09-28" });
  assert.deepEqual(presetRange("last30", now), { fromDate: "2026-08-30", toDate: "2026-09-28" });
  assert.deepEqual(presetRange("thisMonth", now), { fromDate: "2026-09-01", toDate: "2026-09-28" });
  assert.deepEqual(presetRange("last7", new Date("2026-03-03T10:00:00Z")), { fromDate: "2026-02-25", toDate: "2026-03-03" });
});

test("quantities are shown exactly from thousandths", () => {
  assert.equal(formatQuantityMilli(3000), "3");
  assert.equal(formatQuantityMilli(1250), "1.25");
  assert.equal(formatQuantityMilli(3250), "3.25");
  assert.equal(formatQuantityMilli(5), "0.005");
  assert.equal(formatQuantityMilli(0), "0");
  assert.equal(formatQuantityMilli(1001), "1.001");
});

test("the returning rate is shown from basis points without rounding again", () => {
  assert.equal(formatRateBp(6667), "66.67%");
  assert.equal(formatRateBp(10_000), "100.00%");
  assert.equal(formatRateBp(0), "0.00%");
  assert.equal(formatRateBp(5), "0.05%");
});

test("the heat scale never draws a non-empty hour as empty", () => {
  assert.equal(heatStep(0, 10), 0);
  assert.equal(heatStep(1, 10), 1);
  assert.equal(heatStep(3, 10), 2);
  assert.equal(heatStep(10, 10), 4);
  assert.equal(heatStep(1, 0), 0);
});

test("bars scale to the longest, and a non-zero value is always visible", () => {
  assert.equal(barPercent(0, 10), 0);
  assert.equal(barPercent(10, 10), 100);
  assert.equal(barPercent(1, 1000), 1);
  assert.equal(barPercent(5, 0), 0);
});

test("the busiest hours are all named when tied, and none on an empty chart", () => {
  assert.deepEqual(busiest([{ hour: 0, orders: 2 }, { hour: 12, orders: 2 }, { hour: 23, orders: 1 }]).map((row) => row.hour), [0, 12]);
  assert.deepEqual(busiest([{ hour: 0, orders: 0 }]), []);
});

test("the week reads Saturday first and covers every day once", () => {
  assert.deepEqual([...weekdayDisplayOrder].sort(), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(weekdayDisplayOrder[0], 6);
});

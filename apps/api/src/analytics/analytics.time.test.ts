import assert from "node:assert/strict";
import { test } from "node:test";
import { exactNumber, foldHourBuckets, ratioBp } from "./analytics.calc";
import { resolvePeriod } from "./analytics.service";
import { localHourOf, offsetMinutesAt, parseLocalDate, startOfLocalDayUtc } from "./analytics.time";

const at = (iso: string) => new Date(iso);
const epoch = (iso: string) => Date.parse(iso) / 1000;
const SUN = 0, MON = 1, FRI = 5, SAT = 6;

test("summer: 21:00 UTC on Sunday is 00:00 Monday in Hebron (UTC+3), not Sunday", () => {
  assert.equal(offsetMinutesAt(at("2026-09-27T21:00:00Z")), 180);
  assert.deepEqual(localHourOf(at("2026-09-27T20:00:00Z")), { hour: 23, weekday: SUN });
  assert.deepEqual(localHourOf(at("2026-09-27T21:00:00Z")), { hour: 0, weekday: MON });
});

test("winter: 22:00 UTC on Saturday is 00:00 Sunday in Hebron (UTC+2)", () => {
  assert.equal(offsetMinutesAt(at("2026-01-10T22:00:00Z")), 120);
  assert.deepEqual(localHourOf(at("2026-01-10T21:00:00Z")), { hour: 23, weekday: SAT });
  assert.deepEqual(localHourOf(at("2026-01-10T22:00:00Z")), { hour: 0, weekday: SUN });
});

test("orders either side of local midnight fall on different local days and hours", () => {
  // 23:30 and 00:30 Hebron time on the night of Sunday 27 → Monday 28 September 2026 (UTC+3):
  // both are on Sunday in UTC (20:30 and 21:30), but not for the customer.
  const peak = foldHourBuckets([
    { bucketEpochSeconds: epoch("2026-09-27T20:00:00Z"), orders: 2 },
    { bucketEpochSeconds: epoch("2026-09-27T21:00:00Z"), orders: 5 }
  ]);
  assert.equal(peak.totalOrders, 7);
  assert.equal(peak.byHour[23].orders, 2);
  assert.equal(peak.byHour[0].orders, 5);
  assert.equal(peak.byWeekday[SUN].orders, 2);
  assert.equal(peak.byWeekday[MON].orders, 5);
  assert.equal(peak.byWeekdayHour[MON][0], 5);
  assert.equal(peak.byHour.length, 24);
  assert.equal(peak.byWeekday.length, 7);
  assert.equal(peak.byHour.reduce((sum, row) => sum + row.orders, 0), 7);
});

test("the spring clock change skips 02:00 and the autumn one repeats 01:00", () => {
  // 2026-03-28: 00:00 UTC is 02:00 local winter time, which becomes 03:00 summer time.
  assert.deepEqual(localHourOf(at("2026-03-27T23:00:00Z")), { hour: 1, weekday: SAT });
  assert.deepEqual(localHourOf(at("2026-03-28T00:00:00Z")), { hour: 3, weekday: SAT });
  // 2026-10-24: 01:00 local happens twice, once at +3 and once at +2.
  assert.deepEqual(localHourOf(at("2026-10-23T22:00:00Z")), { hour: 1, weekday: SAT });
  assert.deepEqual(localHourOf(at("2026-10-23T23:00:00Z")), { hour: 1, weekday: SAT });
  const peak = foldHourBuckets([
    { bucketEpochSeconds: epoch("2026-10-23T22:00:00Z"), orders: 1 },
    { bucketEpochSeconds: epoch("2026-10-23T23:00:00Z"), orders: 1 }
  ]);
  assert.equal(peak.byHour[1].orders, 2, "both real hours count toward 01:00");
});

test("a bucket that is not on the hour is refused rather than mis-placed", () => {
  assert.throws(() => localHourOf(at("2026-09-27T21:30:00Z")));
});

test("a local calendar day starts at Hebron midnight, in UTC", () => {
  assert.equal(startOfLocalDayUtc({ year: 2026, month: 9, day: 28 }).toISOString(), "2026-09-27T21:00:00.000Z");
  assert.equal(startOfLocalDayUtc({ year: 2026, month: 1, day: 11 }).toISOString(), "2026-01-10T22:00:00.000Z");
  // Clock-change days: midnight still exists, at the offset in force before the change.
  assert.equal(startOfLocalDayUtc({ year: 2026, month: 3, day: 28 }).toISOString(), "2026-03-27T22:00:00.000Z");
  assert.equal(startOfLocalDayUtc({ year: 2026, month: 10, day: 24 }).toISOString(), "2026-10-23T21:00:00.000Z");
  assert.equal(startOfLocalDayUtc({ year: 2026, month: 10, day: 25 }).toISOString(), "2026-10-24T22:00:00.000Z");
});

test("a period covers whole local days: from its first midnight to the midnight after its last day", () => {
  const period = resolvePeriod({ fromDate: "2026-09-28", toDate: "2026-09-28" });
  assert.equal(period.from?.toISOString(), "2026-09-27T21:00:00.000Z");
  assert.equal(period.to?.toISOString(), "2026-09-28T21:00:00.000Z");
  assert.equal(period.view.timeZone, "Asia/Hebron");
  // Across the autumn change the day is 25 hours long.
  const long = resolvePeriod({ fromDate: "2026-10-24", toDate: "2026-10-24" });
  assert.equal(long.to!.getTime() - long.from!.getTime(), 25 * 3_600_000);

  const open = resolvePeriod({});
  assert.equal(open.from, null);
  assert.equal(open.to, null);
});

test("impossible dates and backwards periods are refused", () => {
  assert.equal(parseLocalDate("2026-02-30"), null);
  assert.equal(parseLocalDate("28-09-2026"), null);
  assert.throws(() => resolvePeriod({ fromDate: "2026-02-30" }));
  assert.throws(() => resolvePeriod({ fromDate: "2026-09-29", toDate: "2026-09-28" }));
});

test("the returning rate is exact basis points, rounded half up, and 0 with no customers", () => {
  assert.equal(ratioBp(0, 0), 0);
  assert.equal(ratioBp(1, 3), 3333); // 33.333…%
  assert.equal(ratioBp(2, 3), 6667); // 66.666…%
  assert.equal(ratioBp(1, 8), 1250);
  assert.equal(ratioBp(1, 20_000), 1); // 0.005% rounds half up to 0.01%
  assert.equal(ratioBp(5, 5), 10_000);
});

test("SQL bigints become numbers only when exact", () => {
  assert.equal(exactNumber(12345n), 12345);
  assert.equal(exactNumber(null), 0);
  assert.throws(() => exactNumber(2n ** 60n));
});

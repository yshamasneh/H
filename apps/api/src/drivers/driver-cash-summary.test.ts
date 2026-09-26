import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCashLines, resolvePeriodStart, type OrderFact } from "./driver-cash-summary";
import { buildHandoverPeriods } from "./driver-cash-summary";

// Wednesday 2026-09-16, mid-afternoon on the server's local clock.
const now = new Date(2026, 8, 16, 15, 30);

test("SHIFT starts at the last cash handover, and reaches back to the beginning when there has been none", () => {
  const handover = new Date(2026, 8, 15, 21, 5);
  assert.equal(resolvePeriodStart("SHIFT", now, handover), handover);
  assert.equal(resolvePeriodStart("SHIFT", now, null), null);
});

test("TODAY starts at local midnight", () => {
  assert.deepEqual(resolvePeriodStart("TODAY", now, null), new Date(2026, 8, 16));
});

test("WEEK starts on the most recent Saturday, the first day of the local working week", () => {
  // Wed 16 Sep -> Sat 12 Sep.
  assert.deepEqual(resolvePeriodStart("WEEK", now, null), new Date(2026, 8, 12));
  // On a Saturday the week starts that same day; on a Friday it started six days earlier.
  assert.deepEqual(resolvePeriodStart("WEEK", new Date(2026, 8, 12, 9), null), new Date(2026, 8, 12));
  assert.deepEqual(resolvePeriodStart("WEEK", new Date(2026, 8, 18, 23), null), new Date(2026, 8, 12));
  assert.deepEqual(resolvePeriodStart("WEEK", new Date(2026, 8, 19, 0, 1), null), new Date(2026, 8, 19));
});

test("MONTH starts on the 1st and ALL has no lower bound", () => {
  assert.deepEqual(resolvePeriodStart("MONTH", now, null), new Date(2026, 8, 1));
  assert.equal(resolvePeriodStart("ALL", now, new Date(2026, 8, 15)), null);
});

const restaurant = (name: string): OrderFact => ({ restaurantName: name, deliveryLabel: "Home", outcome: "DELIVERED" });

test("cash and pay stay in separate fields on the same order line, never netted", () => {
  const at = new Date(2026, 8, 16, 12);
  const lines = buildCashLines(
    [{ orderId: "o1", collectedAmountMinor: 3200, settledAmountMinor: 0, collectedAt: at }],
    [{ orderId: "o1", amountMinor: 700, occurredAt: at }],
    new Map([["o1", restaurant("Falafel House")]])
  );

  assert.equal(lines.length, 1);
  assert.equal(lines[0].cashCollectedMinor, 3200);
  assert.equal(lines[0].earningMinor, 700);
  assert.equal(lines[0].cashOwedToPlatformMinor, 3200, "the driver's 7.00 is NOT deducted from what is handed over");
});

test("a partly handed-over order shows how much is still owed", () => {
  const at = new Date(2026, 8, 16, 12);
  const [line] = buildCashLines(
    [{ orderId: "o1", collectedAmountMinor: 3200, settledAmountMinor: 2000, collectedAt: at }],
    [],
    new Map([["o1", restaurant("Falafel House")]])
  );
  assert.equal(line.cashHandedOverMinor, 2000);
  assert.equal(line.cashOwedToPlatformMinor, 1200);
});

test("a failed delivery is an earning with no cash", () => {
  const at = new Date(2026, 8, 16, 12);
  const [line] = buildCashLines(
    [],
    [{ orderId: "o2", amountMinor: 700, occurredAt: at }],
    new Map([["o2", { restaurantName: "Falafel House", deliveryLabel: "Home", outcome: "DELIVERY_FAILED" }]])
  );
  assert.equal(line.cashCollectedMinor, 0);
  assert.equal(line.cashOwedToPlatformMinor, 0);
  assert.equal(line.earningMinor, 700);
  assert.equal(line.outcome, "DELIVERY_FAILED");
});

test("an earning that is not tied to an order has no line, and lines are newest first", () => {
  const early = new Date(2026, 8, 16, 9);
  const late = new Date(2026, 8, 16, 18);
  const lines = buildCashLines(
    [
      { orderId: "early", collectedAmountMinor: 1000, settledAmountMinor: 0, collectedAt: early },
      { orderId: "late", collectedAmountMinor: 2000, settledAmountMinor: 0, collectedAt: late }
    ],
    [{ orderId: null, amountMinor: -300, occurredAt: late }],
    new Map()
  );
  assert.deepEqual(lines.map((line) => line.orderId), ["late", "early"]);
});

// --- the driver's History: settled periods between handovers -------------------------------------

const at = (iso: string) => new Date(`2026-09-26T${iso}:00.000Z`);
const handover = (id: string, time: string, orderIds: string[], amount = 1000) => ({
  id,
  settledAt: at(time),
  expectedAmountMinor: amount * orderIds.length,
  countedAmountMinor: amount * orderIds.length,
  discrepancyMinor: 0,
  allocations: orderIds.map((orderId) => ({ amountMinor: amount, orderId }))
});

test("each settled period runs from the previous handover to this one, newest first", () => {
  const periods = buildHandoverPeriods(
    [handover("h2", "16:00", ["o3"]), handover("h1", "12:00", ["o1", "o2"])],
    null,
    [
      { amountMinor: 300, occurredAt: at("09:00") },
      { amountMinor: 300, occurredAt: at("11:59") },
      { amountMinor: 500, occurredAt: at("12:00") }, // exactly at h1: belongs to the NEXT period
      { amountMinor: 700, occurredAt: at("17:00") } // after the newest handover: current period, not history
    ],
    [at("09:00"), at("11:59"), at("12:00"), at("17:00")]
  );

  assert.deepEqual(
    periods.map((period) => [period.settlementId, period.periodStart?.toISOString() ?? null, period.earningsMinor, period.deliveredCount]),
    [
      ["h2", at("12:00").toISOString(), 500, 1],
      ["h1", null, 600, 2]
    ]
  );
  assert.equal(periods[0].cashHandedOverMinor, 1000);
  assert.equal(periods[1].cashHandedOverMinor, 2000);
  assert.equal(periods[1].settledOrderCount, 2);
});

test("a truncated history still gives the oldest period shown its real start", () => {
  const [period] = buildHandoverPeriods([handover("h9", "16:00", ["o9"])], at("10:00"), [
    { amountMinor: 100, occurredAt: at("09:00") },
    { amountMinor: 200, occurredAt: at("11:00") }
  ], []);
  assert.equal(period.periodStart?.toISOString(), at("10:00").toISOString());
  assert.equal(period.earningsMinor, 200);
});

test("a shortfall is reported as recorded, not smoothed over", () => {
  const [period] = buildHandoverPeriods(
    [{ ...handover("h1", "12:00", ["o1"], 3200), countedAmountMinor: 3000, discrepancyMinor: -200 }],
    null,
    [],
    []
  );
  assert.equal(period.expectedAmountMinor, 3200);
  assert.equal(period.countedAmountMinor, 3000);
  assert.equal(period.discrepancyMinor, -200);
});

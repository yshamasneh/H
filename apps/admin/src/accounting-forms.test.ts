import assert from "node:assert/strict";
import test from "node:test";
import {
  adjustmentNetMinor,
  buildAdjustment,
  buildRateSet,
  rateSetToDraft,
  type AdjustmentRowDraft,
  type RateSetFields
} from "./accounting-forms";

const row = (over: Partial<AdjustmentRowDraft> = {}): AdjustmentRowDraft => ({
  kind: "DRIVER",
  partyId: "11111111-1111-4111-8111-111111111111",
  direction: "CHARGE",
  amount: "15",
  ...over
});

const baseInput = {
  reason: "Driver charged after CCTV review",
  note: "",
  orderFinancialRecordId: null,
  confirmUnbalanced: false
};

test("a balanced correction becomes signed entries that net to zero", () => {
  const result = buildAdjustment({
    ...baseInput,
    rows: [
      row({ direction: "CHARGE", amount: "15" }),
      row({ kind: "PARTNER", partyId: "OWNER_A", direction: "CREDIT", amount: "15" })
    ]
  });
  assert.ok(result.ok);
  assert.equal(result.netMinor, 0);
  assert.deepEqual(result.body.entries, [
    { driverUserId: "11111111-1111-4111-8111-111111111111", amountMinor: -1500 },
    { partnerKey: "OWNER_A", amountMinor: 1500 }
  ]);
});

test("each entry names exactly one party, in the field the API expects", () => {
  const result = buildAdjustment({
    ...baseInput,
    rows: [
      row({ kind: "BUSINESS", partyId: "b-1", direction: "CREDIT", amount: "1.15" }),
      row({ kind: "PARTNER", partyId: "DELIVERY_OPS", direction: "CHARGE", amount: "1.15" })
    ]
  });
  assert.ok(result.ok);
  assert.deepEqual(result.body.entries, [
    { businessId: "b-1", amountMinor: 115 },
    { partnerKey: "DELIVERY_OPS", amountMinor: -115 }
  ]);
});

test("an unbalanced correction is refused until the operator confirms it", () => {
  const rows = [row({ direction: "CREDIT", amount: "10" })];
  assert.deepEqual(buildAdjustment({ ...baseInput, rows }), { ok: false, error: "unbalancedNeedsConfirmation" });

  const allowed = buildAdjustment({ ...baseInput, rows, confirmUnbalanced: true });
  assert.ok(allowed.ok);
  assert.equal(allowed.netMinor, 1000);
});

test("rejects missing reason, empty form, missing party, bad amount and a repeated party", () => {
  const ok = [row({ direction: "CHARGE" }), row({ kind: "PARTNER", partyId: "OWNER_B", direction: "CREDIT" })];
  assert.deepEqual(buildAdjustment({ ...baseInput, reason: " a ", rows: ok }), { ok: false, error: "reasonRequired" });
  assert.deepEqual(buildAdjustment({ ...baseInput, rows: [] }), { ok: false, error: "noEntries" });
  assert.deepEqual(buildAdjustment({ ...baseInput, rows: [row({ partyId: "" })] }), {
    ok: false,
    error: "partyRequired",
    row: 0
  });
  for (const amount of ["", "0", "-5", "abc", "1.234"]) {
    assert.deepEqual(
      buildAdjustment({ ...baseInput, rows: [ok[0], row({ kind: "PARTNER", partyId: "OWNER_A", amount })] }),
      { ok: false, error: "invalidAmount", row: 1 }
    );
  }
  assert.deepEqual(buildAdjustment({ ...baseInput, rows: [row(), row({ direction: "CREDIT" })] }), {
    ok: false,
    error: "duplicateParty",
    row: 1
  });
});

test("carries the order record and trimmed note through when given", () => {
  const result = buildAdjustment({
    ...baseInput,
    note: "  see ticket 4411 ",
    orderFinancialRecordId: "rec-1",
    rows: [row({ direction: "CHARGE" }), row({ kind: "PARTNER", partyId: "OWNER_A", direction: "CREDIT" })]
  });
  assert.ok(result.ok);
  assert.equal(result.body.note, "see ticket 4411");
  assert.equal(result.body.orderFinancialRecordId, "rec-1");
});

test("the running net ignores rows that are not yet valid", () => {
  assert.equal(
    adjustmentNetMinor([row({ amount: "10", direction: "CREDIT" }), row({ amount: "", direction: "CHARGE" })]),
    1000
  );
});

// ---- rate sets

const current: RateSetFields = {
  restaurantCommissionBp: 2000,
  promotionalCommissionBp: 1500,
  monthlySubscriptionMinor: 15000,
  commissionOwnerAWeight: 1,
  commissionOwnerBWeight: 1,
  supermarketPartnerMarginBp: 3333,
  ownerAMarginBp: 3333,
  ownerBMarginBp: 3334,
  supermarketPartnerCostBp: 3333,
  ownerACostBp: 3333,
  ownerBCostBp: 3334,
  driverDeliveryShareBp: 7000,
  deliveryOpsRemainderWeight: 1,
  ownerADeliveryRemainderWeight: 1,
  ownerBDeliveryRemainderWeight: 1
};

const errorOf = (result: { ok: boolean }) => (result as { error?: string }).error;

test("a rate-set draft round-trips the set in force with nothing changed", () => {
  const result = buildRateSet(rateSetToDraft(current, "2026-10-01"), current, "2026-01-01T00:00:00.000Z");
  assert.ok(result.ok);
  assert.deepEqual(result.changedKeys, []);
  assert.equal(result.body.effectiveFrom, "2026-10-01T00:00:00.000Z");
});

test("only the fields that changed are sent", () => {
  const draft = {
    ...rateSetToDraft(current, "2026-10-01"),
    restaurantCommission: "18",
    monthlySubscription: "120.50",
    note: " autumn "
  };
  const result = buildRateSet(draft, current);
  assert.ok(result.ok);
  assert.deepEqual(result.body, {
    effectiveFrom: "2026-10-01T00:00:00.000Z",
    note: "autumn",
    restaurantCommissionBp: 1800,
    monthlySubscriptionMinor: 12050
  });
});

test("a margin or cost split that does not total 100% is refused, as the database would", () => {
  const base = rateSetToDraft(current, "2026-10-01");
  assert.deepEqual(buildRateSet({ ...base, ownerAMargin: "34" }, current), {
    ok: false,
    error: "marginSplitTotal",
    field: "supermarketPartnerMargin"
  });
  assert.deepEqual(buildRateSet({ ...base, ownerBCost: "30" }, current), {
    ok: false,
    error: "costSplitTotal",
    field: "supermarketPartnerCost"
  });
  // 33.33 + 33.33 + 33.34 is the accepted "whole pie".
  assert.ok(buildRateSet(base, current).ok);
});

test("refuses bad percentages, amounts, weights and dates", () => {
  const base = rateSetToDraft(current, "2026-10-01");
  assert.equal(errorOf(buildRateSet({ ...base, restaurantCommission: "101" }, current)), "invalidPercent");
  assert.equal(errorOf(buildRateSet({ ...base, driverDeliveryShare: "abc" }, current)), "invalidPercent");
  assert.equal(errorOf(buildRateSet({ ...base, monthlySubscription: "-1" }, current)), "invalidAmount");
  assert.equal(errorOf(buildRateSet({ ...base, ownerADeliveryRemainderWeight: "1.5" }, current)), "invalidWeight");
  assert.equal(errorOf(buildRateSet({ ...base, effectiveFrom: "" }, current)), "invalidDate");
});

test("refuses all-zero weights, which would divide nothing between nobody", () => {
  const base = rateSetToDraft(current, "2026-10-01");
  assert.equal(
    errorOf(buildRateSet({ ...base, commissionOwnerAWeight: "0", commissionOwnerBWeight: "0" }, current)),
    "commissionWeightsZero"
  );
  assert.equal(
    errorOf(
      buildRateSet(
        { ...base, deliveryOpsRemainderWeight: "0", ownerADeliveryRemainderWeight: "0", ownerBDeliveryRemainderWeight: "0" },
        current
      )
    ),
    "deliveryWeightsZero"
  );
});

test("a version dated on or before the one in force is refused: it would never apply", () => {
  const result = buildRateSet(rateSetToDraft(current, "2026-01-01"), current, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(result, { ok: false, error: "notAfterCurrent", field: "effectiveFrom" });
});

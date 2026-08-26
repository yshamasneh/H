import assert from "node:assert/strict";
import { test } from "node:test";
import { computeOrderFinancials, type RateSet } from "./accounting.rules";
import { summariseGoodsCost } from "./order-financials.util";

/**
 * What a supermarket order actually cost, and therefore what its margin really was.
 *
 * An approved fulfillment adjustment supersedes an order line: it names the product that was
 * actually packed and the quantity that was actually weighed, and freezes both the price and the
 * cost of that at proposal time. Valuing the order from the order item instead would follow the
 * substitution on the retail side and not on the cost side — and since variable-weight lines are
 * the normal case at a supermarket, that was wrong on most orders.
 *
 * The damage is invisible to every other check in the system: the order still reconciles to the
 * agora, because the money is all distributed — just in the wrong proportions.
 */

/** The revenue model as agreed: 40/30/30 supermarket margin, 70% driver share. */
const agreedRates: RateSet = {
  id: "rate-set-1",
  version: 1,
  restaurantCommissionBp: 2_000,
  promotionalCommissionBp: 1_500,
  monthlySubscriptionMinor: 15_000,
  commissionOwnerAWeight: 1,
  commissionOwnerBWeight: 1,
  supermarketPartnerMarginBp: 4_000,
  ownerAMarginBp: 3_000,
  ownerBMarginBp: 3_000,
  supermarketPartnerCostBp: 4_000,
  ownerACostBp: 3_000,
  ownerBCostBp: 3_000,
  driverDeliveryShareBp: 7_000,
  deliveryOpsRemainderWeight: 1,
  ownerADeliveryRemainderWeight: 1,
  ownerBDeliveryRemainderWeight: 1
};

const noDiscount = { businessFundedMinor: 0, platformFundedMinor: 0, unattributedMinor: 0 };

// ------------------------------------------------------------------ summariseGoodsCost

test("an unadjusted line costs its frozen unit cost times its quantity", () => {
  const summary = summariseGoodsCost([{ costPriceMinorSnapshot: 900, quantity: 2 }]);
  assert.deepEqual(summary, { totalMinor: 1_800, complete: true });
});

test("a line with no recorded cost is reported as incomplete, never costed at zero", () => {
  const summary = summariseGoodsCost([
    { costPriceMinorSnapshot: 900, quantity: 1 },
    { costPriceMinorSnapshot: null, quantity: 1 }
  ]);
  assert.equal(summary.totalMinor, 900, "the known line still counts");
  assert.equal(summary.complete, false, "and the record says the total is provisional");
});

test("an approved re-weigh costs what was packed, not what was ordered", () => {
  // 1 kg of tomatoes ordered at 9.00/kg cost; 1.3 kg actually packed.
  const summary = summariseGoodsCost([
    {
      costPriceMinorSnapshot: 900,
      quantity: 1,
      fulfillmentAdjustment: { status: "APPROVED", lineCostMinor: 1_170 }
    }
  ]);
  assert.deepEqual(summary, { totalMinor: 1_170, complete: true }, "1.3 kg at 9.00, not 1 kg at 9.00");
});

test("an approved substitution costs the replacement, not the original", () => {
  const summary = summariseGoodsCost([
    {
      costPriceMinorSnapshot: 300,
      quantity: 2,
      fulfillmentAdjustment: { status: "APPROVED", lineCostMinor: 1_100 }
    }
  ]);
  assert.deepEqual(summary, { totalMinor: 1_100, complete: true }, "2 at 5.50, not 2 at 3.00");
});

test("a proposal the customer has not accepted does not move the cost", () => {
  // A PENDING or REJECTED adjustment describes something that did not happen. Only the customer's
  // approval makes it the line that was actually fulfilled.
  for (const status of ["PENDING", "REJECTED"]) {
    const summary = summariseGoodsCost([
      {
        costPriceMinorSnapshot: 900,
        quantity: 1,
        fulfillmentAdjustment: { status, lineCostMinor: 1_170 }
      }
    ]);
    assert.deepEqual(summary, { totalMinor: 900, complete: true }, status);
  }
});

test("an approved adjustment with no cost is incomplete, and does not fall back to the original", () => {
  // Falling back would cost the line at the price of a product that was never delivered, which
  // reads as exact while being simply wrong. Reporting it provisional is the honest answer.
  const summary = summariseGoodsCost([
    {
      costPriceMinorSnapshot: 300,
      quantity: 2,
      fulfillmentAdjustment: { status: "APPROVED", lineCostMinor: null }
    }
  ]);
  assert.deepEqual(summary, { totalMinor: 0, complete: false });
});

// ------------------------------------------------- worked examples, end to end through the split

/** Every party's share of one order, keyed for readable assertions. */
function distribute(itemSubtotalMinor: number, goodsCostMinor: number) {
  const computation = computeOrderFinancials(
    {
      businessId: "jovo-market",
      vertical: "SUPERMARKET",
      outcome: "DELIVERED",
      isPromotionalBusiness: false,
      commissionBp: null,
      itemSubtotalMinor,
      deliveryFeeMinor: 1_000,
      merchandiseDiscount: noDiscount,
      deliveryDiscount: noDiscount,
      goodsCostMinor,
      costDataComplete: true,
      driverUserId: "driver-1",
      faultParty: null,
      orderTotalMinor: itemSubtotalMinor + 1_000
    },
    agreedRates
  );
  const share = (payeeKey: string, component: string) =>
    computation.earnings
      .filter((earning) => keyOf(earning.payee) === payeeKey && earning.component === component)
      .reduce((sum, earning) => sum + earning.amountMinor, 0);

  const supermarket =
    share("BUSINESS:jovo-market", "SUPERMARKET_GOODS_COST") +
    share("BUSINESS:jovo-market", "SUPERMARKET_MARGIN_SHARE");
  return {
    marginMinor: computation.marginMinor,
    supermarket,
    ownerA: share("PARTNER:OWNER_A", "SUPERMARKET_MARGIN_SHARE"),
    ownerB: share("PARTNER:OWNER_B", "SUPERMARKET_MARGIN_SHARE"),
    driver: share("DRIVER:driver-1", "DRIVER_DELIVERY_SHARE"),
    distributed: computation.earnings.reduce((sum, earning) => sum + earning.amountMinor, 0)
  };
}

function keyOf(payee: { type: string; partnerKey?: string; businessId?: string; driverUserId?: string }): string {
  if (payee.type === "PARTNER") return `PARTNER:${payee.partnerKey}`;
  if (payee.type === "BUSINESS") return `BUSINESS:${payee.businessId}`;
  return `DRIVER:${payee.driverUserId}`;
}

test("worked example: 1.3 kg of tomatoes, costed at what was packed", () => {
  // ordered   1 kg   price 12.00   cost  9.00
  // packed  1.3 kg   price 15.60   cost 11.70
  //
  // retail   15.60
  // cost     11.70  -> supermarket partner, in full
  // margin    3.90  -> partner 40% 1.56, owner A 30% 1.17, owner B 30% 1.17
  // delivery 10.00  -> driver 7.00, remainder 3.00 split 1.00 each three ways
  const packed = distribute(1_560, 1_170);

  assert.equal(packed.marginMinor, 390, "15.60 retail less 11.70 cost");
  assert.equal(packed.supermarket, 1_326, "11.70 cost + 1.56 margin share");
  assert.equal(packed.ownerA, 117);
  assert.equal(packed.ownerB, 117);
  assert.equal(packed.driver, 700);
  assert.equal(packed.distributed, 2_560, "15.60 + 10.00 delivery, to the agora");
});

test("worked example: the same line costed at the ordered quantity pays the wrong parties", () => {
  // This is what the code did before the cost snapshot followed the adjustment: the line was
  // priced at the packed 1.3 kg and costed at the ordered 1 kg.
  const priced1300CostedAt1000 = distribute(1_560, 900);
  const correct = distribute(1_560, 1_170);

  assert.equal(priced1300CostedAt1000.marginMinor, 660, "6.60 of margin claimed, against a real 3.90");
  assert.equal(priced1300CostedAt1000.supermarket, 1_164, "9.00 cost + 2.64 margin share");
  assert.equal(priced1300CostedAt1000.ownerA, 198);
  assert.equal(priced1300CostedAt1000.ownerB, 198);

  // The whole error lands on the supermarket, and is split to the two owners.
  assert.equal(correct.supermarket - priced1300CostedAt1000.supermarket, 162, "1.62 short on one line");
  assert.equal(priced1300CostedAt1000.ownerA - correct.ownerA, 81);
  assert.equal(priced1300CostedAt1000.ownerB - correct.ownerB, 81);

  // And this is why nothing caught it: both distributions reconcile exactly.
  assert.equal(priced1300CostedAt1000.distributed, 2_560);
  assert.equal(correct.distributed, 2_560);
});

test("worked example: a 100.00 basket with no cost price at all pays the supermarket 45% of its due", () => {
  // The §4.1 case, stated as arithmetic. 100.00 of groceries costing 80.00, plus 10.00 delivery.
  const withCost = distribute(10_000, 8_000);
  const withoutCost = distribute(10_000, 0);

  assert.equal(withCost.supermarket, 8_800, "80.00 cost + 8.00 margin share");
  assert.equal(withCost.ownerA, 600);
  assert.equal(withCost.ownerB, 600);

  assert.equal(withoutCost.supermarket, 4_000, "the whole 100.00 read as margin, 40% of it");
  assert.equal(withoutCost.ownerA, 3_000);
  assert.equal(withoutCost.ownerB, 3_000);

  assert.equal(
    Math.round((withoutCost.supermarket / withCost.supermarket) * 100),
    45,
    "the supermarket receives 45% of what it is owed"
  );
  assert.equal(withoutCost.ownerA - withCost.ownerA, 2_400, "24.00 overpaid to each owner");

  // Both reconcile. The ledger-imbalance check reads zero either way, which is exactly why this
  // needed a guard at the point of sale rather than a check after the fact.
  assert.equal(withCost.distributed, 11_000);
  assert.equal(withoutCost.distributed, 11_000);
});

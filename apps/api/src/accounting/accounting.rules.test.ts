import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allocateByWeights,
  applyBp,
  computeOperatingCostShares,
  computeOrderFinancials,
  computeSubscriptionEarnings,
  partnerKeys,
  payeeKeyOf,
  resolveCommissionBp,
  resolveLossAbsorber,
  resolveSubscriptionMinor,
  splitDiscountByFunder,
  type ComputedEarning,
  type OrderFinancialInput,
  type RateSet
} from "./accounting.rules";

/**
 * The money tests.
 *
 * These are deliberately written as worked examples with the arithmetic spelled out in the
 * assertions, not as "call the function and compare it to itself". Every total is checked against
 * the cash that was actually collected, because a split that is individually plausible but does
 * not add up is exactly the failure this layer exists to prevent.
 */

/** The revenue model as agreed: 20% commission, 40/30/30, 70% driver share. */
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

function baseOrder(overrides: Partial<OrderFinancialInput> = {}): OrderFinancialInput {
  return {
    businessId: "business-1",
    vertical: "RESTAURANT",
    outcome: "DELIVERED",
    isPromotionalBusiness: false,
    commissionBp: 2_000,
    itemSubtotalMinor: 10_000,
    deliveryFeeMinor: 1_000,
    merchandiseDiscount: { ...noDiscount },
    deliveryDiscount: { ...noDiscount },
    goodsCostMinor: 0,
    costDataComplete: true,
    driverUserId: "driver-1",
    faultParty: null,
    orderTotalMinor: 11_000,
    ...overrides
  };
}

/** Look one entitlement up by who it belongs to and what it is for. */
function amountFor(earnings: ComputedEarning[], payeeKey: string, component: string): number {
  const match = earnings.filter(
    (earning) => payeeKeyOf(earning.payee) === payeeKey && earning.component === component
  );
  assert.ok(match.length <= 1, `${payeeKey}/${component} appears ${match.length} times; it must appear at most once`);
  return match[0]?.amountMinor ?? 0;
}

function totalFor(earnings: ComputedEarning[], payeeKey: string): number {
  return earnings
    .filter((earning) => payeeKeyOf(earning.payee) === payeeKey)
    .reduce((sum, earning) => sum + earning.amountMinor, 0);
}

const ownerA = `PARTNER:${partnerKeys.ownerA}`;
const ownerB = `PARTNER:${partnerKeys.ownerB}`;
const deliveryOps = `PARTNER:${partnerKeys.deliveryOps}`;
const business = "BUSINESS:business-1";
const driver = "DRIVER:driver-1";

// ================================================================================== allocation

test("a split adds back to exactly the amount it divided", () => {
  // 1,001 into three equal parts is the case naive rounding gets wrong: 334 x 3 = 1,002.
  const shares = allocateByWeights(1_001, [1, 1, 1]);
  assert.deepEqual(shares, [334, 334, 333]);
  assert.equal(
    shares.reduce((sum, share) => sum + share, 0),
    1_001
  );
});

test("a split of a negative amount is exact too, and keeps its sign", () => {
  const shares = allocateByWeights(-1_001, [1, 1, 1]);
  assert.deepEqual(shares, [-334, -334, -333]);
  assert.equal(
    shares.reduce((sum, share) => sum + share, 0),
    -1_001
  );
});

test("a split by uneven weights follows the weights", () => {
  assert.deepEqual(allocateByWeights(10_000, [4_000, 3_000, 3_000]), [4_000, 3_000, 3_000]);
  assert.deepEqual(allocateByWeights(101, [4_000, 3_000, 3_000]), [41, 30, 30]);
  assert.equal(allocateByWeights(101, [4_000, 3_000, 3_000]).reduce((a, b) => a + b, 0), 101);
});

test("every amount from 0 to 999 splits three ways without gaining or losing a unit", () => {
  for (let amount = 0; amount < 1_000; amount += 1) {
    const shares = allocateByWeights(amount, [1, 1, 1]);
    assert.equal(shares.reduce((sum, share) => sum + share, 0), amount, `failed at ${amount}`);
  }
});

test("a split refuses inputs it cannot divide honestly", () => {
  assert.throws(() => allocateByWeights(100.5, [1, 1]), /whole minor units/);
  assert.throws(() => allocateByWeights(100, [0, 0]), /more than zero/);
  assert.throws(() => allocateByWeights(100, [-1, 2]), /negative weight/);
});

test("a percentage of an amount is whole minor units", () => {
  assert.equal(applyBp(10_000, 2_000), 2_000);
  assert.equal(applyBp(3_333, 2_000), 667);
  assert.equal(applyBp(1_000, 7_000), 700);
});

// ================================================================== restaurant, worked example

/**
 * WORKED EXAMPLE — RESTAURANT
 *
 * A customer orders 100.00 of food from a standard (non-promotional) restaurant, 4 km away, and
 * pays 12.50 in cash at the door.
 *
 *   items                                    100.00
 *   delivery fee (10.00 min + 1 x 1.50)        2.50    (actually 1,000 + 150 = 11.50 total)
 *   ------------------------------------------------
 *   customer pays                            111.50
 *
 *   commission     20% of 100.00              20.00  -> Mohammad 10.00, Khaldoun 10.00
 *   restaurant     100.00 - 20.00             80.00
 *   driver         70% of 11.50                8.05
 *   remainder      11.50 - 8.05                3.45  -> Abdullah 1.15, Mohammad 1.15, Khaldoun 1.15
 *   ------------------------------------------------
 *   80.00 + 20.00 + 8.05 + 3.45              111.50  = what the customer paid
 */
test("worked example: a standard restaurant order distributes to the shekel", () => {
  const input = baseOrder({
    itemSubtotalMinor: 10_000,
    deliveryFeeMinor: 1_150,
    orderTotalMinor: 11_150
  });
  const result = computeOrderFinancials(input, agreedRates);

  assert.equal(result.commissionMinor, 2_000, "20% of 100.00 is 20.00");
  assert.equal(amountFor(result.earnings, business, "BUSINESS_MERCHANDISE_NET"), 8_000);
  assert.equal(amountFor(result.earnings, ownerA, "PLATFORM_COMMISSION_SHARE"), 1_000);
  assert.equal(amountFor(result.earnings, ownerB, "PLATFORM_COMMISSION_SHARE"), 1_000);

  assert.equal(result.driverShareMinor, 805, "70% of 11.50 is 8.05");
  assert.equal(amountFor(result.earnings, driver, "DRIVER_DELIVERY_SHARE"), 805);
  assert.equal(result.deliveryRemainderMinor, 345);
  assert.equal(amountFor(result.earnings, deliveryOps, "DELIVERY_OPS_SHARE"), 115);
  assert.equal(amountFor(result.earnings, ownerA, "PLATFORM_DELIVERY_SHARE"), 115);
  assert.equal(amountFor(result.earnings, ownerB, "PLATFORM_DELIVERY_SHARE"), 115);

  // Every party's total, and the grand total against what the customer handed over.
  assert.equal(totalFor(result.earnings, business), 8_000);
  assert.equal(totalFor(result.earnings, driver), 805);
  assert.equal(totalFor(result.earnings, deliveryOps), 115);
  assert.equal(totalFor(result.earnings, ownerA), 1_115);
  assert.equal(totalFor(result.earnings, ownerB), 1_115);
  assert.equal(
    result.earnings.reduce((sum, earning) => sum + earning.amountMinor, 0),
    11_150
  );
  assert.equal(result.cashCollectedMinor, 11_150);
});

test("a promotional restaurant is charged the reduced commission", () => {
  const input = baseOrder({
    isPromotionalBusiness: true,
    commissionBp: resolveCommissionBp(agreedRates, true),
    itemSubtotalMinor: 10_000,
    deliveryFeeMinor: 1_000,
    orderTotalMinor: 11_000
  });
  const result = computeOrderFinancials(input, agreedRates);

  assert.equal(result.commissionBp, 1_500);
  assert.equal(result.commissionMinor, 1_500, "15% of 100.00 is 15.00");
  assert.equal(amountFor(result.earnings, business, "BUSINESS_MERCHANDISE_NET"), 8_500);
  assert.equal(amountFor(result.earnings, ownerA, "PLATFORM_COMMISSION_SHARE"), 750);
  assert.equal(amountFor(result.earnings, ownerB, "PLATFORM_COMMISSION_SHARE"), 750);
  assert.equal(result.earnings.reduce((sum, e) => sum + e.amountMinor, 0), 11_000);
});

test("a promotional restaurant is not billed the monthly subscription", () => {
  assert.equal(resolveSubscriptionMinor(agreedRates, false), 15_000);
  assert.equal(resolveSubscriptionMinor(agreedRates, true), 0);
});

test("the commission base excludes the delivery fee and any delivery-fee discount", () => {
  // Same items, a much larger delivery fee, and a delivery-fee promotion on top. The commission
  // must not move a single agora.
  const withoutDelivery = computeOrderFinancials(
    baseOrder({ itemSubtotalMinor: 10_000, deliveryFeeMinor: 1_000, orderTotalMinor: 11_000 }),
    agreedRates
  );
  const withDelivery = computeOrderFinancials(
    baseOrder({
      itemSubtotalMinor: 10_000,
      deliveryFeeMinor: 4_000,
      deliveryDiscount: { businessFundedMinor: 0, platformFundedMinor: 1_000, unattributedMinor: 0 },
      orderTotalMinor: 13_000
    }),
    agreedRates
  );
  assert.equal(withoutDelivery.commissionMinor, 2_000);
  assert.equal(withDelivery.commissionMinor, 2_000);
});

test("a merchandise discount does reduce the commission base", () => {
  const result = computeOrderFinancials(
    baseOrder({
      itemSubtotalMinor: 10_000,
      merchandiseDiscount: { businessFundedMinor: 2_000, platformFundedMinor: 0, unattributedMinor: 0 },
      deliveryFeeMinor: 1_000,
      orderTotalMinor: 9_000
    }),
    agreedRates
  );
  assert.equal(result.netMerchandiseMinor, 8_000);
  assert.equal(result.commissionMinor, 1_600, "20% of 80.00, not of 100.00");
});

test("a business-scoped offer is absorbed by the business, not the platform", () => {
  const result = computeOrderFinancials(
    baseOrder({
      itemSubtotalMinor: 10_000,
      merchandiseDiscount: { businessFundedMinor: 2_000, platformFundedMinor: 0, unattributedMinor: 0 },
      deliveryFeeMinor: 1_000,
      orderTotalMinor: 9_000
    }),
    agreedRates
  );
  // The restaurant carries the whole 20.00: it is paid 100.00 less 16.00 commission less its own
  // 20.00 discount = 64.00. The owners keep the full commission.
  assert.equal(amountFor(result.earnings, business, "BUSINESS_DISCOUNT_ABSORBED"), -2_000);
  assert.equal(totalFor(result.earnings, business), 6_400);
  assert.equal(amountFor(result.earnings, ownerA, "PLATFORM_DISCOUNT_ABSORBED"), 0);
  assert.equal(totalFor(result.earnings, ownerA), 800 + 100);
  assert.equal(result.earnings.reduce((sum, e) => sum + e.amountMinor, 0), 9_000);
});

test("a platform-scoped offer is absorbed by the owners, and the business is made whole", () => {
  const result = computeOrderFinancials(
    baseOrder({
      itemSubtotalMinor: 10_000,
      merchandiseDiscount: { businessFundedMinor: 0, platformFundedMinor: 2_000, unattributedMinor: 0 },
      deliveryFeeMinor: 1_000,
      orderTotalMinor: 9_000
    }),
    agreedRates
  );
  // The restaurant is paid on the full 100.00 less commission — it never funded the promotion.
  assert.equal(totalFor(result.earnings, business), 10_000 - 1_600);
  assert.equal(amountFor(result.earnings, ownerA, "PLATFORM_DISCOUNT_ABSORBED"), -1_000);
  assert.equal(amountFor(result.earnings, ownerB, "PLATFORM_DISCOUNT_ABSORBED"), -1_000);
  assert.equal(result.earnings.reduce((sum, e) => sum + e.amountMinor, 0), 9_000);
});

test("a delivery-fee promotion never comes out of the driver's share", () => {
  const result = computeOrderFinancials(
    baseOrder({
      deliveryFeeMinor: 1_000,
      deliveryDiscount: { businessFundedMinor: 0, platformFundedMinor: 1_000, unattributedMinor: 0 },
      orderTotalMinor: 10_000
    }),
    agreedRates
  );
  assert.equal(amountFor(result.earnings, driver, "DRIVER_DELIVERY_SHARE"), 700, "still 70% of 10.00");
  assert.equal(amountFor(result.earnings, deliveryOps, "DELIVERY_OPS_SHARE"), 100);
  // The owners funded the free delivery, so it comes out of their side.
  assert.equal(amountFor(result.earnings, ownerA, "PLATFORM_DISCOUNT_ABSORBED"), -500);
  assert.equal(result.earnings.reduce((sum, e) => sum + e.amountMinor, 0), 10_000);
});

test("one party's two absorbed discounts merge into a single entitlement row", () => {
  // A business funding both a merchandise and a delivery-fee promotion must produce one row per
  // component, because the ledger's unique index allows exactly one.
  const result = computeOrderFinancials(
    baseOrder({
      itemSubtotalMinor: 10_000,
      merchandiseDiscount: { businessFundedMinor: 1_000, platformFundedMinor: 0, unattributedMinor: 0 },
      deliveryFeeMinor: 1_000,
      deliveryDiscount: { businessFundedMinor: 500, platformFundedMinor: 0, unattributedMinor: 0 },
      orderTotalMinor: 9_500
    }),
    agreedRates
  );
  const absorbed = result.earnings.filter(
    (earning) => payeeKeyOf(earning.payee) === business && earning.component === "BUSINESS_DISCOUNT_ABSORBED"
  );
  assert.equal(absorbed.length, 1);
  assert.equal(absorbed[0]!.amountMinor, -1_500);
});

// ================================================================= supermarket, worked example

/**
 * WORKED EXAMPLE — JOVO MARKET (supermarket)
 *
 * A customer orders groceries retailing at 200.00 that the platform bought for 140.00, 3 km away,
 * and pays 210.00 in cash at the door.
 *
 *   goods at retail                          200.00
 *   delivery fee (minimum)                    10.00
 *   ------------------------------------------------
 *   customer pays                            210.00
 *
 *   cost of goods                            140.00  -> supermarket partner, in full
 *   margin        200.00 - 140.00             60.00  -> partner 40% = 24.00
 *                                                       Mohammad 30% = 18.00
 *                                                       Khaldoun 30% = 18.00
 *   driver        70% of 10.00                 7.00
 *   remainder     10.00 - 7.00                 3.00  -> Abdullah 1.00, Mohammad 1.00, Khaldoun 1.00
 *   ------------------------------------------------
 *   supermarket partner  140.00 + 24.00      164.00
 *   Mohammad             18.00 + 1.00         19.00
 *   Khaldoun             18.00 + 1.00         19.00
 *   Abdullah                                   1.00
 *   driver                                     7.00
 *   ------------------------------------------------
 *   total                                    210.00  = what the customer paid
 */
test("worked example: a JOVO MARKET order distributes to the shekel", () => {
  const input = baseOrder({
    vertical: "SUPERMARKET",
    commissionBp: null,
    itemSubtotalMinor: 20_000,
    goodsCostMinor: 14_000,
    deliveryFeeMinor: 1_000,
    orderTotalMinor: 21_000
  });
  const result = computeOrderFinancials(input, agreedRates);

  assert.equal(result.commissionMinor, 0, "a supermarket order has no commission at all");
  assert.equal(result.marginMinor, 6_000, "200.00 retail less 140.00 cost");

  assert.equal(amountFor(result.earnings, business, "SUPERMARKET_GOODS_COST"), 14_000);
  assert.equal(amountFor(result.earnings, business, "SUPERMARKET_MARGIN_SHARE"), 2_400, "40% of 60.00");
  assert.equal(amountFor(result.earnings, ownerA, "SUPERMARKET_MARGIN_SHARE"), 1_800, "30% of 60.00");
  assert.equal(amountFor(result.earnings, ownerB, "SUPERMARKET_MARGIN_SHARE"), 1_800, "30% of 60.00");

  assert.equal(amountFor(result.earnings, driver, "DRIVER_DELIVERY_SHARE"), 700);
  assert.equal(amountFor(result.earnings, deliveryOps, "DELIVERY_OPS_SHARE"), 100);
  assert.equal(amountFor(result.earnings, ownerA, "PLATFORM_DELIVERY_SHARE"), 100);
  assert.equal(amountFor(result.earnings, ownerB, "PLATFORM_DELIVERY_SHARE"), 100);

  assert.equal(totalFor(result.earnings, business), 16_400, "cost 140.00 plus 40% margin 24.00");
  assert.equal(totalFor(result.earnings, ownerA), 1_900);
  assert.equal(totalFor(result.earnings, ownerB), 1_900);
  assert.equal(totalFor(result.earnings, deliveryOps), 100);
  assert.equal(totalFor(result.earnings, driver), 700);
  assert.equal(
    result.earnings.reduce((sum, earning) => sum + earning.amountMinor, 0),
    21_000
  );
});

test("a supermarket order flags an incomplete cost snapshot rather than pretending to be exact", () => {
  const result = computeOrderFinancials(
    baseOrder({
      vertical: "SUPERMARKET",
      commissionBp: null,
      itemSubtotalMinor: 20_000,
      goodsCostMinor: 9_000,
      costDataComplete: false,
      deliveryFeeMinor: 1_000,
      orderTotalMinor: 21_000
    }),
    agreedRates
  );
  assert.equal(result.costDataComplete, false);
  // It still reconciles: an unknown cost overstates the margin, it never loses money.
  assert.equal(result.earnings.reduce((sum, e) => sum + e.amountMinor, 0), 21_000);
});

test("a supermarket order sold below cost gives every party a negative margin share", () => {
  const result = computeOrderFinancials(
    baseOrder({
      vertical: "SUPERMARKET",
      commissionBp: null,
      itemSubtotalMinor: 10_000,
      goodsCostMinor: 13_000,
      deliveryFeeMinor: 1_000,
      orderTotalMinor: 11_000
    }),
    agreedRates
  );
  assert.equal(result.marginMinor, -3_000);
  assert.equal(amountFor(result.earnings, ownerA, "SUPERMARKET_MARGIN_SHARE"), -900);
  assert.equal(amountFor(result.earnings, ownerB, "SUPERMARKET_MARGIN_SHARE"), -900);
  assert.equal(amountFor(result.earnings, business, "SUPERMARKET_MARGIN_SHARE"), -1_200);
  // Partner still gets the cost of the goods, so nets 130.00 - 12.00 = 118.00.
  assert.equal(totalFor(result.earnings, business), 11_800);
  assert.equal(result.earnings.reduce((sum, e) => sum + e.amountMinor, 0), 11_000);
});

// =============================================================== the two verticals are distinct

test("the two verticals produce structurally different entitlements from identical money", () => {
  const shared = { itemSubtotalMinor: 20_000, deliveryFeeMinor: 1_000, orderTotalMinor: 21_000 };
  const restaurant = computeOrderFinancials(baseOrder({ ...shared }), agreedRates);
  const supermarket = computeOrderFinancials(
    baseOrder({ ...shared, vertical: "SUPERMARKET", commissionBp: null, goodsCostMinor: 14_000 }),
    agreedRates
  );

  assert.ok(restaurant.earnings.some((e) => e.component === "BUSINESS_MERCHANDISE_NET"));
  assert.ok(!restaurant.earnings.some((e) => e.component === "SUPERMARKET_GOODS_COST"));
  assert.ok(supermarket.earnings.some((e) => e.component === "SUPERMARKET_GOODS_COST"));
  assert.ok(!supermarket.earnings.some((e) => e.component === "BUSINESS_MERCHANDISE_NET"));

  // The restaurant keeps 160.00 of a 200.00 order; the supermarket partner keeps 164.00 of it,
  // arrived at by a completely different route.
  assert.equal(totalFor(restaurant.earnings, business), 16_000);
  assert.equal(totalFor(supermarket.earnings, business), 16_400);
});

// ================================================================================ failed delivery

test("a failed delivery collects nothing, and the platform carries it by default", () => {
  const result = computeOrderFinancials(
    baseOrder({
      outcome: "DELIVERY_FAILED",
      faultParty: "CUSTOMER",
      itemSubtotalMinor: 10_000,
      deliveryFeeMinor: 1_000,
      orderTotalMinor: 11_000
    }),
    agreedRates
  );

  assert.equal(result.cashCollectedMinor, 0);
  assert.equal(result.lossAbsorber, "PLATFORM");
  assert.equal(result.absorbedLossMinor, 11_000);

  // The business is still paid for goods that left the premises...
  assert.equal(totalFor(result.earnings, business), 8_000);
  // ...and the driver is still paid for the attempt.
  assert.equal(totalFor(result.earnings, driver), 700);
  // The owners carry the whole uncollected amount, less what they would have earned.
  assert.equal(amountFor(result.earnings, ownerA, "FAILED_DELIVERY_LOSS"), -5_500);
  assert.equal(totalFor(result.earnings, ownerA), 1_000 + 100 - 5_500);
  assert.equal(totalFor(result.earnings, ownerB), 1_000 + 100 - 5_500);
  assert.equal(totalFor(result.earnings, deliveryOps), 100);

  // Nothing was collected, so the entitlements must net to nothing.
  assert.equal(result.earnings.reduce((sum, e) => sum + e.amountMinor, 0), 0);
});

test("a failed delivery caused by the business is carried by the business", () => {
  const result = computeOrderFinancials(
    baseOrder({
      outcome: "DELIVERY_FAILED",
      faultParty: "BUSINESS",
      itemSubtotalMinor: 10_000,
      deliveryFeeMinor: 1_000,
      orderTotalMinor: 11_000
    }),
    agreedRates
  );
  assert.equal(result.lossAbsorber, "BUSINESS");
  assert.equal(amountFor(result.earnings, business, "FAILED_DELIVERY_LOSS"), -11_000);
  assert.equal(totalFor(result.earnings, business), 8_000 - 11_000);
  // The driver and the delivery partners are untouched — they did their job.
  assert.equal(totalFor(result.earnings, driver), 700);
  assert.equal(totalFor(result.earnings, deliveryOps), 100);
  assert.equal(result.earnings.reduce((sum, e) => sum + e.amountMinor, 0), 0);
});

test("liability follows the recorded fault rather than one blanket rule", () => {
  assert.equal(resolveLossAbsorber("CUSTOMER"), "PLATFORM");
  assert.equal(resolveLossAbsorber("BUSINESS"), "BUSINESS");
  assert.equal(resolveLossAbsorber("UNDETERMINED"), "PLATFORM");
  // A driver is never charged automatically: that needs a human and an adjustment.
  assert.equal(resolveLossAbsorber("DRIVER"), "PLATFORM");
  assert.equal(resolveLossAbsorber(null), "PLATFORM");
});

test("a failed supermarket delivery still pays the partner for the goods", () => {
  const result = computeOrderFinancials(
    baseOrder({
      vertical: "SUPERMARKET",
      commissionBp: null,
      outcome: "DELIVERY_FAILED",
      faultParty: "CUSTOMER",
      itemSubtotalMinor: 20_000,
      goodsCostMinor: 14_000,
      deliveryFeeMinor: 1_000,
      orderTotalMinor: 21_000
    }),
    agreedRates
  );
  assert.equal(totalFor(result.earnings, business), 16_400, "cost plus margin share, exactly as if delivered");
  assert.equal(totalFor(result.earnings, driver), 700);
  assert.equal(result.earnings.reduce((sum, e) => sum + e.amountMinor, 0), 0);
});

// ========================================================================= configurable rates

test("changing the driver share moves the remainder without breaking the total", () => {
  const generous: RateSet = { ...agreedRates, driverDeliveryShareBp: 8_000 };
  const result = computeOrderFinancials(
    baseOrder({ itemSubtotalMinor: 10_000, deliveryFeeMinor: 1_000, orderTotalMinor: 11_000 }),
    generous
  );
  assert.equal(amountFor(result.earnings, driver, "DRIVER_DELIVERY_SHARE"), 800);
  // The remaining 2.00 still divides evenly three ways because the weights, not the percentages,
  // define the split.
  assert.equal(amountFor(result.earnings, deliveryOps, "DELIVERY_OPS_SHARE"), 67);
  assert.equal(amountFor(result.earnings, ownerA, "PLATFORM_DELIVERY_SHARE"), 67);
  assert.equal(amountFor(result.earnings, ownerB, "PLATFORM_DELIVERY_SHARE"), 66);
  assert.equal(800 + 67 + 67 + 66, 1_000);
  assert.equal(result.earnings.reduce((sum, e) => sum + e.amountMinor, 0), 11_000);
});

test("changing the margin split changes only the supermarket vertical", () => {
  const evenSplit: RateSet = {
    ...agreedRates,
    supermarketPartnerMarginBp: 3_334,
    ownerAMarginBp: 3_333,
    ownerBMarginBp: 3_333
  };
  const result = computeOrderFinancials(
    baseOrder({
      vertical: "SUPERMARKET",
      commissionBp: null,
      itemSubtotalMinor: 20_000,
      goodsCostMinor: 14_000,
      deliveryFeeMinor: 1_000,
      orderTotalMinor: 21_000
    }),
    evenSplit
  );
  assert.equal(amountFor(result.earnings, business, "SUPERMARKET_MARGIN_SHARE"), 2_000);
  assert.equal(amountFor(result.earnings, ownerA, "SUPERMARKET_MARGIN_SHARE"), 2_000);
  assert.equal(amountFor(result.earnings, ownerB, "SUPERMARKET_MARGIN_SHARE"), 2_000);
  assert.equal(result.earnings.reduce((sum, e) => sum + e.amountMinor, 0), 21_000);
});

test("an uneven commission split follows the weights", () => {
  const uneven: RateSet = { ...agreedRates, commissionOwnerAWeight: 3, commissionOwnerBWeight: 1 };
  const result = computeOrderFinancials(
    baseOrder({ itemSubtotalMinor: 10_000, deliveryFeeMinor: 1_000, orderTotalMinor: 11_000 }),
    uneven
  );
  assert.equal(amountFor(result.earnings, ownerA, "PLATFORM_COMMISSION_SHARE"), 1_500);
  assert.equal(amountFor(result.earnings, ownerB, "PLATFORM_COMMISSION_SHARE"), 500);
});

// ============================================================================ reconciliation

test("a computation that does not reconcile fails loudly rather than writing a wrong ledger", () => {
  assert.throws(
    () =>
      computeOrderFinancials(
        // An order total that does not match its own parts — the shape of a legacy order that
        // still carried the removed service fee.
        baseOrder({ itemSubtotalMinor: 10_000, deliveryFeeMinor: 1_000, orderTotalMinor: 11_200 }),
        agreedRates
      ),
    /do not reconcile/
  );
});

test("a restaurant order without a commission rate is refused", () => {
  assert.throws(() => computeOrderFinancials(baseOrder({ commissionBp: null }), agreedRates), /commission rate/);
});

test("a delivery fee with no driver to pay is refused", () => {
  assert.throws(
    () => computeOrderFinancials(baseOrder({ driverUserId: null }), agreedRates),
    /no driver is recorded/
  );
});

test("awkward amounts still reconcile exactly across both verticals", () => {
  for (const subtotal of [1, 7, 99, 3_333, 10_001, 77_777]) {
    for (const fee of [1_000, 1_150, 1_001, 3_337]) {
      const restaurant = computeOrderFinancials(
        baseOrder({ itemSubtotalMinor: subtotal, deliveryFeeMinor: fee, orderTotalMinor: subtotal + fee }),
        agreedRates
      );
      assert.equal(restaurant.earnings.reduce((sum, e) => sum + e.amountMinor, 0), subtotal + fee);

      const supermarket = computeOrderFinancials(
        baseOrder({
          vertical: "SUPERMARKET",
          commissionBp: null,
          itemSubtotalMinor: subtotal,
          goodsCostMinor: Math.floor(subtotal * 0.7),
          deliveryFeeMinor: fee,
          orderTotalMinor: subtotal + fee
        }),
        agreedRates
      );
      assert.equal(supermarket.earnings.reduce((sum, e) => sum + e.amountMinor, 0), subtotal + fee);
    }
  }
});

// ============================================================================= discount scope

test("a promotion snapshot is split by who funded each offer", () => {
  const split = splitDiscountByFunder(
    [
      { offerId: "a", title: "Business offer", type: "ORDER_PERCENTAGE", discountMinor: 600, scope: "BUSINESS", businessId: "business-1" },
      { offerId: "b", title: "Platform offer", type: "PRODUCT_PERCENTAGE", discountMinor: 400, scope: "PLATFORM", businessId: null },
      { offerId: "c", title: "Free delivery", type: "FREE_DELIVERY", discountMinor: 1_000, scope: "PLATFORM", businessId: null }
    ],
    1_000,
    1_000
  );
  assert.deepEqual(split.merchandise, { businessFundedMinor: 600, platformFundedMinor: 400, unattributedMinor: 0 });
  assert.deepEqual(split.delivery, { businessFundedMinor: 0, platformFundedMinor: 1_000, unattributedMinor: 0 });
});

test("a promotion with no recorded scope is carried by the platform and flagged", () => {
  const split = splitDiscountByFunder(
    [{ offerId: "a", title: "Legacy", type: "ORDER_PERCENTAGE", discountMinor: 500, scope: "UNKNOWN", businessId: null }],
    500,
    0
  );
  assert.equal(split.merchandise.businessFundedMinor, 0, "a business is never billed for a discount nobody can attribute");
  assert.equal(split.merchandise.platformFundedMinor, 500);
  assert.equal(split.merchandise.unattributedMinor, 500);
});

test("a snapshot that disagrees with the order falls to the platform and is flagged", () => {
  // The order recorded 1,000 of merchandise discount; the snapshot only explains 300.
  const split = splitDiscountByFunder(
    [{ offerId: "a", title: "Partial", type: "ORDER_PERCENTAGE", discountMinor: 300, scope: "BUSINESS", businessId: "business-1" }],
    1_000,
    0
  );
  assert.equal(split.merchandise.businessFundedMinor, 300);
  assert.equal(split.merchandise.platformFundedMinor, 700);
  assert.equal(split.merchandise.unattributedMinor, 700);
  assert.equal(split.merchandise.businessFundedMinor + split.merchandise.platformFundedMinor, 1_000);
});

test("an order with no promotions splits to nothing", () => {
  const split = splitDiscountByFunder([], 0, 0);
  assert.deepEqual(split.merchandise, { businessFundedMinor: 0, platformFundedMinor: 0, unattributedMinor: 0 });
  assert.deepEqual(split.delivery, { businessFundedMinor: 0, platformFundedMinor: 0, unattributedMinor: 0 });
});

// ============================================================================= operating costs

/**
 * WORKED EXAMPLE — SUPERMARKET OPERATING COST
 *
 * A month's warehouse rent of 2,500.00 is approved.
 *
 *   supermarket partner  40%    1,000.00
 *   Mohammad             30%      750.00
 *   Khaldoun             30%      750.00
 *   -----------------------------------
 *   total                       2,500.00
 *
 * Each party's cost share equals their profit share here, and the two are configured separately so
 * one can change without the other.
 */
test("worked example: an approved operating cost is charged 40/30/30", () => {
  const shares = computeOperatingCostShares("business-1", 250_000, agreedRates);
  assert.equal(amountFor(shares, business, "OPERATING_COST_SHARE"), -100_000);
  assert.equal(amountFor(shares, ownerA, "OPERATING_COST_SHARE"), -75_000);
  assert.equal(amountFor(shares, ownerB, "OPERATING_COST_SHARE"), -75_000);
  assert.equal(shares.reduce((sum, share) => sum + share.amountMinor, 0), -250_000);
});

test("the cost split is configured apart from the margin split and can differ from it", () => {
  const different: RateSet = {
    ...agreedRates,
    supermarketPartnerCostBp: 5_000,
    ownerACostBp: 2_500,
    ownerBCostBp: 2_500
  };
  const shares = computeOperatingCostShares("business-1", 100_000, different);
  assert.equal(amountFor(shares, business, "OPERATING_COST_SHARE"), -50_000);
  assert.equal(amountFor(shares, ownerA, "OPERATING_COST_SHARE"), -25_000);
  // The margin split is untouched by the same rate set.
  assert.equal(different.supermarketPartnerMarginBp, 4_000);
});

test("an operating cost never reconciles to a positive amount", () => {
  assert.throws(() => computeOperatingCostShares("business-1", 0, agreedRates), /positive amount/);
  assert.throws(() => computeOperatingCostShares("business-1", -100, agreedRates), /positive amount/);
});

test("an awkward operating cost still divides exactly", () => {
  const shares = computeOperatingCostShares("business-1", 1, agreedRates);
  assert.equal(shares.reduce((sum, share) => sum + share.amountMinor, 0), -1);
});

// ============================================================================== subscriptions

test("a subscription charge moves 150.00 from the business to the two owners and nets to nothing", () => {
  const earnings = computeSubscriptionEarnings("business-1", 15_000, agreedRates);
  assert.equal(amountFor(earnings, business, "SUBSCRIPTION_CHARGE"), -15_000);
  assert.equal(amountFor(earnings, ownerA, "SUBSCRIPTION_SHARE"), 7_500);
  assert.equal(amountFor(earnings, ownerB, "SUBSCRIPTION_SHARE"), 7_500);
  assert.equal(earnings.reduce((sum, e) => sum + e.amountMinor, 0), 0, "no cash enters the system");
});

test("a waived subscription produces no ledger rows at all", () => {
  assert.deepEqual(computeSubscriptionEarnings("business-1", 0, agreedRates), []);
});

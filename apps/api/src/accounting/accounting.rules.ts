import type { DeliveryFaultParty, EarningComponent, LossAbsorber } from "../generated/prisma/enums";
import type { AppliedPromotion } from "../offers/offers.types";

/**
 * The money logic, as pure functions.
 *
 * Nothing here touches the database, a clock, or a request. Given an order's numbers and the rates
 * that were in force, it returns exactly what every party is entitled to — which is what makes the
 * arithmetic checkable against a worked example on paper rather than only against a mock.
 *
 * Two rules hold everywhere in this file:
 *
 *  1. **Every distribution reconciles exactly.** Splits are allocated by the largest-remainder
 *     method, never by independent rounding, so three shares of 1,001 come to 334/334/333 and not
 *     to 334/334/334. `assertReconciles` re-checks the result against the cash before it is
 *     returned, so a mistake stops the delivery rather than quietly misstating a balance.
 *  2. **Amounts are signed.** A component that costs a party money is negative, so any party's
 *     balance is a plain SUM over their rows with no special cases.
 */

/** Basis points: 10000 = 100.00%. Percentages are never floats in this system. */
export const oneHundredPercentBp = 10_000;

/** The fixed parties in the revenue model. Keys, not names — the names live in PartnerAccount. */
export const partnerKeys = {
  /** Platform owner A. */
  ownerA: "OWNER_A",
  /** Platform owner B. */
  ownerB: "OWNER_B",
  /** Delivery operations. Takes a share of the delivery fee and nothing else. */
  deliveryOps: "DELIVERY_OPS"
} as const;

export type PartnerKey = (typeof partnerKeys)[keyof typeof partnerKeys];

/** Every configurable rate, as read from one `FinancialRateSet` row. */
export type RateSet = {
  id: string;
  version: number;
  restaurantCommissionBp: number;
  promotionalCommissionBp: number;
  monthlySubscriptionMinor: number;
  commissionOwnerAWeight: number;
  commissionOwnerBWeight: number;
  supermarketPartnerMarginBp: number;
  ownerAMarginBp: number;
  ownerBMarginBp: number;
  supermarketPartnerCostBp: number;
  ownerACostBp: number;
  ownerBCostBp: number;
  driverDeliveryShareBp: number;
  deliveryOpsRemainderWeight: number;
  ownerADeliveryRemainderWeight: number;
  ownerBDeliveryRemainderWeight: number;
};

/** Who a ledger row belongs to. A partner is referenced by key and resolved to an id on write. */
export type EarningPayee =
  | { type: "PARTNER"; partnerKey: PartnerKey }
  | { type: "BUSINESS"; businessId: string }
  | { type: "DRIVER"; driverUserId: string };

export type ComputedEarning = {
  payee: EarningPayee;
  component: EarningComponent;
  amountMinor: number;
};

/** How a discount divides by who funded it. Business-scoped offers are absorbed by the business,
 *  platform-scoped ones by the platform owners. */
export type DiscountFunding = {
  businessFundedMinor: number;
  platformFundedMinor: number;
  /** Part of `platformFundedMinor`. Snapshots written before offer scope existed read back as
   *  UNKNOWN; the platform carries those, because a business must never be charged for a discount
   *  nobody can attribute. Reported so the ambiguity stays visible instead of disappearing. */
  unattributedMinor: number;
};

export type OrderFinancialInput = {
  businessId: string;
  vertical: "RESTAURANT" | "SUPERMARKET";
  outcome: "DELIVERED" | "DELIVERY_FAILED";
  isPromotionalBusiness: boolean;
  /** Frozen when the order was placed. Null for a supermarket order, which has no commission. */
  commissionBp: number | null;
  itemSubtotalMinor: number;
  deliveryFeeMinor: number;
  merchandiseDiscount: DiscountFunding;
  deliveryDiscount: DiscountFunding;
  /** Sum of every line's frozen cost price. Supermarket only; zero elsewhere. */
  goodsCostMinor: number;
  /** False when a line had no cost price recorded, so the margin is provisional. */
  costDataComplete: boolean;
  /** Null when the order never reached a driver. */
  driverUserId: string | null;
  /** Recorded on the delivery in 15.6a. Drives who absorbs a failed delivery. */
  faultParty: DeliveryFaultParty | null;
  /** What the customer was billed, straight from the order. The reconciliation target. */
  orderTotalMinor: number;
};

export type OrderFinancialComputation = {
  vertical: "RESTAURANT" | "SUPERMARKET";
  outcome: "DELIVERED" | "DELIVERY_FAILED";
  commissionBp: number | null;
  commissionMinor: number;
  /** Item subtotal after every merchandise discount. The commission base. */
  netMerchandiseMinor: number;
  goodsCostMinor: number;
  costDataComplete: boolean;
  /** Retail minus cost, before any discount. Supermarket only. */
  marginMinor: number;
  driverShareMinor: number;
  deliveryRemainderMinor: number;
  /** What the driver had to collect at the door. Zero on a failed delivery. */
  cashCollectedMinor: number;
  lossAbsorber: LossAbsorber;
  absorbedLossMinor: number;
  earnings: ComputedEarning[];
};

/**
 * Divide `amountMinor` by `weights` so the parts add back to exactly `amountMinor`.
 *
 * Rounding each share on its own loses or invents units: 1,001 split three ways rounds to
 * 334+334+334 = 1,002. The largest-remainder method gives every party its whole part and then
 * hands the leftover units to whoever was rounded down hardest, so the total is always exact.
 * Ties go to the earlier weight, which makes the result deterministic and therefore testable.
 *
 * Negative amounts (a discount being absorbed, a loss being carried) are allocated on the
 * magnitude and re-signed, so `|sum|` is exact in the same way.
 */
export function allocateByWeights(amountMinor: number, weights: number[]): number[] {
  if (!Number.isInteger(amountMinor)) {
    throw new Error(`allocateByWeights needs whole minor units, received ${amountMinor}`);
  }
  if (weights.length === 0) {
    throw new Error("allocateByWeights needs at least one weight");
  }
  if (weights.some((weight) => weight < 0)) {
    throw new Error("allocateByWeights cannot take a negative weight");
  }
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) {
    throw new Error("allocateByWeights needs the weights to total more than zero");
  }
  if (amountMinor === 0) {
    return weights.map(() => 0);
  }

  const sign = amountMinor < 0 ? -1 : 1;
  const magnitude = Math.abs(amountMinor);
  const exact = weights.map((weight) => (magnitude * weight) / totalWeight);
  const floors = exact.map((value) => Math.floor(value));
  let remaining = magnitude - floors.reduce((sum, value) => sum + value, 0);

  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - floors[index]! }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);

  const shares = [...floors];
  for (const candidate of byRemainder) {
    if (remaining <= 0) break;
    shares[candidate.index]! += 1;
    remaining -= 1;
  }
  return shares.map((share) => share * sign);
}

/** A percentage of an amount, in whole minor units. */
export function applyBp(amountMinor: number, bp: number): number {
  const sign = amountMinor < 0 ? -1 : 1;
  return sign * Math.round((Math.abs(amountMinor) * bp) / oneHundredPercentBp);
}

/** The commission rate a business pays: the reduced rate for a promotional partner, else standard. */
export function resolveCommissionBp(rateSet: RateSet, isPromotionalBusiness: boolean): number {
  return isPromotionalBusiness ? rateSet.promotionalCommissionBp : rateSet.restaurantCommissionBp;
}

/** The monthly subscription a business owes. Promotional partners are not billed at all. */
export function resolveSubscriptionMinor(rateSet: RateSet, isPromotionalBusiness: boolean): number {
  return isPromotionalBusiness ? 0 : rateSet.monthlySubscriptionMinor;
}

/**
 * Who carries a delivery that collected no cash, given the fault recorded on it in 15.6a.
 *
 * A fault attributed to the driver still lands on the platform. Charging a driver for a failed
 * delivery is a decision about a person's pay and belongs to a human making a FinancialAdjustment,
 * not to a default that fires the moment a reason code is picked from a list. Everything else
 * follows the agreed rule: the platform absorbs, except where the business caused it.
 */
export const defaultLossAbsorberByFault: Record<DeliveryFaultParty, LossAbsorber> = {
  CUSTOMER: "PLATFORM",
  BUSINESS: "BUSINESS",
  DRIVER: "PLATFORM",
  UNDETERMINED: "PLATFORM"
};

export function resolveLossAbsorber(faultParty: DeliveryFaultParty | null): LossAbsorber {
  if (!faultParty) return "PLATFORM";
  return defaultLossAbsorberByFault[faultParty];
}

/**
 * Split a promotion snapshot into what the business funded and what the platform funded.
 *
 * The order's own `merchandiseDiscountMinor` and `deliveryDiscountMinor` are authoritative for the
 * totals; the snapshot only decides how each total divides. Anything the snapshot cannot account
 * for — a promotion recorded before scope existed, or a snapshot that does not add up — falls to
 * the platform, and is reported as unattributed rather than absorbed silently.
 */
export function splitDiscountByFunder(
  promotions: AppliedPromotion[],
  merchandiseDiscountMinor: number,
  deliveryDiscountMinor: number
): { merchandise: DiscountFunding; delivery: DiscountFunding } {
  const buckets = {
    merchandise: { businessFundedMinor: 0, platformFundedMinor: 0, unattributedMinor: 0 },
    delivery: { businessFundedMinor: 0, platformFundedMinor: 0, unattributedMinor: 0 }
  };

  for (const promotion of promotions) {
    const bucket = isDeliveryOffer(promotion.type) ? buckets.delivery : buckets.merchandise;
    const amount = Math.max(0, Math.round(promotion.discountMinor));
    if (promotion.scope === "BUSINESS" && promotion.businessId) {
      bucket.businessFundedMinor += amount;
    } else if (promotion.scope === "PLATFORM") {
      bucket.platformFundedMinor += amount;
    } else {
      bucket.platformFundedMinor += amount;
      bucket.unattributedMinor += amount;
    }
  }

  return {
    merchandise: reconcileFunding(buckets.merchandise, merchandiseDiscountMinor),
    delivery: reconcileFunding(buckets.delivery, deliveryDiscountMinor)
  };
}

function isDeliveryOffer(type: AppliedPromotion["type"]): boolean {
  return type === "DELIVERY_PERCENTAGE" || type === "FREE_DELIVERY";
}

/**
 * Force a funding split to add up to the total the order actually recorded.
 *
 * The order row is the fact; the snapshot is a description of it. Where they disagree the
 * difference goes to the platform and is marked unattributed, so the database's
 * "funded parts equal the discount" constraint always holds and the discrepancy stays visible.
 */
function reconcileFunding(bucket: DiscountFunding, totalMinor: number): DiscountFunding {
  const total = Math.max(0, Math.round(totalMinor));
  if (total === 0) {
    return { businessFundedMinor: 0, platformFundedMinor: 0, unattributedMinor: 0 };
  }
  const businessFundedMinor = Math.min(bucket.businessFundedMinor, total);
  const platformFundedMinor = total - businessFundedMinor;
  const explained = bucket.businessFundedMinor + bucket.platformFundedMinor;
  const unexplained = Math.max(0, total - explained);
  return {
    businessFundedMinor,
    platformFundedMinor,
    unattributedMinor: Math.min(platformFundedMinor, bucket.unattributedMinor + unexplained)
  };
}

/**
 * One order's complete distribution.
 *
 * The two verticals are deliberately not forced through a shared formula. A restaurant is paid for
 * its merchandise and the platform takes a commission out of it; a supermarket partner is paid the
 * cost of the goods and then shares the margin. Those are different economics and are written as
 * different code paths — only the delivery fee, which behaves identically either way, is shared.
 */
export function computeOrderFinancials(
  input: OrderFinancialInput,
  rateSet: RateSet
): OrderFinancialComputation {
  const netMerchandiseMinor = input.itemSubtotalMinor - totalDiscount(input.merchandiseDiscount);
  const earnings: ComputedEarning[] = [];

  let commissionMinor = 0;
  let marginMinor = 0;

  if (input.vertical === "RESTAURANT") {
    const commissionBp = input.commissionBp;
    if (commissionBp === null) {
      throw new Error("A restaurant order must carry a commission rate");
    }
    // 20% (15% promotional) of the item subtotal after merchandise discounts. The delivery fee and
    // any delivery-fee discount are excluded from the base entirely.
    commissionMinor = applyBp(netMerchandiseMinor, commissionBp);

    // The business is paid for its goods, less the commission. Discounts it funded itself come off
    // separately below, so the two effects stay readable on the balance rather than netted away.
    earnings.push({
      payee: { type: "BUSINESS", businessId: input.businessId },
      component: "BUSINESS_MERCHANDISE_NET",
      amountMinor: input.itemSubtotalMinor - commissionMinor
    });

    const commissionShares = allocateByWeights(commissionMinor, [
      rateSet.commissionOwnerAWeight,
      rateSet.commissionOwnerBWeight
    ]);
    earnings.push(
      partnerEarning(partnerKeys.ownerA, "PLATFORM_COMMISSION_SHARE", commissionShares[0]!),
      partnerEarning(partnerKeys.ownerB, "PLATFORM_COMMISSION_SHARE", commissionShares[1]!)
    );
  } else {
    // The platform bought at cost and sold at retail. The partner is owed the cost of the goods
    // outright, and the margin on top divides three ways.
    marginMinor = input.itemSubtotalMinor - input.goodsCostMinor;

    earnings.push({
      payee: { type: "BUSINESS", businessId: input.businessId },
      component: "SUPERMARKET_GOODS_COST",
      amountMinor: input.goodsCostMinor
    });

    const marginShares = allocateByWeights(marginMinor, [
      rateSet.supermarketPartnerMarginBp,
      rateSet.ownerAMarginBp,
      rateSet.ownerBMarginBp
    ]);
    earnings.push(
      {
        payee: { type: "BUSINESS", businessId: input.businessId },
        component: "SUPERMARKET_MARGIN_SHARE",
        amountMinor: marginShares[0]!
      },
      partnerEarning(partnerKeys.ownerA, "SUPERMARKET_MARGIN_SHARE", marginShares[1]!),
      partnerEarning(partnerKeys.ownerB, "SUPERMARKET_MARGIN_SHARE", marginShares[2]!)
    );
  }

  // ---- discount absorption, identical in both verticals ------------------------------------
  earnings.push(
    ...absorbedDiscountEarnings(input.businessId, input.merchandiseDiscount, rateSet),
    ...absorbedDiscountEarnings(input.businessId, input.deliveryDiscount, rateSet)
  );

  // ---- the delivery fee --------------------------------------------------------------------
  // The driver's share is taken from the fee the order actually charged, before any delivery-fee
  // promotion: a discount is funded by whoever offered it, never out of the driver's pay.
  const driverShareMinor = applyBp(input.deliveryFeeMinor, rateSet.driverDeliveryShareBp);
  const deliveryRemainderMinor = input.deliveryFeeMinor - driverShareMinor;
  const remainderShares = allocateByWeights(deliveryRemainderMinor, [
    rateSet.deliveryOpsRemainderWeight,
    rateSet.ownerADeliveryRemainderWeight,
    rateSet.ownerBDeliveryRemainderWeight
  ]);

  if (input.driverUserId) {
    earnings.push({
      payee: { type: "DRIVER", driverUserId: input.driverUserId },
      component: "DRIVER_DELIVERY_SHARE",
      amountMinor: driverShareMinor
    });
  } else if (driverShareMinor !== 0) {
    // No driver means nobody to pay, and the fee cannot simply evaporate. This should be
    // unreachable — an order only reaches a terminal delivery outcome through a driver.
    throw new Error("A delivery fee was charged but no driver is recorded on the order");
  }
  earnings.push(
    partnerEarning(partnerKeys.deliveryOps, "DELIVERY_OPS_SHARE", remainderShares[0]!),
    partnerEarning(partnerKeys.ownerA, "PLATFORM_DELIVERY_SHARE", remainderShares[1]!),
    partnerEarning(partnerKeys.ownerB, "PLATFORM_DELIVERY_SHARE", remainderShares[2]!)
  );

  // ---- a delivery that collected nothing ---------------------------------------------------
  let lossAbsorber: LossAbsorber = "NONE";
  let absorbedLossMinor = 0;
  const cashCollectedMinor = input.outcome === "DELIVERED" ? input.orderTotalMinor : 0;

  if (input.outcome === "DELIVERY_FAILED") {
    lossAbsorber = resolveLossAbsorber(input.faultParty);
    absorbedLossMinor = input.orderTotalMinor;
    // Everyone above keeps their entitlement — the business was still paid for goods that left the
    // premises, the driver was still paid for the attempt. What changes is that no cash came in,
    // so one party carries the whole uncollected value.
    earnings.push(...failedDeliveryLossEarnings(input, rateSet, lossAbsorber, absorbedLossMinor));
  }

  const merged = mergeEarnings(earnings);
  assertReconciles(merged, cashCollectedMinor, input);

  return {
    vertical: input.vertical,
    outcome: input.outcome,
    commissionBp: input.vertical === "RESTAURANT" ? input.commissionBp : null,
    commissionMinor,
    netMerchandiseMinor,
    goodsCostMinor: input.vertical === "SUPERMARKET" ? input.goodsCostMinor : 0,
    costDataComplete: input.costDataComplete,
    marginMinor,
    driverShareMinor,
    deliveryRemainderMinor,
    cashCollectedMinor,
    lossAbsorber,
    absorbedLossMinor,
    earnings: merged
  };
}

function absorbedDiscountEarnings(
  businessId: string,
  funding: DiscountFunding,
  rateSet: RateSet
): ComputedEarning[] {
  const rows: ComputedEarning[] = [];
  if (funding.businessFundedMinor > 0) {
    rows.push({
      payee: { type: "BUSINESS", businessId },
      component: "BUSINESS_DISCOUNT_ABSORBED",
      amountMinor: -funding.businessFundedMinor
    });
  }
  if (funding.platformFundedMinor > 0) {
    const shares = allocateByWeights(-funding.platformFundedMinor, [
      rateSet.commissionOwnerAWeight,
      rateSet.commissionOwnerBWeight
    ]);
    rows.push(
      partnerEarning(partnerKeys.ownerA, "PLATFORM_DISCOUNT_ABSORBED", shares[0]!),
      partnerEarning(partnerKeys.ownerB, "PLATFORM_DISCOUNT_ABSORBED", shares[1]!)
    );
  }
  return rows;
}

function failedDeliveryLossEarnings(
  input: OrderFinancialInput,
  rateSet: RateSet,
  absorber: LossAbsorber,
  lossMinor: number
): ComputedEarning[] {
  if (lossMinor === 0) return [];
  switch (absorber) {
    case "BUSINESS":
      return [
        {
          payee: { type: "BUSINESS", businessId: input.businessId },
          component: "FAILED_DELIVERY_LOSS",
          amountMinor: -lossMinor
        }
      ];
    case "DRIVER": {
      if (!input.driverUserId) {
        throw new Error("A failed delivery cannot be charged to a driver that is not recorded");
      }
      return [
        {
          payee: { type: "DRIVER", driverUserId: input.driverUserId },
          component: "FAILED_DELIVERY_LOSS",
          amountMinor: -lossMinor
        }
      ];
    }
    case "PLATFORM": {
      const shares = allocateByWeights(-lossMinor, [
        rateSet.commissionOwnerAWeight,
        rateSet.commissionOwnerBWeight
      ]);
      return [
        partnerEarning(partnerKeys.ownerA, "FAILED_DELIVERY_LOSS", shares[0]!),
        partnerEarning(partnerKeys.ownerB, "FAILED_DELIVERY_LOSS", shares[1]!)
      ];
    }
    default:
      throw new Error(`A failed delivery must name an absorber, got ${absorber}`);
  }
}

/**
 * One party may hold only one row per component per source — the database's double-counting guard
 * is a unique index on exactly that. A business absorbing both a merchandise and a delivery-fee
 * promotion legitimately produces two rows of the same component, so they are added together here
 * rather than being rejected on write.
 */
function mergeEarnings(earnings: ComputedEarning[]): ComputedEarning[] {
  const byKey = new Map<string, ComputedEarning>();
  for (const earning of earnings) {
    const key = `${payeeKeyOf(earning.payee)}|${earning.component}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.amountMinor += earning.amountMinor;
    } else {
      byKey.set(key, { ...earning });
    }
  }
  // A component that nets to nothing is not a fact worth storing.
  return [...byKey.values()].filter((earning) => earning.amountMinor !== 0);
}

/** The stable identity a balance groups by, mirroring the `payeeKey` column. */
export function payeeKeyOf(payee: EarningPayee): string {
  switch (payee.type) {
    case "PARTNER":
      return `PARTNER:${payee.partnerKey}`;
    case "BUSINESS":
      return `BUSINESS:${payee.businessId}`;
    case "DRIVER":
      return `DRIVER:${payee.driverUserId}`;
  }
}

/**
 * The whole point of the exercise: what was handed over must equal what was distributed.
 *
 * This runs on every computation, not only in tests. If it ever fails, something in the pricing,
 * the promotion snapshot, or a rate has drifted, and the right outcome is a loud failure at the
 * moment of delivery — not a ledger that is quietly a few shekels out and stays that way.
 */
function assertReconciles(
  earnings: ComputedEarning[],
  cashCollectedMinor: number,
  input: OrderFinancialInput
): void {
  const distributed = earnings.reduce((sum, earning) => sum + earning.amountMinor, 0);
  if (distributed !== cashCollectedMinor) {
    throw new Error(
      `Order financials do not reconcile: distributed ${distributed} against ${cashCollectedMinor} collected ` +
        `(subtotal ${input.itemSubtotalMinor}, delivery ${input.deliveryFeeMinor}, ` +
        `merchandise discount ${totalDiscount(input.merchandiseDiscount)}, ` +
        `delivery discount ${totalDiscount(input.deliveryDiscount)}, order total ${input.orderTotalMinor})`
    );
  }
}

function totalDiscount(funding: DiscountFunding): number {
  return funding.businessFundedMinor + funding.platformFundedMinor;
}

function partnerEarning(
  partnerKey: PartnerKey,
  component: EarningComponent,
  amountMinor: number
): ComputedEarning {
  return { payee: { type: "PARTNER", partnerKey }, component, amountMinor };
}

/**
 * A supermarket operating cost, divided by the cost-share percentages.
 *
 * Kept apart from the margin split on purpose. The two sets of percentages are equal today, and
 * nothing about sharing profit forty/thirty/thirty implies sharing rent the same way — so they are
 * separate fields on the rate set and separate code here, and either can move without the other.
 */
export function computeOperatingCostShares(
  businessId: string,
  amountMinor: number,
  rateSet: RateSet
): ComputedEarning[] {
  if (amountMinor <= 0) {
    throw new Error("An operating cost must be a positive amount");
  }
  const shares = allocateByWeights(-amountMinor, [
    rateSet.supermarketPartnerCostBp,
    rateSet.ownerACostBp,
    rateSet.ownerBCostBp
  ]);
  const rows: ComputedEarning[] = [
    {
      payee: { type: "BUSINESS", businessId },
      component: "OPERATING_COST_SHARE",
      amountMinor: shares[0]!
    },
    partnerEarning(partnerKeys.ownerA, "OPERATING_COST_SHARE", shares[1]!),
    partnerEarning(partnerKeys.ownerB, "OPERATING_COST_SHARE", shares[2]!)
  ];
  return rows.filter((earning) => earning.amountMinor !== 0);
}

/**
 * A month's subscription: the business owes it, the two owners share it. It nets to zero across
 * the ledger because no cash enters the system — it moves an amount from one balance to two others.
 */
export function computeSubscriptionEarnings(
  businessId: string,
  amountMinor: number,
  rateSet: RateSet
): ComputedEarning[] {
  if (amountMinor <= 0) return [];
  const shares = allocateByWeights(amountMinor, [
    rateSet.commissionOwnerAWeight,
    rateSet.commissionOwnerBWeight
  ]);
  const rows: ComputedEarning[] = [
    {
      payee: { type: "BUSINESS", businessId },
      component: "SUBSCRIPTION_CHARGE",
      amountMinor: -amountMinor
    },
    partnerEarning(partnerKeys.ownerA, "SUBSCRIPTION_SHARE", shares[0]!),
    partnerEarning(partnerKeys.ownerB, "SUBSCRIPTION_SHARE", shares[1]!)
  ];
  return rows.filter((earning) => earning.amountMinor !== 0);
}

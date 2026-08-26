import { Prisma } from "../generated/prisma/client";
import type { AppliedPromotion } from "../offers/offers.types";
import {
  computeOrderFinancials,
  payeeKeyOf,
  resolveCommissionBp,
  splitDiscountByFunder,
  type ComputedEarning,
  type OrderFinancialComputation,
  type RateSet
} from "./accounting.rules";

/**
 * Writing one order's money down.
 *
 * Kept as a function over a transaction client rather than a service method, so the driver's
 * "delivered" transition can produce the financial record inside the same transaction that moved
 * the order — a delivery and the money it created either both happen or neither does — without
 * the drivers module having to depend on the accounting module.
 */

/** Order statuses that move money and therefore produce a record. Everything else produces none. */
export const financialOutcomeByOrderStatus = {
  DELIVERED: "DELIVERED",
  DELIVERY_FAILED: "DELIVERY_FAILED"
} as const;

export type FinancialOutcome = (typeof financialOutcomeByOrderStatus)[keyof typeof financialOutcomeByOrderStatus];

export const rateSetSelect = {
  id: true,
  version: true,
  restaurantCommissionBp: true,
  promotionalCommissionBp: true,
  monthlySubscriptionMinor: true,
  commissionOwnerAWeight: true,
  commissionOwnerBWeight: true,
  supermarketPartnerMarginBp: true,
  ownerAMarginBp: true,
  ownerBMarginBp: true,
  supermarketPartnerCostBp: true,
  ownerACostBp: true,
  ownerBCostBp: true,
  driverDeliveryShareBp: true,
  deliveryOpsRemainderWeight: true,
  ownerADeliveryRemainderWeight: true,
  ownerBDeliveryRemainderWeight: true
} as const;

/**
 * The rates that applied when this order was placed.
 *
 * Preference order is deliberate. An order stamped with a rate set at placement always uses that
 * one, whatever has happened since. Only an order placed before stamping existed falls back to
 * "the newest set that was already in force when the order was created" — which is still a lookup
 * by the order's own date, never by today's.
 */
export async function resolveRateSetForOrder(
  tx: Prisma.TransactionClient,
  order: { financialRateSetId: string | null; createdAt: Date }
): Promise<RateSet> {
  if (order.financialRateSetId) {
    const stamped = await tx.financialRateSet.findUnique({
      where: { id: order.financialRateSetId },
      select: rateSetSelect
    });
    if (stamped) return stamped;
  }
  const effective = await tx.financialRateSet.findFirst({
    where: { effectiveFrom: { lte: order.createdAt } },
    orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
    select: rateSetSelect
  });
  if (!effective) {
    throw new Error("No financial rate set is in force; the accounting layer cannot value an order");
  }
  return effective;
}

/** The rates in force right now, for something that is not an order — a cost entry, a subscription. */
export async function resolveCurrentRateSet(tx: Prisma.TransactionClient, at: Date = new Date()): Promise<RateSet> {
  const effective = await tx.financialRateSet.findFirst({
    where: { effectiveFrom: { lte: at } },
    orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
    select: rateSetSelect
  });
  if (!effective) {
    throw new Error("No financial rate set is in force");
  }
  return effective;
}

const orderForFinancialsInclude = {
  // The approved adjustment is part of the line: it is what decides which product was actually
  // packed and how much of it, and therefore what the line really cost. Valuing the order from
  // the order item alone would price the substitution and cost the original.
  items: { include: { fulfillmentAdjustment: true } },
  restaurant: { select: { id: true, businessType: true, isPromotionalPartner: true } },
  delivery: { select: { driverId: true, faultParty: true, deliveredAt: true, failedAt: true } }
} as const;

export type OrderForFinancials = Prisma.OrderGetPayload<{ include: typeof orderForFinancialsInclude }>;

export type RecordedOrderFinancials = {
  recordId: string;
  computation: OrderFinancialComputation;
  /** Null on a failed delivery: no cash changed hands, so nobody is holding any. */
  cashCustodyId: string | null;
};

/**
 * Compute and persist one order's financial record, its ledger rows, and — on a delivered order —
 * the driver's cash custody.
 *
 * Idempotent by construction: `OrderFinancialRecord.orderId` is unique, so a retry or a concurrent
 * transition finds the existing record and returns it instead of writing a second set of
 * entitlements. That guarantee lives in the database, not in this function.
 */
export async function recordOrderFinancials(
  tx: Prisma.TransactionClient,
  orderId: string,
  outcome: FinancialOutcome
): Promise<RecordedOrderFinancials | null> {
  const existing = await tx.orderFinancialRecord.findUnique({ where: { orderId }, select: { id: true } });
  if (existing) return null;

  const order = await tx.order.findUnique({ where: { id: orderId }, include: orderForFinancialsInclude });
  if (!order) {
    throw new Error(`Cannot value order ${orderId}: it does not exist`);
  }

  const rateSet = await resolveRateSetForOrder(tx, order);
  const vertical = order.restaurant.businessType === "SUPERMARKET" ? "SUPERMARKET" : "RESTAURANT";
  const promotions = readPromotionSnapshot(order.promotionSnapshot);
  const discounts = splitDiscountByFunder(
    promotions,
    order.merchandiseDiscountMinor,
    order.deliveryDiscountMinor
  );

  const goods = summariseGoodsCost(order.items);
  // The rate frozen at placement wins. Only an order placed before stamping existed re-resolves,
  // and then from the rate set that was in force on its own creation date.
  const commissionBp =
    vertical === "RESTAURANT"
      ? (order.commissionBpSnapshot ?? resolveCommissionBp(rateSet, order.restaurant.isPromotionalPartner))
      : null;

  const computation = computeOrderFinancials(
    {
      businessId: order.restaurantId,
      vertical,
      outcome,
      isPromotionalBusiness: order.restaurant.isPromotionalPartner,
      commissionBp,
      itemSubtotalMinor: order.subtotalMinor,
      deliveryFeeMinor: order.deliveryFeeMinor,
      merchandiseDiscount: discounts.merchandise,
      deliveryDiscount: discounts.delivery,
      goodsCostMinor: vertical === "SUPERMARKET" ? goods.totalMinor : 0,
      costDataComplete: vertical === "SUPERMARKET" ? goods.complete : true,
      driverUserId: order.delivery?.driverId ?? null,
      faultParty: order.delivery?.faultParty ?? null,
      orderTotalMinor: order.totalMinor
    },
    rateSet
  );

  const occurredAt = order.delivery?.deliveredAt ?? order.delivery?.failedAt ?? new Date();

  const record = await tx.orderFinancialRecord.create({
    data: {
      orderId: order.id,
      businessId: order.restaurantId,
      rateSetId: rateSet.id,
      vertical,
      outcome,
      isPromotionalBusiness: order.restaurant.isPromotionalPartner,
      commissionBp: computation.commissionBp,
      itemSubtotalMinor: order.subtotalMinor,
      merchandiseDiscountMinor: order.merchandiseDiscountMinor,
      deliveryDiscountMinor: order.deliveryDiscountMinor,
      businessFundedMerchandiseDiscountMinor: discounts.merchandise.businessFundedMinor,
      platformFundedMerchandiseDiscountMinor: discounts.merchandise.platformFundedMinor,
      businessFundedDeliveryDiscountMinor: discounts.delivery.businessFundedMinor,
      platformFundedDeliveryDiscountMinor: discounts.delivery.platformFundedMinor,
      unattributedDiscountMinor:
        discounts.merchandise.unattributedMinor + discounts.delivery.unattributedMinor,
      deliveryFeeMinor: order.deliveryFeeMinor,
      cashCollectedMinor: computation.cashCollectedMinor,
      goodsCostMinor: computation.goodsCostMinor,
      costDataComplete: computation.costDataComplete,
      marginMinor: computation.marginMinor,
      commissionMinor: computation.commissionMinor,
      driverShareMinor: computation.driverShareMinor,
      deliveryRemainderMinor: computation.deliveryRemainderMinor,
      lossAbsorber: computation.lossAbsorber,
      absorbedLossMinor: computation.absorbedLossMinor,
      faultParty: order.delivery?.faultParty ?? null,
      computedAt: new Date()
    },
    select: { id: true }
  });

  await writeEarnings(tx, {
    sourceType: "ORDER",
    sourceId: record.id,
    reference: { orderFinancialRecordId: record.id },
    occurredAt,
    earnings: computation.earnings
  });

  // Cash custody is a separate fact from entitlement. It exists only where cash actually changed
  // hands, and it records what the driver is holding — not what the driver has earned.
  let cashCustodyId: string | null = null;
  if (outcome === "DELIVERED" && computation.cashCollectedMinor > 0) {
    if (!order.delivery?.driverId) {
      throw new Error(`Order ${orderId} was delivered with cash but has no driver to hold it`);
    }
    const custody = await tx.driverCashCustody.create({
      data: {
        orderId: order.id,
        orderFinancialRecordId: record.id,
        driverUserId: order.delivery.driverId,
        expectedAmountMinor: computation.cashCollectedMinor,
        collectedAmountMinor: computation.cashCollectedMinor,
        settledAmountMinor: 0,
        status: "OUTSTANDING",
        collectedAt: occurredAt
      },
      select: { id: true }
    });
    cashCustodyId = custody.id;
  }

  return { recordId: record.id, computation, cashCustodyId };
}

export type EarningSourceReference = {
  orderFinancialRecordId?: string;
  operatingCostEntryId?: string;
  subscriptionChargeId?: string;
  adjustmentId?: string;
};

/**
 * Turn computed entitlements into ledger rows.
 *
 * Partner keys are resolved to accounts here, once, rather than in the pure computation — the
 * arithmetic should not need to know that "OWNER_A" is a row in a table.
 */
export async function writeEarnings(
  tx: Prisma.TransactionClient,
  input: {
    sourceType: "ORDER" | "OPERATING_COST" | "SUBSCRIPTION" | "ADJUSTMENT";
    sourceId: string;
    reference: EarningSourceReference;
    occurredAt: Date;
    earnings: ComputedEarning[];
  }
): Promise<void> {
  if (input.earnings.length === 0) return;

  const partnerKeys = [
    ...new Set(
      input.earnings
        .filter((earning) => earning.payee.type === "PARTNER")
        .map((earning) => (earning.payee as { partnerKey: string }).partnerKey)
    )
  ];
  const partnerAccounts = partnerKeys.length
    ? await tx.partnerAccount.findMany({ where: { key: { in: partnerKeys } }, select: { id: true, key: true } })
    : [];
  const partnerIdByKey = new Map(partnerAccounts.map((account) => [account.key, account.id]));
  for (const key of partnerKeys) {
    if (!partnerIdByKey.has(key)) {
      throw new Error(`Partner account "${key}" does not exist; the revenue model cannot be applied`);
    }
  }

  await tx.partnerEarning.createMany({
    data: input.earnings.map((earning) => {
      const payee = earning.payee;
      const partnerAccountId = payee.type === "PARTNER" ? partnerIdByKey.get(payee.partnerKey)! : null;
      // The stored payeeKey points at the account id, not the human-readable partner key, so a
      // renamed partner never splits one balance into two.
      const payeeKey =
        payee.type === "PARTNER" ? `PARTNER:${partnerAccountId}` : payeeKeyOf(payee);
      return {
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        orderFinancialRecordId: input.reference.orderFinancialRecordId ?? null,
        operatingCostEntryId: input.reference.operatingCostEntryId ?? null,
        subscriptionChargeId: input.reference.subscriptionChargeId ?? null,
        adjustmentId: input.reference.adjustmentId ?? null,
        payeeType: payee.type,
        payeeKey,
        partnerAccountId,
        businessId: payee.type === "BUSINESS" ? payee.businessId : null,
        driverUserId: payee.type === "DRIVER" ? payee.driverUserId : null,
        component: earning.component,
        amountMinor: earning.amountMinor,
        occurredAt: input.occurredAt
      };
    })
  });
}

/** One order line's cost input: what was ordered, plus whatever adjustment replaced it. */
export type GoodsCostLine = {
  costPriceMinorSnapshot: number | null;
  quantity: number;
  fulfillmentAdjustment?: {
    status: string;
    lineCostMinor: number | null;
  } | null;
};

/**
 * Sum every line's frozen cost, and say whether any line had none recorded.
 *
 * An approved fulfillment adjustment supersedes the line entirely: it named the product that was
 * actually packed and the quantity that was actually weighed, and froze both the price and the
 * cost of that at proposal time. Reading the order item instead would value a substituted or
 * re-weighed line against the product and quantity the customer originally asked for — the retail
 * side would follow the adjustment and the cost side would not, and the margin split three ways
 * would be wrong on every variable-weight line a supermarket sells.
 */
export function summariseGoodsCost(items: GoodsCostLine[]): { totalMinor: number; complete: boolean } {
  let totalMinor = 0;
  let complete = true;
  for (const item of items) {
    const lineCostMinor = effectiveLineCostMinor(item);
    if (lineCostMinor === null) {
      // Treated as zero cost, which overstates the margin — so the record is flagged rather than
      // read as exact. Silently assuming a cost would be worse than admitting it is missing.
      complete = false;
      continue;
    }
    totalMinor += lineCostMinor;
  }
  return { totalMinor, complete };
}

function effectiveLineCostMinor(item: GoodsCostLine): number | null {
  const adjustment = item.fulfillmentAdjustment;
  if (adjustment?.status === "APPROVED") {
    // Null here means the packed product had no recorded cost. That is reported, not fallen back
    // to the original line's cost, which would be the cost of a product that was never delivered.
    return adjustment.lineCostMinor;
  }
  if (item.costPriceMinorSnapshot === null) return null;
  return item.costPriceMinorSnapshot * item.quantity;
}

/** Read the promotion snapshot defensively: it is JSON written by an earlier version of the code. */
export function readPromotionSnapshot(snapshot: Prisma.JsonValue | null): AppliedPromotion[] {
  if (!Array.isArray(snapshot)) return [];
  const promotions: AppliedPromotion[] = [];
  for (const raw of snapshot) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    promotions.push({
      offerId: String(entry.offerId ?? ""),
      title: String(entry.title ?? ""),
      type: (entry.type ?? "ORDER_PERCENTAGE") as AppliedPromotion["type"],
      discountMinor: Number(entry.discountMinor ?? 0),
      // Anything without a recorded scope is UNKNOWN, never guessed at — see 15.6a.
      scope: (entry.scope ?? "UNKNOWN") as AppliedPromotion["scope"],
      businessId: entry.businessId === undefined || entry.businessId === null ? null : String(entry.businessId)
    });
  }
  return promotions;
}

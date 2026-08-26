import type {
  CashCustodyStatus,
  DeliveryFaultParty,
  EarningComponent,
  FinancialPayeeType,
  LossAbsorber,
  OperatingCostCategory,
  OperatingCostStatus,
  OrderFinancialOutcome,
  OrderFinancialVertical,
  PartnerSettlementMethod
} from "../generated/prisma/enums";

/** A party, identified the same way the ledger identifies one. */
export type PayeeView = {
  payeeKey: string;
  payeeType: FinancialPayeeType;
  /** Human-readable: the partner's name, the business's name, or the driver's name. */
  name: string;
  partnerAccountId: string | null;
  businessId: string | null;
  driverUserId: string | null;
};

/**
 * What one party has earned, what they have been paid, and therefore what is still owed.
 *
 * Three separate numbers on purpose. "Earned 4,200" and "paid 4,200" answer different questions,
 * and a system that reports only their difference cannot tell you whether anyone has been paid.
 */
export type PartnerBalanceView = PayeeView & {
  earnedMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  entryCount: number;
  firstEntryAt: Date | null;
  lastEntryAt: Date | null;
  /** Where the balance came from, so a total can always be traced to its components. */
  byComponent: { component: EarningComponent; amountMinor: number; entryCount: number }[];
};

/** Cash a driver is physically holding, which is not the same as what the driver has earned. */
export type DriverCashView = {
  driverUserId: string;
  driverName: string;
  driverPhone: string;
  collectedMinor: number;
  settledMinor: number;
  outstandingMinor: number;
  outstandingOrderCount: number;
  oldestOutstandingAt: Date | null;
  /** The driver's own pay, reported alongside but never netted against the cash above. */
  earningsMinor: number;
  earningsPaidMinor: number;
};

export type DriverCustodyLineView = {
  custodyId: string;
  orderId: string;
  collectedAt: Date;
  expectedAmountMinor: number;
  collectedAmountMinor: number;
  settledAmountMinor: number;
  outstandingMinor: number;
  status: CashCustodyStatus;
};

export type OrderFinancialRecordView = {
  id: string;
  orderId: string;
  businessId: string;
  businessName: string;
  vertical: OrderFinancialVertical;
  outcome: OrderFinancialOutcome;
  rateSetVersion: number;
  isPromotionalBusiness: boolean;
  commissionBp: number | null;
  itemSubtotalMinor: number;
  merchandiseDiscountMinor: number;
  deliveryDiscountMinor: number;
  businessFundedDiscountMinor: number;
  platformFundedDiscountMinor: number;
  unattributedDiscountMinor: number;
  deliveryFeeMinor: number;
  cashCollectedMinor: number;
  goodsCostMinor: number;
  costDataComplete: boolean;
  marginMinor: number;
  commissionMinor: number;
  driverShareMinor: number;
  deliveryRemainderMinor: number;
  lossAbsorber: LossAbsorber;
  absorbedLossMinor: number;
  faultParty: DeliveryFaultParty | null;
  computedAt: Date;
  entries: {
    payeeKey: string;
    payeeName: string;
    payeeType: FinancialPayeeType;
    component: EarningComponent;
    amountMinor: number;
  }[];
  /** The entries totalled against the cash collected, so a reader can check the arithmetic. */
  reconciliation: { distributedMinor: number; cashCollectedMinor: number; balancedMinor: number };
};

export type OperatingCostEntryView = {
  id: string;
  businessId: string;
  businessName: string;
  category: OperatingCostCategory;
  description: string;
  amountMinor: number;
  incurredOn: Date;
  periodLabel: string | null;
  isRecurring: boolean;
  status: OperatingCostStatus;
  proposedByUserId: string;
  proposedByName: string;
  approverUserId: string | null;
  approverName: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
  /** Populated once approved: who bears how much of this cost. */
  shares: { payeeKey: string; payeeName: string; amountMinor: number }[];
};

export type CashSettlementView = {
  id: string;
  driverUserId: string;
  driverName: string;
  receivedByUserId: string;
  receivedByName: string;
  reference: string;
  mode: string;
  expectedAmountMinor: number;
  countedAmountMinor: number;
  discrepancyMinor: number;
  discrepancyNote: string | null;
  note: string | null;
  settledAt: Date;
  allocations: { custodyId: string; orderId: string; amountMinor: number }[];
};

export type PartnerSettlementView = {
  id: string;
  payeeKey: string;
  payeeName: string;
  payeeType: FinancialPayeeType;
  amountMinor: number;
  method: PartnerSettlementMethod;
  reference: string;
  paidByUserId: string;
  paidByName: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  note: string | null;
  paidAt: Date;
  allocatedEarningCount: number;
};

export type RateSetView = {
  id: string;
  version: number;
  effectiveFrom: Date;
  note: string | null;
  createdAt: Date;
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
  isCurrent: boolean;
};

/**
 * The platform-wide check: money that came in against money accounted for.
 *
 * Every shekel a driver collected is either still in a driver's pocket, or has been handed over
 * and is sitting with the platform waiting to be paid out, or has already been paid to somebody.
 */
export type AccountingOverviewView = {
  orderCount: number;
  deliveredCount: number;
  failedCount: number;
  cashCollectedMinor: number;
  cashSettledMinor: number;
  cashOutstandingMinor: number;
  totalEarnedMinor: number;
  totalPaidMinor: number;
  totalOutstandingMinor: number;
  approvedOperatingCostMinor: number;
  pendingOperatingCostCount: number;
  /** cashCollected - operatingCosts - totalEarned. Zero when the ledger is internally consistent. */
  ledgerImbalanceMinor: number;
  /**
   * Records valued against at least one line with no recorded cost price. Those orders reconcile
   * exactly but split the money wrongly — the goods cost counted as zero and the whole retail
   * value treated as margin — so this is the one drift the imbalance figure cannot show.
   * Anything above zero needs investigating.
   */
  costDataIncompleteCount: number;
};

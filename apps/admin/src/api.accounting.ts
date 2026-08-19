import { request } from "./api";

/**
 * The accounting layer's client.
 *
 * Kept in its own module rather than added to `api.ts`, because the accounting surface is large
 * and only two screens consume it — and because "who is owed what" is a distinct concern from the
 * operational endpoints the rest of the shell uses.
 *
 * Every amount is in minor units (agorot). Nothing here converts to shekels: the formatting
 * happens once, at the point of display, so an amount can never be rounded twice on its way out.
 */

export type FinancialPayeeType = "PARTNER" | "BUSINESS" | "DRIVER";

export type PartnerBalance = {
  payeeKey: string;
  payeeType: FinancialPayeeType;
  name: string;
  partnerAccountId: string | null;
  businessId: string | null;
  driverUserId: string | null;
  earnedMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  entryCount: number;
  firstEntryAt: string | null;
  lastEntryAt: string | null;
  byComponent: { component: string; amountMinor: number; entryCount: number }[];
};

export type DriverCash = {
  driverUserId: string;
  driverName: string;
  driverPhone: string;
  collectedMinor: number;
  settledMinor: number;
  outstandingMinor: number;
  outstandingOrderCount: number;
  oldestOutstandingAt: string | null;
  earningsMinor: number;
  earningsPaidMinor: number;
};

export type DriverCustodyLine = {
  custodyId: string;
  orderId: string;
  collectedAt: string;
  expectedAmountMinor: number;
  collectedAmountMinor: number;
  settledAmountMinor: number;
  outstandingMinor: number;
  status: "OUTSTANDING" | "PARTIALLY_SETTLED" | "SETTLED";
};

export type OperatingCostEntry = {
  id: string;
  businessId: string;
  businessName: string;
  category: string;
  description: string;
  amountMinor: number;
  incurredOn: string;
  periodLabel: string | null;
  isRecurring: boolean;
  status: "PROPOSED" | "APPROVED" | "REJECTED";
  proposedByName: string;
  approverUserId: string | null;
  approverName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  shares: { payeeKey: string; payeeName: string; amountMinor: number }[];
};

export type CashSettlement = {
  id: string;
  driverUserId: string;
  driverName: string;
  receivedByName: string;
  reference: string;
  mode: string;
  expectedAmountMinor: number;
  countedAmountMinor: number;
  discrepancyMinor: number;
  discrepancyNote: string | null;
  note: string | null;
  settledAt: string;
  allocations: { custodyId: string; orderId: string; amountMinor: number }[];
};

export type PartnerSettlement = {
  id: string;
  payeeKey: string;
  payeeName: string;
  payeeType: FinancialPayeeType;
  amountMinor: number;
  method: "CASH" | "BANK_TRANSFER" | "OFFSET";
  reference: string;
  paidByName: string;
  note: string | null;
  paidAt: string;
  allocatedEarningCount: number;
};

export type AccountingOverview = {
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
  ledgerImbalanceMinor: number;
};

export type RateSet = {
  id: string;
  version: number;
  effectiveFrom: string;
  note: string | null;
  createdAt: string;
  restaurantCommissionBp: number;
  promotionalCommissionBp: number;
  monthlySubscriptionMinor: number;
  supermarketPartnerMarginBp: number;
  ownerAMarginBp: number;
  ownerBMarginBp: number;
  supermarketPartnerCostBp: number;
  ownerACostBp: number;
  ownerBCostBp: number;
  driverDeliveryShareBp: number;
  isCurrent: boolean;
};

export type OrderFinancialRecord = {
  id: string;
  orderId: string;
  businessName: string;
  vertical: "RESTAURANT" | "SUPERMARKET";
  outcome: "DELIVERED" | "DELIVERY_FAILED";
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
  lossAbsorber: string;
  absorbedLossMinor: number;
  faultParty: string | null;
  computedAt: string;
  entries: { payeeKey: string; payeeName: string; payeeType: FinancialPayeeType; component: string; amountMinor: number }[];
  reconciliation: { distributedMinor: number; cashCollectedMinor: number; balancedMinor: number };
};

const base = "/api/v1/admin/accounting";

export const getAccountingOverview = () => request<AccountingOverview>(`${base}/overview`);
export const listPartnerBalances = () => request<PartnerBalance[]>(`${base}/balances`);
export const listPendingSettlements = () => request<PartnerBalance[]>(`${base}/balances/pending`);
export const listDriverCash = () => request<DriverCash[]>(`${base}/cash/drivers`);
export const listDriverCustody = (driverUserId: string) =>
  request<DriverCustodyLine[]>(`${base}/cash/drivers/${driverUserId}`);
export const listCashSettlements = () => request<CashSettlement[]>(`${base}/cash/settlements`);
export const listPartnerSettlements = () => request<PartnerSettlement[]>(`${base}/settlements`);
export const listOperatingCosts = (status?: string) =>
  request<OperatingCostEntry[]>(`${base}/operating-costs${status ? `?status=${status}` : ""}`);
export const listRateSets = () => request<RateSet[]>(`${base}/rates`);
export const getOrderFinancialRecord = (orderId: string) =>
  request<OrderFinancialRecord>(`${base}/orders/${orderId}`);

export const recordCashSettlement = (body: {
  driverUserId: string;
  reference: string;
  countedAmountMinor: number;
  custodyIds?: string[];
  discrepancyNote?: string;
  note?: string;
}) => request<CashSettlement>(`${base}/cash/settlements`, { method: "POST", body });

export const decideOperatingCost = (entryId: string, body: { approve: boolean; note?: string }) =>
  request<OperatingCostEntry>(`${base}/operating-costs/${entryId}/decision`, { method: "POST", body });

export const recordPartnerSettlement = (body: {
  partnerAccountId?: string;
  businessId?: string;
  driverUserId?: string;
  amountMinor: number;
  method: "CASH" | "BANK_TRANSFER" | "OFFSET";
  reference: string;
  note?: string;
}) => request<PartnerSettlement>(`${base}/settlements`, { method: "POST", body });

/** Minor units to a readable amount. One conversion, at the edge, so nothing rounds twice. */
export function formatMinor(amountMinor: number): string {
  const sign = amountMinor < 0 ? "-" : "";
  const absolute = Math.abs(amountMinor);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

/** Basis points as a percentage, e.g. 2000 -> "20%". */
export function formatBp(bp: number): string {
  const percent = bp / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
}

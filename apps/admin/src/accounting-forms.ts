import { parsePercentToBp, parsePositiveMoneyToMinor, parseScaledDecimal, parseWholeNumber, toMoneyInput, toPercentInput } from "./money";

/**
 * The logic behind the accounting forms that write to the ledger, kept apart from the screens so
 * it can be tested without a browser.
 *
 * The ledger is append-only, so these builders are strict on purpose: a form that lets a malformed
 * correction through has no undo. They return an error *key* (an i18n path) rather than a message,
 * so the screen decides the language and the tests decide nothing about wording.
 */

// ------------------------------------------------------------------------------------ adjustments

export type AdjustmentPartyKind = "PARTNER" | "BUSINESS" | "DRIVER";
/** Which way the money moves for the named party: CREDIT increases what they are owed. */
export type AdjustmentDirection = "CREDIT" | "CHARGE";

export const adjustmentPartnerKeys = ["OWNER_A", "OWNER_B", "DELIVERY_OPS"] as const;

export type AdjustmentRowDraft = {
  kind: AdjustmentPartyKind;
  /** A partner key for PARTNER, otherwise the business or driver id. Empty until chosen. */
  partyId: string;
  direction: AdjustmentDirection;
  /** Text as typed, in shekels. */
  amount: string;
};

export type AdjustmentEntryBody = {
  partnerKey?: string;
  businessId?: string;
  driverUserId?: string;
  amountMinor: number;
};

export type AdjustmentBody = {
  reason: string;
  note?: string;
  orderFinancialRecordId?: string;
  entries: AdjustmentEntryBody[];
};

export type AdjustmentError =
  | "reasonRequired"
  | "noEntries"
  | "partyRequired"
  | "invalidAmount"
  | "duplicateParty"
  | "unbalancedNeedsConfirmation";

export type AdjustmentResult =
  | { ok: true; body: AdjustmentBody; netMinor: number }
  | { ok: false; error: AdjustmentError; row?: number };

export function signedAmountMinor(direction: AdjustmentDirection, amountMinor: number): number {
  return direction === "CHARGE" ? -amountMinor : amountMinor;
}

/** What the entries add up to. Zero means the correction only moves money between parties. */
export function adjustmentNetMinor(rows: AdjustmentRowDraft[]): number {
  let net = 0;
  for (const row of rows) {
    const amountMinor = parsePositiveMoneyToMinor(row.amount);
    if (amountMinor !== null) net += signedAmountMinor(row.direction, amountMinor);
  }
  return net;
}

/**
 * Validate a correction and build the request body.
 *
 * An adjustment that does not net to zero *creates or destroys money*: the overview's imbalance
 * figure (cash collected − approved costs − everything earned) will read non-zero from then on. That
 * is sometimes exactly right — a write-off, a goodwill credit funded from outside the ledger — so it
 * is allowed, but only when the operator has explicitly confirmed it.
 */
export function buildAdjustment(input: {
  reason: string;
  note: string;
  orderFinancialRecordId: string | null;
  rows: AdjustmentRowDraft[];
  confirmUnbalanced: boolean;
}): AdjustmentResult {
  const reason = input.reason.trim();
  if (reason.length < 3) return { ok: false, error: "reasonRequired" };
  if (input.rows.length === 0) return { ok: false, error: "noEntries" };

  const seen = new Set<string>();
  const entries: AdjustmentEntryBody[] = [];
  let netMinor = 0;
  for (const [index, row] of input.rows.entries()) {
    if (!row.partyId) return { ok: false, error: "partyRequired", row: index };
    const amountMinor = parsePositiveMoneyToMinor(row.amount);
    if (amountMinor === null) return { ok: false, error: "invalidAmount", row: index };

    const identity = `${row.kind}:${row.partyId}`;
    if (seen.has(identity)) return { ok: false, error: "duplicateParty", row: index };
    seen.add(identity);

    const signed = signedAmountMinor(row.direction, amountMinor);
    netMinor += signed;
    entries.push({
      ...(row.kind === "PARTNER" ? { partnerKey: row.partyId } : {}),
      ...(row.kind === "BUSINESS" ? { businessId: row.partyId } : {}),
      ...(row.kind === "DRIVER" ? { driverUserId: row.partyId } : {}),
      amountMinor: signed
    });
  }

  if (netMinor !== 0 && !input.confirmUnbalanced) return { ok: false, error: "unbalancedNeedsConfirmation" };

  const note = input.note.trim();
  return {
    ok: true,
    netMinor,
    body: {
      reason,
      ...(note ? { note } : {}),
      ...(input.orderFinancialRecordId ? { orderFinancialRecordId: input.orderFinancialRecordId } : {}),
      entries
    }
  };
}

// -------------------------------------------------------------------------------------- rate sets

/** The fields of a rate set the form edits, as they come back from the API. */
export type RateSetFields = {
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

export type RateSetDraft = {
  effectiveFrom: string;
  note: string;
  restaurantCommission: string;
  promotionalCommission: string;
  monthlySubscription: string;
  commissionOwnerAWeight: string;
  commissionOwnerBWeight: string;
  supermarketPartnerMargin: string;
  ownerAMargin: string;
  ownerBMargin: string;
  supermarketPartnerCost: string;
  ownerACost: string;
  ownerBCost: string;
  driverDeliveryShare: string;
  deliveryOpsRemainderWeight: string;
  ownerADeliveryRemainderWeight: string;
  ownerBDeliveryRemainderWeight: string;
};

export type RateSetBody = { effectiveFrom: string; note?: string } & Partial<RateSetFields>;

export type RateSetError =
  | "invalidDate"
  | "notAfterCurrent"
  | "invalidPercent"
  | "invalidAmount"
  | "invalidWeight"
  | "marginSplitTotal"
  | "costSplitTotal"
  | "commissionWeightsZero"
  | "deliveryWeightsZero";

export type RateSetResult =
  | { ok: true; body: RateSetBody; changedKeys: (keyof RateSetFields)[] }
  | { ok: false; error: RateSetError; field?: keyof RateSetDraft };

/** Seed the form from the set in force, so "change one rate" is one edit, not fifteen. */
export function rateSetToDraft(current: RateSetFields, effectiveFrom: string): RateSetDraft {
  return {
    effectiveFrom,
    note: "",
    restaurantCommission: toPercentInput(current.restaurantCommissionBp),
    promotionalCommission: toPercentInput(current.promotionalCommissionBp),
    monthlySubscription: toMoneyInput(current.monthlySubscriptionMinor),
    commissionOwnerAWeight: String(current.commissionOwnerAWeight),
    commissionOwnerBWeight: String(current.commissionOwnerBWeight),
    supermarketPartnerMargin: toPercentInput(current.supermarketPartnerMarginBp),
    ownerAMargin: toPercentInput(current.ownerAMarginBp),
    ownerBMargin: toPercentInput(current.ownerBMarginBp),
    supermarketPartnerCost: toPercentInput(current.supermarketPartnerCostBp),
    ownerACost: toPercentInput(current.ownerACostBp),
    ownerBCost: toPercentInput(current.ownerBCostBp),
    driverDeliveryShare: toPercentInput(current.driverDeliveryShareBp),
    deliveryOpsRemainderWeight: String(current.deliveryOpsRemainderWeight),
    ownerADeliveryRemainderWeight: String(current.ownerADeliveryRemainderWeight),
    ownerBDeliveryRemainderWeight: String(current.ownerBDeliveryRemainderWeight)
  };
}

const percentFields = [
  ["restaurantCommission", "restaurantCommissionBp"],
  ["promotionalCommission", "promotionalCommissionBp"],
  ["supermarketPartnerMargin", "supermarketPartnerMarginBp"],
  ["ownerAMargin", "ownerAMarginBp"],
  ["ownerBMargin", "ownerBMarginBp"],
  ["supermarketPartnerCost", "supermarketPartnerCostBp"],
  ["ownerACost", "ownerACostBp"],
  ["ownerBCost", "ownerBCostBp"],
  ["driverDeliveryShare", "driverDeliveryShareBp"]
] as const;

const weightFields = [
  ["commissionOwnerAWeight", "commissionOwnerAWeight"],
  ["commissionOwnerBWeight", "commissionOwnerBWeight"],
  ["deliveryOpsRemainderWeight", "deliveryOpsRemainderWeight"],
  ["ownerADeliveryRemainderWeight", "ownerADeliveryRemainderWeight"],
  ["ownerBDeliveryRemainderWeight", "ownerBDeliveryRemainderWeight"]
] as const;

/**
 * Validate a new rate set and build the request body.
 *
 * Mirrors the database's CHECK constraints (the three margin shares and the three cost shares each
 * total exactly 100%; commission and delivery-remainder weights are not all zero). The API does not
 * pre-check those, so without this a mistyped split would reach the database and come back as an
 * opaque 500 instead of a message beside the field.
 *
 * Only fields that differ from the set in force are sent — the API copies the rest — which keeps
 * the audit trail honest about what this version actually changed.
 */
export function buildRateSet(
  draft: RateSetDraft,
  current: RateSetFields,
  /** When the set in force started. A new version must begin after it, or it would never apply. */
  currentEffectiveFrom?: string
): RateSetResult {
  const effective = new Date(draft.effectiveFrom);
  if (!draft.effectiveFrom || Number.isNaN(effective.getTime())) return { ok: false, error: "invalidDate" };
  // The API picks the set in force by latest effectiveFrom, so a version dated on or before the
  // current one would be published and then never used — a silent no-op the operator would trust.
  if (currentEffectiveFrom && effective.getTime() <= new Date(currentEffectiveFrom).getTime()) {
    return { ok: false, error: "notAfterCurrent", field: "effectiveFrom" };
  }

  const values: Partial<Record<keyof RateSetFields, number>> = {};
  for (const [draftKey, apiKey] of percentFields) {
    const bp = parsePercentToBp(draft[draftKey]);
    if (bp === null) return { ok: false, error: "invalidPercent", field: draftKey };
    values[apiKey] = bp;
  }
  const subscription = parseScaledDecimal(draft.monthlySubscription, 2);
  if (subscription === null || subscription < 0) return { ok: false, error: "invalidAmount", field: "monthlySubscription" };
  values.monthlySubscriptionMinor = subscription;
  for (const [draftKey, apiKey] of weightFields) {
    const weight = parseWholeNumber(draft[draftKey]);
    if (weight === null) return { ok: false, error: "invalidWeight", field: draftKey };
    values[apiKey] = weight;
  }

  const v = values as RateSetFields;
  if (v.supermarketPartnerMarginBp + v.ownerAMarginBp + v.ownerBMarginBp !== 10_000) {
    return { ok: false, error: "marginSplitTotal", field: "supermarketPartnerMargin" };
  }
  if (v.supermarketPartnerCostBp + v.ownerACostBp + v.ownerBCostBp !== 10_000) {
    return { ok: false, error: "costSplitTotal", field: "supermarketPartnerCost" };
  }
  if (v.commissionOwnerAWeight + v.commissionOwnerBWeight <= 0) {
    return { ok: false, error: "commissionWeightsZero", field: "commissionOwnerAWeight" };
  }
  if (v.deliveryOpsRemainderWeight + v.ownerADeliveryRemainderWeight + v.ownerBDeliveryRemainderWeight <= 0) {
    return { ok: false, error: "deliveryWeightsZero", field: "deliveryOpsRemainderWeight" };
  }

  const changedKeys = (Object.keys(values) as (keyof RateSetFields)[]).filter((key) => values[key] !== current[key]);
  const changed: Partial<RateSetFields> = {};
  for (const key of changedKeys) changed[key] = values[key];

  const note = draft.note.trim();
  return {
    ok: true,
    changedKeys,
    body: { effectiveFrom: effective.toISOString(), ...(note ? { note } : {}), ...changed }
  };
}

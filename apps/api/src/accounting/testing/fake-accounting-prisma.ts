import { randomUUID } from "node:crypto";
import { partnerKeys } from "../accounting.rules";

/**
 * An in-memory stand-in for the accounting tables, shared by the module test doubles.
 *
 * The accounting layer hangs off the delivery and order flows, so the drivers' and orders' own
 * fake clients have to be able to satisfy it — otherwise those suites would only pass by having
 * the money code stubbed out, which is precisely the code worth exercising.
 *
 * Deliberately not a general Prisma emulator: it implements the handful of shapes this codebase
 * actually calls, and nothing else, so a query the real client would reject does not quietly
 * succeed here.
 */

export type FakeRateSetRecord = {
  id: string;
  version: number;
  effectiveFrom: Date;
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

export type FakeEarningRecord = {
  id: string;
  sourceType: string;
  sourceId: string;
  orderFinancialRecordId: string | null;
  operatingCostEntryId: string | null;
  subscriptionChargeId: string | null;
  adjustmentId: string | null;
  payeeType: string;
  payeeKey: string;
  partnerAccountId: string | null;
  businessId: string | null;
  driverUserId: string | null;
  component: string;
  amountMinor: number;
  occurredAt: Date;
};

export type FakeCustodyRecord = {
  id: string;
  orderId: string;
  orderFinancialRecordId: string;
  driverUserId: string;
  expectedAmountMinor: number;
  collectedAmountMinor: number;
  settledAmountMinor: number;
  status: string;
  collectedAt: Date;
};

/** The revenue model as agreed, used by every test double unless a test replaces it. */
export const defaultFakeRateSet: FakeRateSetRecord = {
  id: "rate-set-v1",
  version: 1,
  effectiveFrom: new Date("1970-01-01T00:00:00.000Z"),
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

export class FakeAccountingStore {
  readonly rateSets: FakeRateSetRecord[] = [{ ...defaultFakeRateSet }];
  readonly partnerAccounts = [
    { id: "partner-owner-a", key: partnerKeys.ownerA, name: "Owner A" },
    { id: "partner-owner-b", key: partnerKeys.ownerB, name: "Owner B" },
    { id: "partner-delivery-ops", key: partnerKeys.deliveryOps, name: "Delivery operations" }
  ];
  readonly orderFinancialRecords: Record<string, unknown>[] = [];
  readonly partnerEarnings: FakeEarningRecord[] = [];
  readonly driverCashCustodies: FakeCustodyRecord[] = [];
  readonly partnerSettlements: { id: string; payeeKey: string; driverUserId: string | null; amountMinor: number }[] = [];

  readonly financialRateSet = {} as any;
  readonly partnerAccount = {} as any;
  readonly orderFinancialRecord = {} as any;
  readonly partnerEarning = {} as any;
  readonly driverCashCustody = {} as any;
  readonly partnerSettlement = {} as any;

  constructor() {
    this.financialRateSet.findUnique = async ({ where }: any) =>
      this.rateSets.find((set) => set.id === where.id) ?? null;
    this.financialRateSet.findFirst = async ({ where }: any) => {
      const limit = where?.effectiveFrom?.lte;
      const eligible = this.rateSets.filter((set) => !limit || set.effectiveFrom <= limit);
      return (
        [...eligible].sort(
          (left, right) =>
            right.effectiveFrom.getTime() - left.effectiveFrom.getTime() || right.version - left.version
        )[0] ?? null
      );
    };

    this.partnerAccount.findMany = async ({ where }: any) =>
      this.partnerAccounts.filter((account) => !where?.key?.in || where.key.in.includes(account.key));

    this.orderFinancialRecord.findUnique = async ({ where }: any) =>
      this.orderFinancialRecords.find((record) => record.orderId === where.orderId) ?? null;
    this.orderFinancialRecord.create = async ({ data }: any) => {
      if (this.orderFinancialRecords.some((record) => record.orderId === data.orderId)) {
        // Mirrors the unique index on orderId: an order is valued exactly once.
        throw new Error("duplicate order financial record");
      }
      const record = { id: randomUUID(), ...data };
      this.orderFinancialRecords.push(record);
      return record;
    };

    this.partnerEarning.createMany = async ({ data }: any) => {
      for (const row of data as FakeEarningRecord[]) {
        const duplicate = this.partnerEarnings.some(
          (existing) =>
            existing.sourceType === row.sourceType &&
            existing.sourceId === row.sourceId &&
            existing.payeeKey === row.payeeKey &&
            existing.component === row.component
        );
        if (duplicate) {
          // Mirrors the (sourceType, sourceId, payeeKey, component) unique index.
          throw new Error("duplicate partner earning");
        }
        this.partnerEarnings.push({ ...row, id: randomUUID() });
      }
      return { count: data.length };
    };
    this.partnerEarning.aggregate = async ({ where }: any) => ({
      _sum: {
        amountMinor: this.partnerEarnings
          .filter((earning) => matchesEarning(earning, where))
          .reduce((sum, earning) => sum + earning.amountMinor, 0)
      }
    });
    this.partnerEarning.findMany = async ({ where }: any) =>
      this.partnerEarnings.filter((earning) => matchesEarning(earning, where));

    this.driverCashCustody.create = async ({ data }: any) => {
      const custody: FakeCustodyRecord = { id: randomUUID(), ...data };
      this.driverCashCustodies.push(custody);
      return custody;
    };
    this.driverCashCustody.findMany = async ({ where }: any) =>
      this.driverCashCustodies.filter((custody) => matchesCustody(custody, where));
    this.driverCashCustody.aggregate = async ({ where }: any) => {
      const matches = this.driverCashCustodies.filter((custody) => matchesCustody(custody, where));
      return {
        _sum: {
          collectedAmountMinor: matches.reduce((sum, custody) => sum + custody.collectedAmountMinor, 0),
          settledAmountMinor: matches.reduce((sum, custody) => sum + custody.settledAmountMinor, 0)
        }
      };
    };

    this.partnerSettlement.aggregate = async ({ where }: any) => ({
      _sum: {
        amountMinor: this.partnerSettlements
          .filter(
            (settlement) =>
              (where?.payeeKey === undefined || settlement.payeeKey === where.payeeKey) &&
              (where?.driverUserId === undefined || settlement.driverUserId === where.driverUserId)
          )
          .reduce((sum, settlement) => sum + settlement.amountMinor, 0)
      }
    });
  }

  /** Every ledger row one order produced, for asserting on the split in a test. */
  earningsForOrderRecord(orderId: string): FakeEarningRecord[] {
    const record = this.orderFinancialRecords.find((candidate) => candidate.orderId === orderId);
    if (!record) return [];
    return this.partnerEarnings.filter((earning) => earning.orderFinancialRecordId === record.id);
  }
}

function matchesEarning(earning: FakeEarningRecord, where: any): boolean {
  if (!where) return true;
  if (where.driverUserId !== undefined && earning.driverUserId !== where.driverUserId) return false;
  if (where.payeeKey !== undefined && earning.payeeKey !== where.payeeKey) return false;
  if (where.payeeType !== undefined && earning.payeeType !== where.payeeType) return false;
  return true;
}

function matchesCustody(custody: FakeCustodyRecord, where: any): boolean {
  if (!where) return true;
  if (where.driverUserId !== undefined && custody.driverUserId !== where.driverUserId) return false;
  if (where.status?.in !== undefined && !where.status.in.includes(custody.status)) return false;
  if (where.status !== undefined && typeof where.status === "string" && custody.status !== where.status) return false;
  return true;
}

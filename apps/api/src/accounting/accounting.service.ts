import { Injectable } from "@nestjs/common";
import { ApiException } from "../common/api.exception";
import { writeAuditLog } from "../common/audit-log.util";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  computeOperatingCostShares,
  computeSubscriptionEarnings,
  partnerKeys,
  resolveSubscriptionMinor,
  type ComputedEarning,
  type PartnerKey
} from "./accounting.rules";
import type {
  AccountingOverviewView,
  CashSettlementView,
  DriverCashView,
  DriverCustodyLineView,
  OperatingCostEntryView,
  OrderFinancialRecordView,
  PartnerBalanceView,
  PartnerSettlementView,
  RateSetView
} from "./accounting.types";
import type {
  CreateOperatingCostDto,
  CreateRateSetDto,
  DecideOperatingCostDto,
  GenerateSubscriptionChargesDto,
  RecordAdjustmentDto,
  RecordCashSettlementDto,
  RecordPartnerSettlementDto
} from "./accounting.dto";
import { rateSetSelect, resolveCurrentRateSet, writeEarnings } from "./order-financials.util";

/**
 * The accounting layer's read and write operations.
 *
 * Everything that changes money runs inside a transaction and leans on a database constraint for
 * the guarantee, not on a check performed a few lines earlier: a unique reference stops a retried
 * handover posting twice, a CHECK stops an order being settled beyond what was collected, and a
 * trigger stops any of it being edited afterwards. The code below is the ergonomics; the database
 * is the guarantee.
 */
@Injectable()
export class AccountingService {
  constructor(private readonly prisma: PrismaService) {}

  // =============================================================================== rate settings

  async listRateSets(): Promise<RateSetView[]> {
    const [sets, current] = await Promise.all([
      this.prisma.financialRateSet.findMany({ orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }] }),
      resolveCurrentRateSet(this.prisma)
    ]);
    return sets.map((set) => toRateSetView(set, set.id === current.id));
  }

  /**
   * Change a rate by adding a version, never by editing one.
   *
   * A rate set is immutable at the database level, so this is the only way rates move. An order
   * already stamped with version 1 keeps version 1's percentages for the rest of its life, which
   * is exactly what stops a decision taken today from restating last month's payouts.
   */
  async createRateSet(actorUserId: string, input: CreateRateSetDto): Promise<RateSetView> {
    const effectiveFrom = new Date(input.effectiveFrom);
    if (Number.isNaN(effectiveFrom.getTime())) {
      throw new ApiException(400, "RATE_SET_INVALID_DATE", "Enter a valid effective-from date.");
    }
    const created = await this.prisma.$transaction(async (tx) => {
      const latest = await tx.financialRateSet.findFirst({ orderBy: { version: "desc" }, select: { version: true } });
      const base = await resolveCurrentRateSet(tx);
      const full = await tx.financialRateSet.findUniqueOrThrow({ where: { id: base.id } });
      const next = await tx.financialRateSet.create({
        data: {
          version: (latest?.version ?? 0) + 1,
          effectiveFrom,
          note: input.note?.trim() || null,
          createdByUserId: actorUserId,
          // Anything not restated carries over from the set in force, so a change to one
          // percentage never silently resets the others to their defaults.
          restaurantCommissionBp: input.restaurantCommissionBp ?? full.restaurantCommissionBp,
          promotionalCommissionBp: input.promotionalCommissionBp ?? full.promotionalCommissionBp,
          monthlySubscriptionMinor: input.monthlySubscriptionMinor ?? full.monthlySubscriptionMinor,
          commissionOwnerAWeight: input.commissionOwnerAWeight ?? full.commissionOwnerAWeight,
          commissionOwnerBWeight: input.commissionOwnerBWeight ?? full.commissionOwnerBWeight,
          supermarketPartnerMarginBp: input.supermarketPartnerMarginBp ?? full.supermarketPartnerMarginBp,
          ownerAMarginBp: input.ownerAMarginBp ?? full.ownerAMarginBp,
          ownerBMarginBp: input.ownerBMarginBp ?? full.ownerBMarginBp,
          supermarketPartnerCostBp: input.supermarketPartnerCostBp ?? full.supermarketPartnerCostBp,
          ownerACostBp: input.ownerACostBp ?? full.ownerACostBp,
          ownerBCostBp: input.ownerBCostBp ?? full.ownerBCostBp,
          driverDeliveryShareBp: input.driverDeliveryShareBp ?? full.driverDeliveryShareBp,
          deliveryOpsRemainderWeight: input.deliveryOpsRemainderWeight ?? full.deliveryOpsRemainderWeight,
          ownerADeliveryRemainderWeight:
            input.ownerADeliveryRemainderWeight ?? full.ownerADeliveryRemainderWeight,
          ownerBDeliveryRemainderWeight:
            input.ownerBDeliveryRemainderWeight ?? full.ownerBDeliveryRemainderWeight
        }
      });
      await writeAuditLog(tx, {
        actorUserId,
        action: "FINANCIAL_RATE_SET_CREATED",
        entityType: "FinancialRateSet",
        entityId: next.id,
        reason: input.note ?? null,
        metadata: { version: next.version, effectiveFrom: effectiveFrom.toISOString() }
      });
      return next;
    });
    const current = await resolveCurrentRateSet(this.prisma);
    return toRateSetView(created, created.id === current.id);
  }

  // ============================================================================ partner balances

  /**
   * Every party's running total: earned, paid, still owed.
   *
   * Built from two aggregates rather than a row-by-row walk, because the ledger only ever grows
   * and a balance must stay a single indexed scan however many orders there have been.
   */
  async listPartnerBalances(): Promise<PartnerBalanceView[]> {
    const [earnings, payouts, byComponent] = await Promise.all([
      this.prisma.partnerEarning.groupBy({
        by: ["payeeKey", "payeeType", "partnerAccountId", "businessId", "driverUserId"],
        _sum: { amountMinor: true },
        _count: { _all: true },
        _min: { occurredAt: true },
        _max: { occurredAt: true }
      }),
      this.prisma.partnerSettlement.groupBy({ by: ["payeeKey"], _sum: { amountMinor: true } }),
      this.prisma.partnerEarning.groupBy({
        by: ["payeeKey", "component"],
        _sum: { amountMinor: true },
        _count: { _all: true }
      })
    ]);

    const paidByPayee = new Map(payouts.map((row) => [row.payeeKey, row._sum.amountMinor ?? 0]));
    const names = await this.resolvePayeeNames(earnings);
    const components = new Map<string, PartnerBalanceView["byComponent"]>();
    for (const row of byComponent) {
      const list = components.get(row.payeeKey) ?? [];
      list.push({
        component: row.component,
        amountMinor: row._sum.amountMinor ?? 0,
        entryCount: row._count._all
      });
      components.set(row.payeeKey, list);
    }

    return earnings
      .map((row) => {
        const earnedMinor = row._sum.amountMinor ?? 0;
        const paidMinor = paidByPayee.get(row.payeeKey) ?? 0;
        return {
          payeeKey: row.payeeKey,
          payeeType: row.payeeType,
          name: names.get(row.payeeKey) ?? row.payeeKey,
          partnerAccountId: row.partnerAccountId,
          businessId: row.businessId,
          driverUserId: row.driverUserId,
          earnedMinor,
          paidMinor,
          outstandingMinor: earnedMinor - paidMinor,
          entryCount: row._count._all,
          firstEntryAt: row._min.occurredAt,
          lastEntryAt: row._max.occurredAt,
          byComponent: (components.get(row.payeeKey) ?? []).sort((left, right) =>
            left.component.localeCompare(right.component)
          )
        };
      })
      .sort((left, right) => right.outstandingMinor - left.outstandingMinor);
  }

  /** Parties who are owed something right now — the payout queue. */
  async listPendingPartnerSettlements(): Promise<PartnerBalanceView[]> {
    const balances = await this.listPartnerBalances();
    return balances.filter((balance) => balance.outstandingMinor > 0);
  }

  // ================================================================================ driver cash

  /**
   * Cash outstanding per driver.
   *
   * Reported entirely separately from what each driver has earned. A driver holding 340.00 of
   * customers' money and being owed 21.00 in pay are two facts about two different pockets, and
   * combining them into one "balance" is how cash-on-delivery businesses lose track of money.
   */
  async listDriverCash(): Promise<DriverCashView[]> {
    const [custodyTotals, drivers, earnings, payouts] = await Promise.all([
      this.prisma.driverCashCustody.groupBy({
        by: ["driverUserId"],
        _sum: { collectedAmountMinor: true, settledAmountMinor: true }
      }),
      this.prisma.user.findMany({ where: { role: "DRIVER" }, select: { id: true, fullName: true, phone: true } }),
      this.prisma.partnerEarning.groupBy({
        by: ["driverUserId"],
        where: { payeeType: "DRIVER" },
        _sum: { amountMinor: true }
      }),
      this.prisma.partnerSettlement.groupBy({
        by: ["driverUserId"],
        where: { payeeType: "DRIVER" },
        _sum: { amountMinor: true }
      })
    ]);

    const outstanding = await this.prisma.driverCashCustody.groupBy({
      by: ["driverUserId"],
      where: { status: { in: ["OUTSTANDING", "PARTIALLY_SETTLED"] } },
      _count: { _all: true },
      _min: { collectedAt: true }
    });

    const driverById = new Map(drivers.map((driver) => [driver.id, driver]));
    const earnedByDriver = new Map(earnings.map((row) => [row.driverUserId!, row._sum.amountMinor ?? 0]));
    const paidByDriver = new Map(payouts.map((row) => [row.driverUserId!, row._sum.amountMinor ?? 0]));
    const outstandingByDriver = new Map(outstanding.map((row) => [row.driverUserId, row]));

    return custodyTotals
      .map((row) => {
        const collectedMinor = row._sum.collectedAmountMinor ?? 0;
        const settledMinor = row._sum.settledAmountMinor ?? 0;
        const open = outstandingByDriver.get(row.driverUserId);
        const driver = driverById.get(row.driverUserId);
        return {
          driverUserId: row.driverUserId,
          driverName: driver?.fullName ?? "Unknown driver",
          driverPhone: driver?.phone ?? "",
          collectedMinor,
          settledMinor,
          outstandingMinor: collectedMinor - settledMinor,
          outstandingOrderCount: open?._count._all ?? 0,
          oldestOutstandingAt: open?._min.collectedAt ?? null,
          earningsMinor: earnedByDriver.get(row.driverUserId) ?? 0,
          earningsPaidMinor: paidByDriver.get(row.driverUserId) ?? 0
        };
      })
      .sort((left, right) => right.outstandingMinor - left.outstandingMinor);
  }

  /** The individual orders behind one driver's cash balance. */
  async listDriverCustody(driverUserId: string, openOnly = true): Promise<DriverCustodyLineView[]> {
    const rows = await this.prisma.driverCashCustody.findMany({
      where: {
        driverUserId,
        ...(openOnly ? { status: { in: ["OUTSTANDING", "PARTIALLY_SETTLED"] as const } } : {})
      },
      orderBy: { collectedAt: "asc" }
    });
    return rows.map((row) => ({
      custodyId: row.id,
      orderId: row.orderId,
      collectedAt: row.collectedAt,
      expectedAmountMinor: row.expectedAmountMinor,
      collectedAmountMinor: row.collectedAmountMinor,
      settledAmountMinor: row.settledAmountMinor,
      outstandingMinor: row.collectedAmountMinor - row.settledAmountMinor,
      status: row.status
    }));
  }

  /**
   * A driver hands cash over and an authorised receiver counts it.
   *
   * Three things are deliberately kept apart: what the orders said was due (expected), what was
   * physically counted (counted), and the difference (discrepancy). A short handover settles the
   * orders only as far as the money actually goes — the rest stays outstanding against the driver.
   *
   * The handover is GROSS: the full amount collected comes back, and what the driver has earned is
   * paid as its own event. `mode` exists so netting can be switched on later without a rebuild.
   */
  async recordCashSettlement(actorUserId: string, input: RecordCashSettlementDto): Promise<CashSettlementView> {
    if (input.countedAmountMinor < 0) {
      throw new ApiException(400, "CASH_SETTLEMENT_INVALID_AMOUNT", "The counted amount cannot be negative.");
    }
    if (input.driverUserId === actorUserId) {
      throw new ApiException(400, "CASH_SETTLEMENT_SELF", "A driver cannot receive their own handover.");
    }

    const settlementId = await this.prisma.$transaction(async (tx) => {
      const custodies = await tx.driverCashCustody.findMany({
        where: {
          driverUserId: input.driverUserId,
          status: { in: ["OUTSTANDING", "PARTIALLY_SETTLED"] },
          ...(input.custodyIds?.length ? { id: { in: input.custodyIds } } : {})
        },
        orderBy: { collectedAt: "asc" }
      });
      if (custodies.length === 0) {
        throw new ApiException(
          409,
          "CASH_SETTLEMENT_NOTHING_OUTSTANDING",
          "This driver has no outstanding cash to hand over."
        );
      }
      if (input.custodyIds?.length && custodies.length !== new Set(input.custodyIds).size) {
        throw new ApiException(
          409,
          "CASH_SETTLEMENT_ORDER_ALREADY_SETTLED",
          "One or more of the selected orders is already fully settled or belongs to another driver."
        );
      }

      const expectedAmountMinor = custodies.reduce(
        (sum, custody) => sum + (custody.collectedAmountMinor - custody.settledAmountMinor),
        0
      );
      // Never allocate more than was actually counted, and never more than is actually owed. A
      // surplus is recorded as a discrepancy rather than credited against orders that did not
      // produce it.
      let remaining = Math.min(input.countedAmountMinor, expectedAmountMinor);

      const settlement = await tx.cashSettlement.create({
        data: {
          driverUserId: input.driverUserId,
          receivedByUserId: actorUserId,
          reference: input.reference.trim(),
          mode: "GROSS",
          expectedAmountMinor,
          countedAmountMinor: input.countedAmountMinor,
          discrepancyMinor: input.countedAmountMinor - expectedAmountMinor,
          discrepancyNote: input.discrepancyNote?.trim() || null,
          note: input.note?.trim() || null
        }
      });

      for (const custody of custodies) {
        if (remaining <= 0) break;
        const outstanding = custody.collectedAmountMinor - custody.settledAmountMinor;
        const amountMinor = Math.min(outstanding, remaining);
        if (amountMinor <= 0) continue;

        const settledAmountMinor = custody.settledAmountMinor + amountMinor;
        const status =
          settledAmountMinor === custody.collectedAmountMinor ? "SETTLED" : "PARTIALLY_SETTLED";
        // Compare-and-swap on the amount this allocation was calculated from. Two receivers taking
        // cash for the same order at once means one of them loses the race and retries, rather
        // than both succeeding and the order being settled twice.
        const moved = await tx.driverCashCustody.updateMany({
          where: { id: custody.id, settledAmountMinor: custody.settledAmountMinor },
          data: { settledAmountMinor, status }
        });
        if (moved.count !== 1) {
          throw new ApiException(
            409,
            "CASH_SETTLEMENT_CONCURRENT",
            "This driver's cash was settled by someone else while this handover was being recorded. Check the balance and try again."
          );
        }
        await tx.cashSettlementAllocation.create({
          data: { settlementId: settlement.id, custodyId: custody.id, amountMinor }
        });
        remaining -= amountMinor;
      }

      await writeAuditLog(tx, {
        actorUserId,
        action: "DRIVER_CASH_SETTLED",
        entityType: "CashSettlement",
        entityId: settlement.id,
        reason: input.note ?? null,
        metadata: {
          driverUserId: input.driverUserId,
          expectedAmountMinor,
          countedAmountMinor: input.countedAmountMinor,
          discrepancyMinor: input.countedAmountMinor - expectedAmountMinor
        }
      });
      return settlement.id;
    }).catch(rethrowDuplicateReference("CASH_SETTLEMENT_DUPLICATE", "This handover has already been recorded."));

    return this.getCashSettlement(settlementId);
  }

  async getCashSettlement(settlementId: string): Promise<CashSettlementView> {
    const settlement = await this.prisma.cashSettlement.findUnique({
      where: { id: settlementId },
      include: {
        driver: { select: { fullName: true } },
        receivedBy: { select: { fullName: true } },
        allocations: { include: { custody: { select: { orderId: true } } } }
      }
    });
    if (!settlement) {
      throw new ApiException(404, "CASH_SETTLEMENT_NOT_FOUND", "This handover does not exist.");
    }
    return {
      id: settlement.id,
      driverUserId: settlement.driverUserId,
      driverName: settlement.driver.fullName,
      receivedByUserId: settlement.receivedByUserId,
      receivedByName: settlement.receivedBy.fullName,
      reference: settlement.reference,
      mode: settlement.mode,
      expectedAmountMinor: settlement.expectedAmountMinor,
      countedAmountMinor: settlement.countedAmountMinor,
      discrepancyMinor: settlement.discrepancyMinor,
      discrepancyNote: settlement.discrepancyNote,
      note: settlement.note,
      settledAt: settlement.settledAt,
      allocations: settlement.allocations.map((allocation) => ({
        custodyId: allocation.custodyId,
        orderId: allocation.custody.orderId,
        amountMinor: allocation.amountMinor
      }))
    };
  }

  async listCashSettlements(driverUserId?: string): Promise<CashSettlementView[]> {
    const rows = await this.prisma.cashSettlement.findMany({
      where: driverUserId ? { driverUserId } : {},
      orderBy: { settledAt: "desc" },
      take: 200,
      select: { id: true }
    });
    return Promise.all(rows.map((row) => this.getCashSettlement(row.id)));
  }

  // ========================================================================== operating costs

  /**
   * The supermarket side reports a cost. It is not split, and nobody is charged for it, until an
   * approver acts — which is the whole point of the workflow.
   */
  async proposeOperatingCost(
    actorUserId: string,
    businessId: string,
    input: CreateOperatingCostDto
  ): Promise<OperatingCostEntryView> {
    const business = await this.prisma.restaurant.findUnique({
      where: { id: businessId },
      select: { id: true, businessType: true }
    });
    if (!business) {
      throw new ApiException(404, "BUSINESS_NOT_FOUND", "This business does not exist.");
    }
    if (business.businessType !== "SUPERMARKET") {
      throw new ApiException(
        409,
        "OPERATING_COST_WRONG_VERTICAL",
        "Operating costs are shared three ways under the supermarket agreement and only apply to a supermarket."
      );
    }
    if (input.amountMinor <= 0) {
      throw new ApiException(400, "OPERATING_COST_INVALID_AMOUNT", "Enter an amount greater than zero.");
    }
    const incurredOn = new Date(input.incurredOn);
    if (Number.isNaN(incurredOn.getTime())) {
      throw new ApiException(400, "OPERATING_COST_INVALID_DATE", "Enter a valid date for when the cost was incurred.");
    }
    const isRecurring = input.isRecurring ?? false;
    const periodLabel = input.periodLabel?.trim() || (isRecurring ? monthLabel(incurredOn) : null);
    if (isRecurring && !periodLabel) {
      throw new ApiException(
        400,
        "OPERATING_COST_PERIOD_REQUIRED",
        "A recurring cost needs the month it covers, so the same month cannot be entered twice."
      );
    }

    const created = await this.prisma
      .$transaction(async (tx) => {
        const entry = await tx.operatingCostEntry.create({
          data: {
            businessId,
            category: input.category,
            description: input.description.trim(),
            amountMinor: input.amountMinor,
            incurredOn,
            periodLabel,
            isRecurring,
            status: "PROPOSED",
            proposedByUserId: actorUserId
          }
        });
        await writeAuditLog(tx, {
          actorUserId,
          businessId,
          action: "OPERATING_COST_PROPOSED",
          entityType: "OperatingCostEntry",
          entityId: entry.id,
          metadata: { category: input.category, amountMinor: input.amountMinor, periodLabel }
        });
        return entry;
      })
      .catch(
        rethrowDuplicate(
          "OPERATING_COST_DUPLICATE_PERIOD",
          "A cost of this category has already been entered for that period."
        )
      );

    return this.getOperatingCost(created.id);
  }

  /**
   * Approve or reject a proposed cost.
   *
   * Approval is the moment the money becomes real: the rate set is frozen onto the entry and the
   * three-way split is written to the ledger in the same transaction. A rejection records the
   * decision and creates nothing.
   */
  async decideOperatingCost(
    actorUserId: string,
    entryId: string,
    input: DecideOperatingCostDto
  ): Promise<OperatingCostEntryView> {
    await this.prisma.$transaction(async (tx) => {
      const entry = await tx.operatingCostEntry.findUnique({ where: { id: entryId } });
      if (!entry) {
        throw new ApiException(404, "OPERATING_COST_NOT_FOUND", "This cost entry does not exist.");
      }
      if (entry.status !== "PROPOSED") {
        throw new ApiException(
          409,
          "OPERATING_COST_ALREADY_DECIDED",
          `This cost was already ${entry.status.toLowerCase()} and cannot be decided again.`
        );
      }

      const decidedAt = new Date();
      if (!input.approve) {
        // Guarded on the status it was read at, so two approvers cannot both decide it.
        const moved = await tx.operatingCostEntry.updateMany({
          where: { id: entryId, status: "PROPOSED" },
          data: {
            status: "REJECTED",
            approverUserId: actorUserId,
            decidedAt,
            decisionNote: input.note?.trim() || null
          }
        });
        if (moved.count !== 1) throw operatingCostRaceLost();
        await writeAuditLog(tx, {
          actorUserId,
          businessId: entry.businessId,
          action: "OPERATING_COST_REJECTED",
          entityType: "OperatingCostEntry",
          entityId: entryId,
          reason: input.note ?? null,
          metadata: { amountMinor: entry.amountMinor }
        });
        return;
      }

      const rateSet = await resolveCurrentRateSet(tx, decidedAt);
      const moved = await tx.operatingCostEntry.updateMany({
        where: { id: entryId, status: "PROPOSED" },
        data: {
          status: "APPROVED",
          approverUserId: actorUserId,
          decidedAt,
          decisionNote: input.note?.trim() || null,
          rateSetId: rateSet.id
        }
      });
      if (moved.count !== 1) throw operatingCostRaceLost();

      const shares = computeOperatingCostShares(entry.businessId, entry.amountMinor, rateSet);
      await writeEarnings(tx, {
        sourceType: "OPERATING_COST",
        sourceId: entryId,
        reference: { operatingCostEntryId: entryId },
        occurredAt: entry.incurredOn,
        earnings: shares
      });
      await writeAuditLog(tx, {
        actorUserId,
        businessId: entry.businessId,
        action: "OPERATING_COST_APPROVED",
        entityType: "OperatingCostEntry",
        entityId: entryId,
        reason: input.note ?? null,
        metadata: {
          amountMinor: entry.amountMinor,
          rateSetVersion: rateSet.version,
          shares: shares.map((share) => share.amountMinor)
        }
      });
    });

    return this.getOperatingCost(entryId);
  }

  async listOperatingCosts(filter: { status?: string; businessId?: string }): Promise<OperatingCostEntryView[]> {
    const rows = await this.prisma.operatingCostEntry.findMany({
      where: {
        ...(filter.status ? { status: filter.status as "PROPOSED" | "APPROVED" | "REJECTED" } : {}),
        ...(filter.businessId ? { businessId: filter.businessId } : {})
      },
      orderBy: [{ status: "asc" }, { incurredOn: "desc" }],
      take: 300,
      select: { id: true }
    });
    return Promise.all(rows.map((row) => this.getOperatingCost(row.id)));
  }

  async getOperatingCost(entryId: string): Promise<OperatingCostEntryView> {
    const entry = await this.prisma.operatingCostEntry.findUnique({
      where: { id: entryId },
      include: {
        business: { select: { name: true } },
        proposedBy: { select: { fullName: true } },
        approver: { select: { fullName: true } },
        shares: true
      }
    });
    if (!entry) {
      throw new ApiException(404, "OPERATING_COST_NOT_FOUND", "This cost entry does not exist.");
    }
    const names = await this.resolvePayeeNames(entry.shares);
    return {
      id: entry.id,
      businessId: entry.businessId,
      businessName: entry.business.name,
      category: entry.category,
      description: entry.description,
      amountMinor: entry.amountMinor,
      incurredOn: entry.incurredOn,
      periodLabel: entry.periodLabel,
      isRecurring: entry.isRecurring,
      status: entry.status,
      proposedByUserId: entry.proposedByUserId,
      proposedByName: entry.proposedBy.fullName,
      approverUserId: entry.approverUserId,
      approverName: entry.approver?.fullName ?? null,
      decidedAt: entry.decidedAt,
      decisionNote: entry.decisionNote,
      createdAt: entry.createdAt,
      shares: entry.shares.map((share) => ({
        payeeKey: share.payeeKey,
        payeeName: names.get(share.payeeKey) ?? share.payeeKey,
        amountMinor: share.amountMinor
      }))
    };
  }

  // ============================================================================= subscriptions

  /**
   * Raise one month's subscription for every restaurant that owes it.
   *
   * Promotional partners are skipped entirely rather than charged zero, because "not billed" and
   * "billed nothing" read differently on a statement. Re-running the month is safe: the unique
   * index on (business, year, month) means an already-billed business is left alone.
   */
  async generateSubscriptionCharges(
    actorUserId: string,
    input: GenerateSubscriptionChargesDto
  ): Promise<{ created: number; skipped: number; totalMinor: number }> {
    const { periodYear, periodMonth } = input;
    if (periodMonth < 1 || periodMonth > 12) {
      throw new ApiException(400, "SUBSCRIPTION_INVALID_PERIOD", "Choose a month between 1 and 12.");
    }

    const businesses = await this.prisma.restaurant.findMany({
      where: { businessType: "RESTAURANT", status: "APPROVED" },
      select: { id: true, isPromotionalPartner: true }
    });

    let created = 0;
    let skipped = 0;
    let totalMinor = 0;

    for (const business of businesses) {
      if (business.isPromotionalPartner) {
        skipped += 1;
        continue;
      }
      try {
        const amountMinor = await this.prisma.$transaction(async (tx) => {
          const rateSet = await resolveCurrentRateSet(tx);
          const amount = resolveSubscriptionMinor(rateSet, business.isPromotionalPartner);
          const charge = await tx.subscriptionCharge.create({
            data: {
              businessId: business.id,
              periodYear,
              periodMonth,
              amountMinor: amount,
              isWaived: false,
              rateSetId: rateSet.id,
              createdByUserId: actorUserId
            }
          });
          await writeEarnings(tx, {
            sourceType: "SUBSCRIPTION",
            sourceId: charge.id,
            reference: { subscriptionChargeId: charge.id },
            occurredAt: new Date(Date.UTC(periodYear, periodMonth - 1, 1)),
            earnings: computeSubscriptionEarnings(business.id, amount, rateSet)
          });
          return amount;
        });
        created += 1;
        totalMinor += amountMinor;
      } catch (error) {
        if (isUniqueViolation(error)) {
          // Already billed for this month. Re-running the job must not charge twice.
          skipped += 1;
          continue;
        }
        throw error;
      }
    }

    await writeAuditLog(this.prisma, {
      actorUserId,
      action: "SUBSCRIPTION_CHARGES_GENERATED",
      entityType: "SubscriptionCharge",
      entityId: `${periodYear}-${String(periodMonth).padStart(2, "0")}`,
      metadata: { created, skipped, totalMinor }
    });

    return { created, skipped, totalMinor };
  }

  // ================================================================================ corrections

  /**
   * A correction, as a new entry rather than an edit.
   *
   * The entries are supplied explicitly and signed. Nothing already written changes: the original
   * record still says what it said, and the adjustment says what was wrong with it and who decided.
   */
  async recordAdjustment(actorUserId: string, input: RecordAdjustmentDto): Promise<{ id: string }> {
    if (input.entries.length === 0) {
      throw new ApiException(400, "ADJUSTMENT_EMPTY", "An adjustment needs at least one entry.");
    }
    if (!input.reason?.trim()) {
      throw new ApiException(400, "ADJUSTMENT_REASON_REQUIRED", "Say why this correction is being made.");
    }

    const adjustmentId = await this.prisma.$transaction(async (tx) => {
      if (input.orderFinancialRecordId) {
        const record = await tx.orderFinancialRecord.findUnique({
          where: { id: input.orderFinancialRecordId },
          select: { id: true }
        });
        if (!record) {
          throw new ApiException(404, "ORDER_FINANCIAL_RECORD_NOT_FOUND", "That financial record does not exist.");
        }
      }
      const adjustment = await tx.financialAdjustment.create({
        data: {
          orderFinancialRecordId: input.orderFinancialRecordId ?? null,
          reason: input.reason.trim(),
          note: input.note?.trim() || null,
          createdByUserId: actorUserId
        }
      });

      const earnings: ComputedEarning[] = input.entries.map((entry) => ({
        payee: toAdjustmentPayee(entry),
        component: "ADJUSTMENT",
        amountMinor: entry.amountMinor
      }));
      await writeEarnings(tx, {
        sourceType: "ADJUSTMENT",
        sourceId: adjustment.id,
        reference: { adjustmentId: adjustment.id },
        occurredAt: new Date(),
        earnings
      });
      await writeAuditLog(tx, {
        actorUserId,
        action: "FINANCIAL_ADJUSTMENT_RECORDED",
        entityType: "FinancialAdjustment",
        entityId: adjustment.id,
        reason: input.reason,
        metadata: { entries: input.entries.length, netMinor: sumAmounts(input.entries) }
      });
      return adjustment.id;
    });

    return { id: adjustmentId };
  }

  // ============================================================================ partner payouts

  /**
   * Record that a party was actually paid.
   *
   * Separate from the entitlement that created the balance, and refused when it exceeds what is
   * owed — paying someone more than they earned is a correction, made deliberately as an
   * adjustment, not something a payout screen should be able to do by accident.
   */
  async recordPartnerSettlement(
    actorUserId: string,
    input: RecordPartnerSettlementDto
  ): Promise<PartnerSettlementView> {
    if (input.amountMinor <= 0) {
      throw new ApiException(400, "PARTNER_SETTLEMENT_INVALID_AMOUNT", "Enter an amount greater than zero.");
    }
    const payee = toPayee(input);
    const payeeKey = await this.resolvePayeeKey(payee);

    const settlementId = await this.prisma
      .$transaction(async (tx) => {
        const [earned, paid] = await Promise.all([
          tx.partnerEarning.aggregate({ where: { payeeKey }, _sum: { amountMinor: true } }),
          tx.partnerSettlement.aggregate({ where: { payeeKey }, _sum: { amountMinor: true } })
        ]);
        const outstanding = (earned._sum.amountMinor ?? 0) - (paid._sum.amountMinor ?? 0);
        if (input.amountMinor > outstanding) {
          throw new ApiException(
            409,
            "PARTNER_SETTLEMENT_EXCEEDS_BALANCE",
            `This party is owed ${outstanding} minor units; ${input.amountMinor} cannot be paid out.`
          );
        }

        const settlement = await tx.partnerSettlement.create({
          data: {
            payeeType: payee.type,
            payeeKey,
            partnerAccountId: payee.type === "PARTNER" ? payee.partnerAccountId : null,
            businessId: payee.type === "BUSINESS" ? payee.businessId : null,
            driverUserId: payee.type === "DRIVER" ? payee.driverUserId : null,
            amountMinor: input.amountMinor,
            method: input.method,
            reference: input.reference.trim(),
            paidByUserId: actorUserId,
            periodStart: input.periodStart ? new Date(input.periodStart) : null,
            periodEnd: input.periodEnd ? new Date(input.periodEnd) : null,
            note: input.note?.trim() || null
          }
        });

        // Provenance: which entitlements this payout cleared. The balance itself is always
        // earnings minus payouts, so an unallocated remainder is legitimate rather than lost —
        // allocations exist to answer "which orders was I paid for", not to compute the total.
        const unallocated = await tx.partnerEarning.findMany({
          where: { payeeKey, amountMinor: { gt: 0 }, settlementAllocation: { is: null } },
          orderBy: { occurredAt: "asc" }
        });
        let remaining = input.amountMinor;
        for (const earning of unallocated) {
          if (earning.amountMinor > remaining) continue;
          await tx.partnerSettlementAllocation.create({
            data: { settlementId: settlement.id, earningId: earning.id, amountMinor: earning.amountMinor }
          });
          remaining -= earning.amountMinor;
          if (remaining === 0) break;
        }

        await writeAuditLog(tx, {
          actorUserId,
          action: "PARTNER_SETTLEMENT_RECORDED",
          entityType: "PartnerSettlement",
          entityId: settlement.id,
          reason: input.note ?? null,
          metadata: { payeeKey, amountMinor: input.amountMinor, method: input.method }
        });
        return settlement.id;
      })
      .catch(rethrowDuplicateReference("PARTNER_SETTLEMENT_DUPLICATE", "This payout has already been recorded."));

    return this.getPartnerSettlement(settlementId);
  }

  async getPartnerSettlement(settlementId: string): Promise<PartnerSettlementView> {
    const settlement = await this.prisma.partnerSettlement.findUnique({
      where: { id: settlementId },
      include: { paidBy: { select: { fullName: true } }, _count: { select: { allocations: true } } }
    });
    if (!settlement) {
      throw new ApiException(404, "PARTNER_SETTLEMENT_NOT_FOUND", "This payout does not exist.");
    }
    const names = await this.resolvePayeeNames([settlement]);
    return {
      id: settlement.id,
      payeeKey: settlement.payeeKey,
      payeeName: names.get(settlement.payeeKey) ?? settlement.payeeKey,
      payeeType: settlement.payeeType,
      amountMinor: settlement.amountMinor,
      method: settlement.method,
      reference: settlement.reference,
      paidByUserId: settlement.paidByUserId,
      paidByName: settlement.paidBy.fullName,
      periodStart: settlement.periodStart,
      periodEnd: settlement.periodEnd,
      note: settlement.note,
      paidAt: settlement.paidAt,
      allocatedEarningCount: settlement._count.allocations
    };
  }

  async listPartnerSettlements(payeeKey?: string): Promise<PartnerSettlementView[]> {
    const rows = await this.prisma.partnerSettlement.findMany({
      where: payeeKey ? { payeeKey } : {},
      orderBy: { paidAt: "desc" },
      take: 200,
      select: { id: true }
    });
    return Promise.all(rows.map((row) => this.getPartnerSettlement(row.id)));
  }

  // ============================================================================= order records

  async getOrderFinancialRecord(orderId: string): Promise<OrderFinancialRecordView> {
    const record = await this.prisma.orderFinancialRecord.findUnique({
      where: { orderId },
      include: {
        business: { select: { name: true } },
        rateSet: { select: { version: true } },
        earnings: { orderBy: { component: "asc" } }
      }
    });
    if (!record) {
      throw new ApiException(
        404,
        "ORDER_FINANCIAL_RECORD_NOT_FOUND",
        "This order has no financial record. Only delivered and failed orders produce one."
      );
    }
    const names = await this.resolvePayeeNames(record.earnings);
    const distributedMinor = record.earnings.reduce((sum, earning) => sum + earning.amountMinor, 0);
    return {
      id: record.id,
      orderId: record.orderId,
      businessId: record.businessId,
      businessName: record.business.name,
      vertical: record.vertical,
      outcome: record.outcome,
      rateSetVersion: record.rateSet.version,
      isPromotionalBusiness: record.isPromotionalBusiness,
      commissionBp: record.commissionBp,
      itemSubtotalMinor: record.itemSubtotalMinor,
      merchandiseDiscountMinor: record.merchandiseDiscountMinor,
      deliveryDiscountMinor: record.deliveryDiscountMinor,
      businessFundedDiscountMinor:
        record.businessFundedMerchandiseDiscountMinor + record.businessFundedDeliveryDiscountMinor,
      platformFundedDiscountMinor:
        record.platformFundedMerchandiseDiscountMinor + record.platformFundedDeliveryDiscountMinor,
      unattributedDiscountMinor: record.unattributedDiscountMinor,
      deliveryFeeMinor: record.deliveryFeeMinor,
      cashCollectedMinor: record.cashCollectedMinor,
      goodsCostMinor: record.goodsCostMinor,
      costDataComplete: record.costDataComplete,
      marginMinor: record.marginMinor,
      commissionMinor: record.commissionMinor,
      driverShareMinor: record.driverShareMinor,
      deliveryRemainderMinor: record.deliveryRemainderMinor,
      lossAbsorber: record.lossAbsorber,
      absorbedLossMinor: record.absorbedLossMinor,
      faultParty: record.faultParty,
      computedAt: record.computedAt,
      entries: record.earnings.map((earning) => ({
        payeeKey: earning.payeeKey,
        payeeName: names.get(earning.payeeKey) ?? earning.payeeKey,
        payeeType: earning.payeeType,
        component: earning.component,
        amountMinor: earning.amountMinor
      })),
      reconciliation: {
        distributedMinor,
        cashCollectedMinor: record.cashCollectedMinor,
        balancedMinor: distributedMinor - record.cashCollectedMinor
      }
    };
  }

  // ================================================================================== overview

  async getOverview(): Promise<AccountingOverviewView> {
    const [records, custody, earnings, payouts, approvedCosts, pendingCosts] = await Promise.all([
      this.prisma.orderFinancialRecord.groupBy({
        by: ["outcome"],
        _count: { _all: true },
        _sum: { cashCollectedMinor: true }
      }),
      this.prisma.driverCashCustody.aggregate({
        _sum: { collectedAmountMinor: true, settledAmountMinor: true }
      }),
      this.prisma.partnerEarning.aggregate({ _sum: { amountMinor: true } }),
      this.prisma.partnerSettlement.aggregate({ _sum: { amountMinor: true } }),
      this.prisma.operatingCostEntry.aggregate({ where: { status: "APPROVED" }, _sum: { amountMinor: true } }),
      this.prisma.operatingCostEntry.count({ where: { status: "PROPOSED" } })
    ]);

    const deliveredCount = records.find((row) => row.outcome === "DELIVERED")?._count._all ?? 0;
    const failedCount = records.find((row) => row.outcome === "DELIVERY_FAILED")?._count._all ?? 0;
    const cashCollectedMinor = records.reduce((sum, row) => sum + (row._sum.cashCollectedMinor ?? 0), 0);
    const cashSettledMinor = custody._sum.settledAmountMinor ?? 0;
    const totalEarnedMinor = earnings._sum.amountMinor ?? 0;
    const totalPaidMinor = payouts._sum.amountMinor ?? 0;
    const approvedOperatingCostMinor = approvedCosts._sum.amountMinor ?? 0;

    return {
      orderCount: deliveredCount + failedCount,
      deliveredCount,
      failedCount,
      cashCollectedMinor,
      cashSettledMinor,
      cashOutstandingMinor: (custody._sum.collectedAmountMinor ?? 0) - cashSettledMinor,
      totalEarnedMinor,
      totalPaidMinor,
      totalOutstandingMinor: totalEarnedMinor - totalPaidMinor,
      approvedOperatingCostMinor,
      pendingOperatingCostCount: pendingCosts,
      // Every shekel collected is owed to somebody, less whatever the operating costs consumed.
      // Anything other than zero here means the ledger has drifted and needs looking at.
      ledgerImbalanceMinor: cashCollectedMinor - approvedOperatingCostMinor - totalEarnedMinor
    };
  }

  // =================================================================================== helpers

  /** Turn payee keys into names, in one round trip per payee kind rather than one per row. */
  private async resolvePayeeNames(
    rows: { payeeKey: string; partnerAccountId?: string | null; businessId?: string | null; driverUserId?: string | null }[]
  ): Promise<Map<string, string>> {
    const partnerIds = unique(rows.map((row) => row.partnerAccountId));
    const businessIds = unique(rows.map((row) => row.businessId));
    const driverIds = unique(rows.map((row) => row.driverUserId));

    const [partners, businesses, drivers] = await Promise.all([
      partnerIds.length
        ? this.prisma.partnerAccount.findMany({ where: { id: { in: partnerIds } }, select: { id: true, name: true } })
        : [],
      businessIds.length
        ? this.prisma.restaurant.findMany({ where: { id: { in: businessIds } }, select: { id: true, name: true } })
        : [],
      driverIds.length
        ? this.prisma.user.findMany({ where: { id: { in: driverIds } }, select: { id: true, fullName: true } })
        : []
    ]);

    const names = new Map<string, string>();
    for (const partner of partners) names.set(`PARTNER:${partner.id}`, partner.name);
    for (const business of businesses) names.set(`BUSINESS:${business.id}`, business.name);
    for (const driver of drivers) names.set(`DRIVER:${driver.id}`, driver.fullName);
    return names;
  }

  private async resolvePayeeKey(payee: ResolvedPayee): Promise<string> {
    switch (payee.type) {
      case "PARTNER": {
        const partner = await this.prisma.partnerAccount.findUnique({
          where: { id: payee.partnerAccountId },
          select: { id: true }
        });
        if (!partner) throw new ApiException(404, "PARTNER_NOT_FOUND", "This partner account does not exist.");
        return `PARTNER:${partner.id}`;
      }
      case "BUSINESS": {
        const business = await this.prisma.restaurant.findUnique({
          where: { id: payee.businessId },
          select: { id: true }
        });
        if (!business) throw new ApiException(404, "BUSINESS_NOT_FOUND", "This business does not exist.");
        return `BUSINESS:${business.id}`;
      }
      case "DRIVER": {
        const driver = await this.prisma.user.findUnique({ where: { id: payee.driverUserId }, select: { id: true } });
        if (!driver) throw new ApiException(404, "DRIVER_NOT_FOUND", "This driver does not exist.");
        return `DRIVER:${driver.id}`;
      }
    }
  }
}

type ResolvedPayee =
  | { type: "PARTNER"; partnerAccountId: string }
  | { type: "BUSINESS"; businessId: string }
  | { type: "DRIVER"; driverUserId: string };

/**
 * A payee arrives from the API as one of three optional ids. Exactly one must be present — the
 * same rule the database enforces on the row that results.
 */
function toPayee(input: {
  partnerAccountId?: string | null;
  businessId?: string | null;
  driverUserId?: string | null;
}): ResolvedPayee {
  const provided = [input.partnerAccountId, input.businessId, input.driverUserId].filter(Boolean);
  if (provided.length !== 1) {
    throw new ApiException(
      400,
      "PAYEE_AMBIGUOUS",
      "Name exactly one payee: a partner account, a business, or a driver."
    );
  }
  if (input.partnerAccountId) return { type: "PARTNER", partnerAccountId: input.partnerAccountId };
  if (input.businessId) return { type: "BUSINESS", businessId: input.businessId };
  return { type: "DRIVER", driverUserId: input.driverUserId! };
}

/**
 * An adjustment names its party the same way the revenue model does: a fixed partner by key, or a
 * business or driver by id. Exactly one, matching what the database will accept on the row.
 */
function toAdjustmentPayee(entry: {
  partnerKey?: string | null;
  businessId?: string | null;
  driverUserId?: string | null;
}): ComputedEarning["payee"] {
  const provided = [entry.partnerKey, entry.businessId, entry.driverUserId].filter(Boolean);
  if (provided.length !== 1) {
    throw new ApiException(
      400,
      "ADJUSTMENT_PAYEE_AMBIGUOUS",
      "Every adjustment entry names exactly one party: a partner key, a business, or a driver."
    );
  }
  if (entry.partnerKey) {
    const partnerKey = entry.partnerKey as PartnerKey;
    if (!Object.values(partnerKeys).includes(partnerKey)) {
      throw new ApiException(
        400,
        "ADJUSTMENT_UNKNOWN_PARTNER",
        `"${entry.partnerKey}" is not a partner in the revenue model.`
      );
    }
    return { type: "PARTNER", partnerKey };
  }
  if (entry.businessId) return { type: "BUSINESS", businessId: entry.businessId };
  return { type: "DRIVER", driverUserId: entry.driverUserId! };
}

function toRateSetView(
  set: {
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
  },
  isCurrent: boolean
): RateSetView {
  return {
    id: set.id,
    version: set.version,
    effectiveFrom: set.effectiveFrom,
    note: set.note,
    createdAt: set.createdAt,
    restaurantCommissionBp: set.restaurantCommissionBp,
    promotionalCommissionBp: set.promotionalCommissionBp,
    monthlySubscriptionMinor: set.monthlySubscriptionMinor,
    commissionOwnerAWeight: set.commissionOwnerAWeight,
    commissionOwnerBWeight: set.commissionOwnerBWeight,
    supermarketPartnerMarginBp: set.supermarketPartnerMarginBp,
    ownerAMarginBp: set.ownerAMarginBp,
    ownerBMarginBp: set.ownerBMarginBp,
    supermarketPartnerCostBp: set.supermarketPartnerCostBp,
    ownerACostBp: set.ownerACostBp,
    ownerBCostBp: set.ownerBCostBp,
    driverDeliveryShareBp: set.driverDeliveryShareBp,
    deliveryOpsRemainderWeight: set.deliveryOpsRemainderWeight,
    ownerADeliveryRemainderWeight: set.ownerADeliveryRemainderWeight,
    ownerBDeliveryRemainderWeight: set.ownerBDeliveryRemainderWeight,
    isCurrent
  };
}

function unique(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function sumAmounts(entries: { amountMinor: number }[]): number {
  return entries.reduce((sum, entry) => sum + entry.amountMinor, 0);
}

function monthLabel(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function operatingCostRaceLost(): ApiException {
  return new ApiException(
    409,
    "OPERATING_COST_ALREADY_DECIDED",
    "Someone else decided this cost first. Reload to see the outcome."
  );
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Turn the database's duplicate-key error into the API's own conflict, keeping the guarantee in
 *  the index rather than in a read-then-write that a concurrent request could slip between. */
function rethrowDuplicateReference(code: string, message: string) {
  return (error: unknown): never => {
    if (isUniqueViolation(error)) throw new ApiException(409, code, message);
    throw error;
  };
}

function rethrowDuplicate(code: string, message: string) {
  return (error: unknown): never => {
    if (isUniqueViolation(error)) throw new ApiException(409, code, message);
    throw error;
  };
}

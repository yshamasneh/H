import type { PrismaService } from "../prisma/prisma.service";

/**
 * The append-only triggers on the financial tables, lifted for the duration of a callback.
 *
 * Only end-to-end fixtures use this. Financial history refusing to be edited is the point of those
 * triggers, so removing them is deliberately an explicit, named, and temporary act rather than
 * something a stray DELETE can do — and it is restored even if the callback throws.
 *
 * Production data repair would take the same route: drop, fix, restore, in a migration somebody
 * has read. There is no path that quietly rewrites a ledger row.
 */
const immutableTables: [table: string, trigger: string][] = [
  ["PartnerEarning", "PartnerEarning_immutable"],
  ["OrderFinancialRecord", "OrderFinancialRecord_immutable"],
  ["CashSettlement", "CashSettlement_immutable"],
  ["CashSettlementAllocation", "CashSettlementAllocation_immutable"],
  ["PartnerSettlement", "PartnerSettlement_immutable"],
  ["PartnerSettlementAllocation", "PartnerSettlementAllocation_immutable"],
  ["FinancialAdjustment", "FinancialAdjustment_immutable"],
  ["FinancialRateSet", "FinancialRateSet_immutable"],
  ["DriverCashCustody", "DriverCashCustody_settlement_only"]
];

export async function withFinancialTriggersDisabled(
  prisma: PrismaService,
  work: () => Promise<void>
): Promise<void> {
  for (const [table, trigger] of immutableTables) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER "${trigger}"`);
  }
  try {
    await work();
  } finally {
    for (const [table, trigger] of immutableTables) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER "${trigger}"`);
    }
  }
}

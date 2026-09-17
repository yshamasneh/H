import assert from "node:assert/strict";
import { test } from "node:test";
import { PartnerAccountKind } from "../generated/prisma/enums";
import { requiredPartnerAccounts } from "./partner-account-invariants";
import { PartnerAccountsService } from "./partner-accounts.service";

type PartnerRow = {
  id: string;
  key: string;
  name: string;
  kind: PartnerAccountKind;
  isActive: boolean;
  businessId: string | null;
};

class FakePartnerPrisma {
  readonly rows: PartnerRow[];
  readonly partnerAccount = {} as any;

  constructor(rows: PartnerRow[] = []) {
    this.rows = rows;
    this.partnerAccount.findMany = async ({ where }: any) => {
      const keys: string[] | undefined = where?.key?.in;
      return this.rows.filter((row) => !keys || keys.includes(row.key)).map((row) => ({ ...row }));
    };
    this.partnerAccount.createMany = async ({ data, skipDuplicates }: any) => {
      await Promise.resolve();
      let count = 0;
      for (const entry of data) {
        if (this.rows.some((row) => row.key === entry.key)) {
          if (skipDuplicates) continue;
          throw new Error("duplicate key");
        }
        this.rows.push({
          id: `created-${entry.key}`,
          key: entry.key,
          name: entry.name,
          kind: entry.kind,
          isActive: true,
          businessId: null
        });
        count += 1;
      }
      return { count };
    };
  }

  async $transaction<T>(operation: (tx: this) => Promise<T>): Promise<T> {
    return operation(this);
  }
}

function validRows(): PartnerRow[] {
  return requiredPartnerAccounts.map((account) => ({
    id: `id-${account.key}`,
    key: account.key,
    name: account.name,
    kind: account.kind,
    isActive: true,
    businessId: null
  }));
}

test("all required fixed partner accounts satisfy the readiness invariant", async () => {
  const service = new PartnerAccountsService(new FakePartnerPrisma(validRows()) as never);
  const result = await service.validate();
  assert.equal(result.ready, true);
  assert.deepEqual(result.issues, []);
});

test("a missing required account fails validation", async () => {
  const service = new PartnerAccountsService(new FakePartnerPrisma(validRows().slice(1)) as never);
  const result = await service.validate();
  assert.equal(result.ready, false);
  assert.ok(result.issues.some((issue) => issue.code === "MISSING_REQUIRED_ACCOUNT"));
});

test("duplicate and inconsistent required accounts fail validation without automatic repair", async () => {
  const rows = validRows();
  rows.push({ ...rows[0], id: "duplicate-owner-a" });
  rows[1].kind = PartnerAccountKind.DELIVERY_OPS;
  rows[2].isActive = false;
  rows[2].businessId = "business-id";
  const prisma = new FakePartnerPrisma(rows);
  const service = new PartnerAccountsService(prisma as never);

  const result = await service.validate();

  assert.equal(result.ready, false);
  assert.deepEqual(
    new Set(result.issues.map((issue) => issue.code)),
    new Set([
      "DUPLICATE_REQUIRED_ACCOUNT",
      "REQUIRED_ACCOUNT_KIND_MISMATCH",
      "REQUIRED_ACCOUNT_INACTIVE",
      "REQUIRED_ACCOUNT_BUSINESS_SCOPED"
    ])
  );
  assert.equal(rows[1].kind, PartnerAccountKind.DELIVERY_OPS);
  assert.equal(rows[2].isActive, false);
});

test("dry-run reports missing accounts and modifies nothing", async () => {
  const prisma = new FakePartnerPrisma([]);
  const service = new PartnerAccountsService(prisma as never);
  const result = await service.reconcile({ dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(result.created, 0);
  assert.equal(result.missingKeys.length, 3);
  assert.equal(prisma.rows.length, 0);
});

test("concurrent apply reconciliation cannot create duplicate reference accounts", async () => {
  const prisma = new FakePartnerPrisma([]);
  const first = new PartnerAccountsService(prisma as never);
  const second = new PartnerAccountsService(prisma as never);

  await Promise.all([
    first.reconcile({ dryRun: false }),
    second.reconcile({ dryRun: false })
  ]);

  assert.equal(prisma.rows.length, 3);
  assert.equal(new Set(prisma.rows.map((row) => row.key)).size, 3);
  assert.equal((await first.validate()).ready, true);
});

test("startup invariant logs are structured and omit names, balances, and raw errors", async () => {
  const prisma = new FakePartnerPrisma([]);
  const service = new PartnerAccountsService(prisma as never);
  const logs: string[] = [];
  (service as any).logger = { warn: (line: string) => logs.push(line) };

  await service.onModuleInit();

  assert.equal(logs.length, 1);
  assert.match(logs[0], /partner_account_invariant_failed/);
  assert.doesNotMatch(logs[0], /Mohammad|Khaldoun|Abdullah|amount|balance/i);
});

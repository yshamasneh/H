import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { PartnerAccountsService } from "../src/accounting/partner-accounts.service";

dotenv.config({ path: "../../.env" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const apply = process.argv.includes("--apply");
if (apply && process.argv.includes("--dry-run")) {
  throw new Error("Choose either --dry-run or --apply, not both");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
async function main(): Promise<void> {
  try {
    const service = new PartnerAccountsService(prisma as never);
    const result = await service.reconcile({ dryRun: !apply });
    console.log(JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      created: result.created,
      missingKeys: result.missingKeys,
      ready: result.validation.ready,
      issues: result.validation.issues
    }, null, 2));
    if (!result.validation.ready) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch(() => {
  console.error("Partner-account reconciliation failed; verify database access and rerun in dry-run mode.");
  process.exitCode = 1;
});

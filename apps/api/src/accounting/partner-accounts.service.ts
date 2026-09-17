import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  inspectPartnerAccountInvariants,
  requiredPartnerAccounts,
  type PartnerAccountInvariantRow
} from "./partner-account-invariants";

type PartnerAccountClient = Pick<Prisma.TransactionClient, "partnerAccount">;

/** Validates and safely creates only the fixed reference identities used by the revenue model. */
@Injectable()
export class PartnerAccountsService implements OnModuleInit {
  private readonly logger = new Logger(PartnerAccountsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      const result = await this.validate();
      if (!result.ready) this.logInvalid(result.issues.map((issue) => issue.code));
    } catch {
      this.logger.warn(JSON.stringify({
        event: "partner_account_validation_unavailable",
        code: "REFERENCE_DATA_CHECK_FAILED"
      }));
    }
  }

  /** Read on every readiness request, so readiness automatically recovers after an operator fix. */
  async validate(client: PartnerAccountClient = this.prisma) {
    const rows = await client.partnerAccount.findMany({
      where: { key: { in: requiredPartnerAccounts.map((account) => account.key) } },
      select: { id: true, key: true, kind: true, isActive: true, businessId: true }
    });
    return inspectPartnerAccountInvariants(rows as PartnerAccountInvariantRow[]);
  }

  /**
   * Dry-run by default. Apply mode creates missing identities only; it never changes an existing
   * account, user link, balance, earning, settlement, name, kind, or active state.
   */
  async reconcile(options: { dryRun?: boolean } = {}) {
    const dryRun = options.dryRun ?? true;
    const before = await this.validate();
    const missingKeys = before.issues
      .filter((issue) => issue.code === "MISSING_REQUIRED_ACCOUNT")
      .map((issue) => issue.key);

    if (dryRun || missingKeys.length === 0) {
      return { dryRun, created: 0, missingKeys, validation: before };
    }

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.partnerAccount.createMany({
        data: requiredPartnerAccounts
          .filter((account) => missingKeys.includes(account.key))
          .map((account) => ({ ...account })),
        skipDuplicates: true
      });
      const validation = await this.validate(tx);
      return { dryRun: false, created: result.count, missingKeys, validation };
    });
  }

  logInvalid(issueCodes: string[]): void {
    this.logger.warn(JSON.stringify({
      event: "partner_account_invariant_failed",
      issueCount: issueCodes.length,
      issueCodes: [...new Set(issueCodes)].sort()
    }));
  }
}

import { PartnerAccountKind } from "../generated/prisma/enums";
import { partnerKeys } from "./accounting.rules";

export const requiredPartnerAccounts = [
  {
    key: partnerKeys.ownerA,
    name: "Mohammad (platform owner)",
    kind: PartnerAccountKind.PLATFORM_OWNER
  },
  {
    key: partnerKeys.ownerB,
    name: "Khaldoun (platform owner)",
    kind: PartnerAccountKind.PLATFORM_OWNER
  },
  {
    key: partnerKeys.deliveryOps,
    name: "Abdullah (delivery operations)",
    kind: PartnerAccountKind.DELIVERY_OPS
  },
  {
    key: partnerKeys.platformRounding,
    name: "JOVO platform (cash rounding)",
    kind: PartnerAccountKind.PLATFORM_ACCOUNT
  }
] as const;

export type PartnerAccountInvariantIssueCode =
  | "MISSING_REQUIRED_ACCOUNT"
  | "DUPLICATE_REQUIRED_ACCOUNT"
  | "REQUIRED_ACCOUNT_KIND_MISMATCH"
  | "REQUIRED_ACCOUNT_INACTIVE"
  | "REQUIRED_ACCOUNT_BUSINESS_SCOPED"
  | "REQUIRED_ACCOUNT_ID_REUSED";

export type PartnerAccountInvariantIssue = {
  code: PartnerAccountInvariantIssueCode;
  key: string;
};

export type PartnerAccountInvariantRow = {
  id: string;
  key: string;
  kind: PartnerAccountKind;
  isActive: boolean;
  businessId: string | null;
};

export function inspectPartnerAccountInvariants(rows: PartnerAccountInvariantRow[]) {
  const issues: PartnerAccountInvariantIssue[] = [];
  const requiredIds = new Map<string, string>();

  for (const expected of requiredPartnerAccounts) {
    const matches = rows.filter((row) => row.key === expected.key);
    if (matches.length === 0) {
      issues.push({ code: "MISSING_REQUIRED_ACCOUNT", key: expected.key });
      continue;
    }
    if (matches.length > 1) {
      issues.push({ code: "DUPLICATE_REQUIRED_ACCOUNT", key: expected.key });
    }
    const account = matches[0]!;
    if (account.kind !== expected.kind) {
      issues.push({ code: "REQUIRED_ACCOUNT_KIND_MISMATCH", key: expected.key });
    }
    if (!account.isActive) {
      issues.push({ code: "REQUIRED_ACCOUNT_INACTIVE", key: expected.key });
    }
    if (account.businessId !== null) {
      issues.push({ code: "REQUIRED_ACCOUNT_BUSINESS_SCOPED", key: expected.key });
    }
    const previousKey = requiredIds.get(account.id);
    if (previousKey && previousKey !== expected.key) {
      issues.push({ code: "REQUIRED_ACCOUNT_ID_REUSED", key: expected.key });
    } else {
      requiredIds.set(account.id, expected.key);
    }
  }

  return { ready: issues.length === 0, issues };
}

/**
 * Account deletion for every self-service role (store audit H1).
 *
 * Deletion means anonymisation of the person, never removal of business records: orders, deliveries,
 * cash custody, settlements and earnings stay exactly as they are (they reference the user id, which
 * is kept), but the name, phone, password, addresses, push tokens, sessions and driver position are
 * erased. Financial records are only READ here, to decide whether the person can be erased yet.
 */

export type DeletionBlocker = "ACTIVE_DELIVERY" | "OUTSTANDING_CASH" | "UNSETTLED_EARNINGS";

/** Facts read (never written) from the delivery and accounting tables for one driver. */
export type DriverObligations = {
  activeDeliveries: number;
  unsettledCashCustodies: number;
  /** Driver earnings minus payouts for payee key DRIVER:<id>, as the accounting service computes it. */
  earningsBalanceMinor: number;
};

/**
 * Why a driver cannot be erased yet. Each blocker needs the driver's identity to resolve: an active
 * delivery is in their hands, cash they collected must be handed over, and earnings JOVO owes them
 * (or a payout above what they earned) must be settled with them.
 */
export function driverDeletionBlockers(facts: DriverObligations): DeletionBlocker[] {
  const blockers: DeletionBlocker[] = [];
  if (facts.activeDeliveries > 0) blockers.push("ACTIVE_DELIVERY");
  if (facts.unsettledCashCustodies > 0) blockers.push("OUTSTANDING_CASH");
  if (facts.earningsBalanceMinor !== 0) blockers.push("UNSETTLED_EARNINGS");
  return blockers;
}

/** The default number of days between a blocked request and the date shown to the person. */
export const defaultDeletionScheduleDays = 30;

export function deletionScheduleDate(now: Date, days: number): Date {
  const safeDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : defaultDeletionScheduleDays;
  return new Date(now.getTime() + safeDays * 24 * 60 * 60 * 1000);
}

/** The anonymised identity written over a deleted account (phone stays unique per user id). */
export function anonymisedIdentity(userId: string) {
  return {
    fullName: "Deleted account",
    phone: `deleted-${userId}`,
    email: null,
    passwordHash: "DELETED",
    isActive: false
  } as const;
}

export type AccountDeletionOutcome =
  | { status: "DELETED" }
  | { status: "SCHEDULED"; scheduledFor: string; blockers: DeletionBlocker[] };

/** What every accounting section is handed by the page that hosts it. */
export type SectionProps = {
  /** Report a failed load to the page-level banner. */
  onError: (error: unknown, fallback: string) => void;
  /** Bumped by the page after a write, so every section refetches. */
  reloadToken: number;
  /** Tell the page a write happened, so the overview and the other tabs refresh. */
  onChanged?: () => void;
};

/**
 * A key that is stable for the lifetime of one form and unique enough across operators, used as
 * the idempotency reference. The server refuses a repeated reference, so a double-click or a retry
 * after a dropped connection cannot record the same payout or handover twice.
 */
export function suggestReference(prefix: string, date: Date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${day}-${random}`;
}

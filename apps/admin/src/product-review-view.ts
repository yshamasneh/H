import { parseMoneyToMinor } from "./money";
import type { ApproveOutcome, ReviewQueueItem } from "./api.products";

/** Pure helpers for the product review page (run 3, task 2). */
export type ReviewFilter = "PENDING_REVIEW" | "APPROVED" | "ALL";

export function queryForFilter(filter: ReviewFilter, search: string, page: number) {
  return {
    reviewStatus: filter === "ALL" ? undefined : filter,
    search: search.trim() || undefined,
    page,
    pageSize: 50
  };
}

/** Toggling the header checkbox selects every pending product on the page, or clears them. */
export function toggleAll(selected: Set<string>, items: ReviewQueueItem[]): Set<string> {
  const pending = items.filter((item) => item.reviewStatus === "PENDING_REVIEW").map((item) => item.id);
  const allSelected = pending.length > 0 && pending.every((id) => selected.has(id));
  return allSelected ? new Set() : new Set(pending);
}

export function toggleOne(selected: Set<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export type ProductEditDraft = { name: string; description: string; brand: string; categoryId: string; price: string };

/**
 * The PATCH body for the existing admin product route, holding only what changed. Returns null
 * when the price cannot be read, so the page can show an error instead of sending a guess.
 */
export function editBody(item: ReviewQueueItem, draft: ProductEditDraft): Record<string, unknown> | null {
  const body: Record<string, unknown> = {};
  if (draft.name.trim() && draft.name.trim() !== item.name) body.name = draft.name.trim();
  if (draft.description.trim() !== (item.description ?? "")) body.description = draft.description.trim() || null;
  if (draft.brand.trim() !== (item.brand ?? "")) body.brand = draft.brand.trim() || null;
  if (draft.categoryId && draft.categoryId !== item.categoryId) body.categoryId = draft.categoryId;
  const priceMinor = parseMoneyToMinor(draft.price);
  if (priceMinor === null || priceMinor <= 0) return null;
  if (priceMinor !== item.priceMinor) body.priceMinor = priceMinor;
  return body;
}

/** A one-line summary of a bulk approval for the notice banner. */
export function approvalSummary(outcome: ApproveOutcome): { approved: number; refused: number; skipped: number } {
  return { approved: outcome.approved.length, refused: outcome.refused.length, skipped: outcome.alreadyApproved.length + outcome.notFound.length };
}

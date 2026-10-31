import { request, toQuery } from "./api";

/** Run 3, task 2: the cross-store product review queue (GET /admin/products, POST /admin/products/approve). */
export type ReviewStatus = "PENDING_REVIEW" | "APPROVED";

export type ReviewQueueItem = {
  id: string;
  restaurantId: string;
  restaurantName: string;
  categoryId: string;
  categoryName: string;
  name: string;
  description: string | null;
  brand: string | null;
  barcode: string | null;
  sku: string | null;
  priceMinor: number;
  imageUrl: string | null;
  isAvailable: boolean;
  reviewStatus: ReviewStatus;
  reviewedAt: string | null;
};

export type ReviewQueuePage = { items: ReviewQueueItem[]; page: number; pageSize: number; total: number; pendingReviewCount: number };
export type ApproveOutcome = { approved: string[]; alreadyApproved: string[]; notFound: string[]; refused: Array<{ id: string; matches: string[] }> };

export function listReviewQueue(params: { reviewStatus?: ReviewStatus; search?: string; page?: number; pageSize?: number }): Promise<ReviewQueuePage> {
  return request<ReviewQueuePage>(`/api/v1/admin/products${toQuery(params)}`);
}

export function approveProducts(itemIds: string[]): Promise<ApproveOutcome> {
  return request<ApproveOutcome>("/api/v1/admin/products/approve", { method: "POST", body: { itemIds } });
}

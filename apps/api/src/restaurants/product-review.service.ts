import { Injectable } from "@nestjs/common";
import { classifyRestricted } from "../catalogue/restricted-products.rules";
import { writeAuditLog } from "../common/audit-log.util";
import { ApiException } from "../common/api.exception";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Run 3, task 2: the administrator's catalogue review queue across stores. Listing and approving
 * only; editing reuses the existing admin product route (PATCH /admin/restaurants/:id/menu/items/:id)
 * with all of its rules (restricted-product screening, price permission, image allow-list).
 */
export type ReviewQueueQuery = {
  reviewStatus?: "PENDING_REVIEW" | "APPROVED";
  search?: string;
  restaurantId?: string;
  page: number;
  pageSize: number;
};

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
  reviewStatus: "PENDING_REVIEW" | "APPROVED";
  reviewedAt: Date | null;
};

export type ApproveOutcome = { approved: string[]; alreadyApproved: string[]; notFound: string[]; refused: Array<{ id: string; matches: string[] }> };

@Injectable()
export class ProductReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ReviewQueueQuery) {
    const search = query.search?.trim();
    const where: Prisma.MenuItemWhereInput = {
      ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
      ...(query.restaurantId ? { restaurantId: query.restaurantId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              // Barcodes are strings; an exact match finds leading-zero codes reliably.
              { barcode: search },
              { barcode: { startsWith: search } },
              { sku: { contains: search, mode: "insensitive" as const } }
            ]
          }
        : {})
    };
    const [rows, total, pendingReviewCount] = await Promise.all([
      this.prisma.menuItem.findMany({
        where,
        include: { restaurant: { select: { name: true } }, category: { select: { name: true } } },
        orderBy: [{ reviewStatus: "asc" }, { createdAt: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      this.prisma.menuItem.count({ where }),
      this.prisma.menuItem.count({ where: { reviewStatus: "PENDING_REVIEW", ...(query.restaurantId ? { restaurantId: query.restaurantId } : {}) } })
    ]);
    const items: ReviewQueueItem[] = rows.map((row) => ({
      id: row.id,
      restaurantId: row.restaurantId,
      restaurantName: row.restaurant.name,
      categoryId: row.categoryId,
      categoryName: row.category.name,
      name: row.name,
      description: row.description,
      brand: row.brand,
      barcode: row.barcode,
      sku: row.sku,
      priceMinor: row.priceMinor,
      imageUrl: row.imageUrl,
      isAvailable: row.isAvailable,
      reviewStatus: row.reviewStatus,
      reviewedAt: row.reviewedAt
    }));
    return { items, page: query.page, pageSize: query.pageSize, total, pendingReviewCount };
  }

  /**
   * Approves one or many products. A product whose stored text is on the tobacco, nicotine, vaping
   * or alcohol deny-list is refused and reported, never approved. Audited as one entry.
   */
  async approve(actorUserId: string, itemIds: string[]): Promise<ApproveOutcome> {
    const unique = [...new Set(itemIds)];
    if (unique.length === 0) throw new ApiException(400, "NO_PRODUCTS_SELECTED", "Choose at least one product.");
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.menuItem.findMany({
        where: { id: { in: unique } },
        select: { id: true, name: true, brand: true, description: true, reviewStatus: true }
      });
      const found = new Set(rows.map((row) => row.id));
      const outcome: ApproveOutcome = { approved: [], alreadyApproved: [], notFound: unique.filter((id) => !found.has(id)), refused: [] };
      const toApprove: string[] = [];
      for (const row of rows) {
        if (row.reviewStatus === "APPROVED") {
          outcome.alreadyApproved.push(row.id);
          continue;
        }
        const screening = classifyRestricted(row.name, row.brand, row.description);
        if (screening.verdict === "BLOCKED") outcome.refused.push({ id: row.id, matches: screening.matches });
        else toApprove.push(row.id);
      }
      if (toApprove.length > 0) {
        const now = new Date();
        await tx.menuItem.updateMany({
          where: { id: { in: toApprove }, reviewStatus: "PENDING_REVIEW" },
          data: { reviewStatus: "APPROVED", reviewedAt: now, reviewedByUserId: actorUserId }
        });
        outcome.approved = toApprove;
        await writeAuditLog(tx, {
          actorUserId,
          action: "PRODUCTS_APPROVED",
          entityType: "MenuItem",
          entityId: toApprove[0],
          reason: null,
          metadata: { itemIds: toApprove, count: toApprove.length }
        });
      }
      return outcome;
    });
  }
}

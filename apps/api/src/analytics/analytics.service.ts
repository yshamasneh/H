import { Injectable } from "@nestjs/common";
import { ApiException } from "../common/api.exception";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { exactNumber, foldHourBuckets, ratioBp } from "./analytics.calc";
import type { AnalyticsPeriodQueryDto, TopProductsQueryDto } from "./analytics.dto";
import { analyticsTimeZone, nextLocalDate, parseLocalDate, startOfLocalDayUtc } from "./analytics.time";
import type {
  AnalyticsPeriod,
  CustomerRetentionView,
  PeakTimesView,
  TopProductsView
} from "./analytics.types";

type ResolvedPeriod = { view: AnalyticsPeriod; from: Date | null; to: Date | null };

/**
 * Platform analytics for administrators. Every figure counts DELIVERED orders only: an order that
 * was cancelled, rejected, failed at the door or is still open was not a sale.
 *
 * All three reports are aggregated inside PostgreSQL; no order rows are loaded into memory. The
 * largest result any of them returns is one row per product sold, or one row per UTC hour that had
 * a delivered order in the period.
 *
 * Timestamps are stored as UTC `timestamp` values. Period bounds are therefore passed in as UTC
 * instants and converted with `AT TIME ZONE 'UTC'`, which keeps every comparison correct whatever
 * time zone the database session happens to run in.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Products ranked by quantity sold (or revenue), with quantity and revenue.
   *
   * A line counts as what was actually delivered: when packing re-weighed or substituted it (an
   * APPROVED fulfillment adjustment), the packed product, packed quantity and re-priced line total
   * are used — the same effective line the order total was recomputed from. Otherwise it is the
   * ordered product, quantity, and price charged (the sale price when one was on).
   *
   * Revenue is the sum of those line amounts in agorot: goods only, before order-level discounts
   * and without the delivery fee, because an order-level discount belongs to the order rather than
   * to any one product and cannot be split between products without rounding.
   */
  async topProducts(query: TopProductsQueryDto): Promise<TopProductsView> {
    const period = resolvePeriod(query);
    const sortBy = query.sortBy ?? "quantity";
    const limit = query.limit ?? 20;
    const lines = Prisma.sql`
      WITH lines AS (
        SELECT
          CASE WHEN fa."status" = 'APPROVED' THEN COALESCE(fa."replacementMenuItemId", oi."menuItemId")
               ELSE oi."menuItemId" END AS "menuItemId",
          CASE WHEN fa."status" = 'APPROVED' THEN fa."actualQuantityMilli"::bigint
               ELSE oi."quantity"::bigint * 1000 END AS "quantityMilli",
          CASE WHEN fa."status" = 'APPROVED' THEN fa."lineTotalMinor"::bigint
               ELSE oi."priceMinorSnapshot"::bigint * oi."quantity"::bigint END AS "revenueMinor",
          o."id" AS "orderId"
        FROM "OrderItem" oi
        JOIN "Order" o ON o."id" = oi."orderId"
        LEFT JOIN "FulfillmentAdjustment" fa ON fa."orderItemId" = oi."id"
        WHERE ${deliveredOrdersWhere(period, query.restaurantId)}
      )`;
    // Only these two fixed strings ever reach Prisma.raw.
    const orderBy =
      sortBy === "revenue"
        ? Prisma.raw(`"revenueMinor" DESC, "quantityMilli" DESC`)
        : Prisma.raw(`"quantityMilli" DESC, "revenueMinor" DESC`);

    const [rows, totals] = await Promise.all([
      this.prisma.$queryRaw<
        { menuItemId: string; name: string; unitLabel: string; quantityMilli: bigint; revenueMinor: bigint; orders: bigint }[]
      >`
        ${lines}
        SELECT l."menuItemId", m."name", m."unitLabel",
               SUM(l."quantityMilli")::bigint AS "quantityMilli",
               SUM(l."revenueMinor")::bigint AS "revenueMinor",
               COUNT(DISTINCT l."orderId")::bigint AS "orders"
        FROM lines l
        JOIN "MenuItem" m ON m."id" = l."menuItemId"
        GROUP BY l."menuItemId", m."name", m."unitLabel"
        ORDER BY ${orderBy}, m."name" ASC, l."menuItemId" ASC
        LIMIT ${limit}
      `,
      this.prisma.$queryRaw<{ deliveredOrders: bigint; productsSold: bigint; revenueMinor: bigint | null }[]>`
        ${lines}
        SELECT COUNT(DISTINCT l."orderId")::bigint AS "deliveredOrders",
               COUNT(DISTINCT l."menuItemId")::bigint AS "productsSold",
               COALESCE(SUM(l."revenueMinor"), 0)::bigint AS "revenueMinor"
        FROM lines l
      `
    ]);

    return {
      period: period.view,
      sortBy,
      totals: {
        deliveredOrders: exactNumber(totals[0]?.deliveredOrders),
        productsSold: exactNumber(totals[0]?.productsSold),
        revenueMinor: exactNumber(totals[0]?.revenueMinor)
      },
      items: rows.map((row, index) => ({
        rank: index + 1,
        menuItemId: row.menuItemId,
        name: row.name,
        unitLabel: row.unitLabel,
        quantityMilli: exactNumber(row.quantityMilli),
        revenueMinor: exactNumber(row.revenueMinor),
        orders: exactNumber(row.orders)
      }))
    };
  }

  /**
   * Delivered orders by local hour of day and weekday, in Asia/Hebron time.
   *
   * PostgreSQL counts orders per UTC hour (at most one row per hour in the period); each bucket is
   * then placed on its local hour and weekday with the IANA rules (see analytics.time.ts), so an
   * order just after local midnight lands on the new day even though it is still the previous day
   * in UTC.
   */
  async peakTimes(query: AnalyticsPeriodQueryDto): Promise<PeakTimesView> {
    const period = resolvePeriod(query);
    const buckets = await this.prisma.$queryRaw<{ bucket: bigint; orders: bigint }[]>`
      SELECT EXTRACT(EPOCH FROM date_trunc('hour', o."createdAt"))::bigint AS "bucket",
             COUNT(*)::bigint AS "orders"
      FROM "Order" o
      WHERE ${deliveredOrdersWhere(period, query.restaurantId)}
      GROUP BY 1
    `;
    return {
      period: period.view,
      ...foldHourBuckets(
        buckets.map((bucket) => ({ bucketEpochSeconds: exactNumber(bucket.bucket), orders: exactNumber(bucket.orders) }))
      )
    };
  }

  /**
   * Returning versus one-time customers among everyone with a delivered order in the period:
   * two or more delivered orders in the period is returning, exactly one is one-time. With no
   * period that is every customer's whole history.
   */
  async customerRetention(query: AnalyticsPeriodQueryDto): Promise<CustomerRetentionView> {
    const period = resolvePeriod(query);
    const [row] = await this.prisma.$queryRaw<
      { customers: bigint; returning: bigint; deliveredOrders: bigint | null; fromReturning: bigint | null }[]
    >`
      SELECT COUNT(*)::bigint AS "customers",
             COUNT(*) FILTER (WHERE per."orders" >= 2)::bigint AS "returning",
             COALESCE(SUM(per."orders"), 0)::bigint AS "deliveredOrders",
             COALESCE(SUM(per."orders") FILTER (WHERE per."orders" >= 2), 0)::bigint AS "fromReturning"
      FROM (
        SELECT o."customerId", COUNT(*) AS "orders"
        FROM "Order" o
        WHERE ${deliveredOrdersWhere(period, query.restaurantId)}
        GROUP BY o."customerId"
      ) per
    `;
    const customers = exactNumber(row?.customers);
    const returningCustomers = exactNumber(row?.returning);
    return {
      period: period.view,
      customers,
      oneTimeCustomers: customers - returningCustomers,
      returningCustomers,
      returningRateBp: ratioBp(returningCustomers, customers),
      deliveredOrders: exactNumber(row?.deliveredOrders),
      ordersFromReturningCustomers: exactNumber(row?.fromReturning)
    };
  }
}

function deliveredOrdersWhere(period: ResolvedPeriod, restaurantId: string | undefined): Prisma.Sql {
  const conditions = [Prisma.sql`o."status" = 'DELIVERED'`];
  if (period.from) conditions.push(Prisma.sql`o."createdAt" >= (${period.from.toISOString()}::timestamptz AT TIME ZONE 'UTC')`);
  if (period.to) conditions.push(Prisma.sql`o."createdAt" < (${period.to.toISOString()}::timestamptz AT TIME ZONE 'UTC')`);
  if (restaurantId) conditions.push(Prisma.sql`o."restaurantId" = ${restaurantId}::uuid`);
  return Prisma.join(conditions, " AND ");
}

/** Local calendar days to UTC instants: from the start of `fromDate` to the start of the day after `toDate`. */
export function resolvePeriod(query: { fromDate?: string; toDate?: string }): ResolvedPeriod {
  const fromDay = query.fromDate ? parseLocalDate(query.fromDate) : null;
  const toDay = query.toDate ? parseLocalDate(query.toDate) : null;
  if ((query.fromDate && !fromDay) || (query.toDate && !toDay)) {
    throw new ApiException(400, "INVALID_ANALYTICS_DATE", "Dates must be real calendar days written as YYYY-MM-DD.");
  }
  const from = fromDay ? startOfLocalDayUtc(fromDay) : null;
  const to = toDay ? startOfLocalDayUtc(nextLocalDate(toDay)) : null;
  if (from && to && from >= to) {
    throw new ApiException(400, "INVALID_ANALYTICS_PERIOD", "The period must start on or before the day it ends.");
  }
  return {
    from,
    to,
    view: {
      fromDate: query.fromDate ?? null,
      toDate: query.toDate ?? null,
      fromUtc: from?.toISOString() ?? null,
      toUtcExclusive: to?.toISOString() ?? null,
      timeZone: analyticsTimeZone
    }
  };
}

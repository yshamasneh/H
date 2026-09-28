import type { PeakTimes } from "./analytics.calc";

/** The resolved period, echoed back so the screen can say exactly what it is showing. */
export type AnalyticsPeriod = {
  fromDate: string | null;
  toDate: string | null;
  /** UTC instants the local days resolved to: from inclusive, to exclusive. */
  fromUtc: string | null;
  toUtcExclusive: string | null;
  timeZone: string;
};

export type TopProductRow = {
  rank: number;
  menuItemId: string;
  name: string;
  unitLabel: string;
  /** Thousandths of a unit: 3 items = 3000, 1.25 kg = 1250. Re-weighed lines count what was packed. */
  quantityMilli: number;
  /** Line amounts charged for this product, in agorot. See AnalyticsService.topProducts. */
  revenueMinor: number;
  /** Delivered orders containing this product. */
  orders: number;
};

export type TopProductsView = {
  period: AnalyticsPeriod;
  sortBy: "quantity" | "revenue";
  /** Across every product sold in the period, not only the rows returned. */
  totals: { deliveredOrders: number; productsSold: number; revenueMinor: number };
  items: TopProductRow[];
};

export type PeakTimesView = PeakTimes & { period: AnalyticsPeriod };

export type CustomerRetentionView = {
  period: AnalyticsPeriod;
  /** Customers with at least one DELIVERED order in the period. */
  customers: number;
  /** Exactly one DELIVERED order in the period. */
  oneTimeCustomers: number;
  /** Two or more DELIVERED orders in the period. */
  returningCustomers: number;
  /** returningCustomers / customers, in basis points (10000 = 100%), rounded half up. */
  returningRateBp: number;
  deliveredOrders: number;
  ordersFromReturningCustomers: number;
};

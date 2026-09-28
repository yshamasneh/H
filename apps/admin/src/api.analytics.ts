import { request, toQuery } from "./api";

/**
 * Platform analytics (DELIVERED orders only). Amounts are agorot and quantities thousandths of a
 * unit, both integers; formatting happens once, at display.
 */

export type AnalyticsPeriodParams = { fromDate?: string; toDate?: string; restaurantId?: string };

export type AnalyticsPeriod = {
  fromDate: string | null;
  toDate: string | null;
  fromUtc: string | null;
  toUtcExclusive: string | null;
  timeZone: string;
};

export type TopProductRow = {
  rank: number;
  menuItemId: string;
  name: string;
  unitLabel: string;
  quantityMilli: number;
  revenueMinor: number;
  orders: number;
};

export type TopProductsView = {
  period: AnalyticsPeriod;
  sortBy: "quantity" | "revenue";
  totals: { deliveredOrders: number; productsSold: number; revenueMinor: number };
  items: TopProductRow[];
};

export type PeakTimesView = {
  period: AnalyticsPeriod;
  totalOrders: number;
  byHour: { hour: number; orders: number }[];
  /** 0 = Sunday … 6 = Saturday. */
  byWeekday: { weekday: number; orders: number }[];
  byWeekdayHour: number[][];
};

export type CustomerRetentionView = {
  period: AnalyticsPeriod;
  customers: number;
  oneTimeCustomers: number;
  returningCustomers: number;
  returningRateBp: number;
  deliveredOrders: number;
  ordersFromReturningCustomers: number;
};

export function getTopProducts(
  params: AnalyticsPeriodParams & { sortBy?: "quantity" | "revenue"; limit?: number }
): Promise<TopProductsView> {
  return request(`/api/v1/admin/analytics/top-products${toQuery(params)}`);
}

export function getPeakTimes(params: AnalyticsPeriodParams): Promise<PeakTimesView> {
  return request(`/api/v1/admin/analytics/peak-times${toQuery(params)}`);
}

export function getCustomerRetention(params: AnalyticsPeriodParams): Promise<CustomerRetentionView> {
  return request(`/api/v1/admin/analytics/customer-retention${toQuery(params)}`);
}

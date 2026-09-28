import type { AdminAccess, AdminAccountingOverview, AdminDashboard } from "../../core/api";
import { hasAdminPermission } from "./users.rules";

/**
 * What the admin dashboard puts first on the phone: the things waiting on an administrator, each
 * leading to the screen where it is dealt with. Mirrors apps/admin/src/dashboard-attention.ts; the
 * destinations are the mobile screens. An item an account could not act on is never shown.
 */

export type AttentionDestination = "orders-placed" | "stores-pending" | "drivers-pending" | "costs" | "driver-cash" | "web-accounting";

export type AttentionItem = {
  key: "ordersAwaiting" | "pendingStores" | "pendingDrivers" | "pendingCosts" | "driverCash" | "ledgerImbalance" | "costData";
  value: number;
  isMoney?: boolean;
  tone: "waiting" | "problem";
  destination: AttentionDestination;
};

export function attentionItems(
  dashboard: Pick<AdminDashboard, "pendingRestaurantApprovals" | "pendingDriverApprovals" | "ordersAwaitingAcceptance">,
  books: Pick<AdminAccountingOverview, "cashOutstandingMinor" | "pendingOperatingCostCount" | "ledgerImbalanceMinor" | "costDataIncompleteCount"> | null,
  access: AdminAccess | null
): AttentionItem[] {
  const items: AttentionItem[] = [];
  const add = (item: AttentionItem, permission: string) => {
    if (item.value !== 0 && hasAdminPermission(access, permission)) items.push(item);
  };
  add({ key: "ordersAwaiting", value: dashboard.ordersAwaitingAcceptance ?? 0, tone: "waiting", destination: "orders-placed" }, "VIEW_ALL_ORDERS");
  add({ key: "pendingStores", value: dashboard.pendingRestaurantApprovals, tone: "waiting", destination: "stores-pending" }, "MANAGE_BUSINESSES");
  add({ key: "pendingDrivers", value: dashboard.pendingDriverApprovals ?? 0, tone: "waiting", destination: "drivers-pending" }, "MANAGE_DRIVERS");
  if (books) {
    // Ledger problems are investigated on the web console, where the full books are.
    add({ key: "ledgerImbalance", value: books.ledgerImbalanceMinor, isMoney: true, tone: "problem", destination: "web-accounting" }, "VIEW_ACCOUNTING");
    add({ key: "costData", value: books.costDataIncompleteCount, tone: "problem", destination: "web-accounting" }, "VIEW_ACCOUNTING");
    add({ key: "pendingCosts", value: books.pendingOperatingCostCount, tone: "waiting", destination: "costs" }, "VIEW_ACCOUNTING");
    add({ key: "driverCash", value: books.cashOutstandingMinor, isMoney: true, tone: "waiting", destination: "driver-cash" }, "VIEW_ACCOUNTING");
  }
  return [...items.filter((item) => item.tone === "problem"), ...items.filter((item) => item.tone === "waiting")];
}

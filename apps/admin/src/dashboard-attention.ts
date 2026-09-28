import type { Permission } from "./api";

/**
 * What the dashboard puts first: the things waiting on an administrator, each with where to go to
 * deal with it. Pure, so the rules — who sees which item, what counts as "needs attention" — are
 * tested without a browser. Items the signed-in account could not act on are never shown.
 */

export type AttentionInputs = {
  ordersAwaitingAcceptance?: number;
  pendingRestaurantApprovals: number;
  pendingDriverApprovals?: number;
  /** From the accounting overview; absent when the account cannot read the books. */
  accounting?: {
    cashOutstandingMinor: number;
    pendingOperatingCostCount: number;
    ledgerImbalanceMinor: number;
    costDataIncompleteCount: number;
  } | null;
};

export type AttentionItem = {
  key: "ordersAwaiting" | "pendingStores" | "pendingDrivers" | "pendingCosts" | "driverCash" | "ledgerImbalance" | "costData";
  /** A count, or an amount in agorot when `isMoney`. */
  value: number;
  isMoney?: boolean;
  /** Something is wrong, not merely waiting. */
  tone: "waiting" | "problem";
  to: string;
};

export function attentionItems(input: AttentionInputs, can: (permission: Permission) => boolean): AttentionItem[] {
  const items: AttentionItem[] = [];
  const add = (item: AttentionItem, permission: Permission) => {
    if (item.value !== 0 && can(permission)) items.push(item);
  };
  add({ key: "ordersAwaiting", value: input.ordersAwaitingAcceptance ?? 0, tone: "waiting", to: "/orders?status=PLACED" }, "VIEW_ALL_ORDERS");
  add({ key: "pendingStores", value: input.pendingRestaurantApprovals, tone: "waiting", to: "/restaurants?status=PENDING" }, "MANAGE_BUSINESSES");
  add({ key: "pendingDrivers", value: input.pendingDriverApprovals ?? 0, tone: "waiting", to: "/drivers" }, "MANAGE_DRIVERS");
  const books = input.accounting;
  if (books) {
    add({ key: "ledgerImbalance", value: books.ledgerImbalanceMinor, isMoney: true, tone: "problem", to: "/accounting" }, "VIEW_ACCOUNTING");
    add({ key: "costData", value: books.costDataIncompleteCount, tone: "problem", to: "/accounting" }, "VIEW_ACCOUNTING");
    add({ key: "pendingCosts", value: books.pendingOperatingCostCount, tone: "waiting", to: "/accounting?tab=costs" }, "VIEW_ACCOUNTING");
    add({ key: "driverCash", value: books.cashOutstandingMinor, isMoney: true, tone: "waiting", to: "/accounting?tab=cash" }, "VIEW_ACCOUNTING");
  }
  // Problems before things that are merely waiting.
  return [...items.filter((item) => item.tone === "problem"), ...items.filter((item) => item.tone === "waiting")];
}

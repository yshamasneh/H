import type { OrderDetail, OrderStatusValue } from "../../core/api";

/**
 * The store's live order queue as pure logic, testable without React Native: which section each
 * order belongs to, which order the new-order popup shows, and how often the alert repeats. The
 * admin console runs the same rules (apps/admin/src/order-queue.ts), so a phone and a tablet on the
 * same store behave identically.
 *
 * Sections are the non-terminal OrderStatus values a store handles, in workflow order.
 */
export const queueSectionStatuses = ["PLACED", "ACCEPTED", "PREPARING", "READY_FOR_PICKUP"] as const satisfies readonly OrderStatusValue[];
export type QueueSectionStatus = (typeof queueSectionStatuses)[number];

export type LiveQueueOrders = { new: OrderDetail[]; inProgress: OrderDetail[]; ready: OrderDetail[] };
export type QueueSection = { status: QueueSectionStatus; orders: OrderDetail[] };

export function queueSections(queue: LiveQueueOrders): QueueSection[] {
  const byStatus: Record<QueueSectionStatus, OrderDetail[]> = { PLACED: [], ACCEPTED: [], PREPARING: [], READY_FOR_PICKUP: [] };
  for (const order of [...queue.new, ...queue.inProgress, ...queue.ready]) {
    if ((queueSectionStatuses as readonly string[]).includes(order.status)) byStatus[order.status as QueueSectionStatus].push(order);
  }
  return queueSectionStatuses.map((status) => ({ status, orders: byStatus[status] }));
}

/** The oldest order still NEW on the server that this device has not set aside with "Later". */
export function popupOrder(newOrders: OrderDetail[], setAside: ReadonlySet<string>): { order: OrderDetail; othersWaiting: number } | null {
  const order = newOrders.find((candidate) => !setAside.has(candidate.id));
  return order ? { order, othersWaiting: newOrders.length - 1 } : null;
}

export function pruneSetAside(setAside: ReadonlySet<string>, newOrders: OrderDetail[]): Set<string> {
  const live = new Set(newOrders.map((order) => order.id));
  return new Set([...setAside].filter((id) => live.has(id)));
}

export const escalateAfterMs = 3 * 60 * 1000;

/** The sound is ~2.3 s; repeat with a quiet gap, closing the gap once an order is overdue. */
export function alertRepeatMs(oldestNewAgeMs: number): number {
  return oldestNewAgeMs > escalateAfterMs ? 3_500 : 6_000;
}

export function oldestAgeMs(orders: Pick<OrderDetail, "createdAt">[], now: number): number {
  if (orders.length === 0) return 0;
  return Math.max(...orders.map((order) => now - new Date(order.createdAt).getTime()));
}

export function countItems(order: Pick<OrderDetail, "items">): number {
  return order.items.reduce((sum, item) => sum + item.quantity, 0);
}

export function shortReference(orderId: string): string {
  return `#${orderId.slice(0, 8).toUpperCase()}`;
}

export function ageLabel(ageMs: number): { key: "live.ageMinutes" | "live.ageHours" | "live.ageDays"; count: number } {
  const minutes = Math.max(0, Math.floor(ageMs / 60_000));
  if (minutes < 60) return { key: "live.ageMinutes", count: minutes };
  if (minutes < 24 * 60) return { key: "live.ageHours", count: Math.floor(minutes / 60) };
  return { key: "live.ageDays", count: Math.floor(minutes / (24 * 60)) };
}

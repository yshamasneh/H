import type { BusinessOrder, LiveOrderQueue } from "./api.business";

/**
 * The store's live order board, as pure logic so it can be tested without React: how the queue is
 * split into the sections staff work through, which order the new-order popup shows, and how often
 * the alert repeats.
 *
 * The sections are exactly the non-terminal OrderStatus values a store handles, in workflow order.
 * The API returns ACCEPTED and PREPARING together as `inProgress`; they are separated here by each
 * order's own status rather than by a second request.
 */
export const queueSectionStatuses = ["PLACED", "ACCEPTED", "PREPARING", "READY_FOR_PICKUP"] as const;
export type QueueSectionStatus = (typeof queueSectionStatuses)[number];

export type QueueSection = { status: QueueSectionStatus; orders: BusinessOrder[] };

export function queueSections(queue: Pick<LiveOrderQueue, "new" | "inProgress" | "ready">): QueueSection[] {
  const byStatus: Record<QueueSectionStatus, BusinessOrder[]> = { PLACED: [], ACCEPTED: [], PREPARING: [], READY_FOR_PICKUP: [] };
  for (const order of [...queue.new, ...queue.inProgress, ...queue.ready]) {
    if ((queueSectionStatuses as readonly string[]).includes(order.status)) {
      byStatus[order.status as QueueSectionStatus].push(order);
    }
  }
  return queueSectionStatuses.map((status) => ({ status, orders: byStatus[status] }));
}

/**
 * The order the new-order popup presents: the oldest one still NEW on the server that this screen
 * has not set aside. Setting one aside ("later") only hides the popup for that order on this device;
 * the sound keeps following the server, and a different new order brings the popup back.
 */
export function popupOrder(newOrders: BusinessOrder[], setAside: ReadonlySet<string>): { order: BusinessOrder; othersWaiting: number } | null {
  const order = newOrders.find((candidate) => !setAside.has(candidate.id));
  if (!order) return null;
  return { order, othersWaiting: newOrders.length - 1 };
}

/** Forget set-aside ids once their order has left NEW, so the set cannot grow without bound. */
export function pruneSetAside(setAside: ReadonlySet<string>, newOrders: BusinessOrder[]): Set<string> {
  const live = new Set(newOrders.map((order) => order.id));
  return new Set([...setAside].filter((id) => live.has(id)));
}

/** An order unhandled for longer than this is escalated visually and audibly. */
export const escalateAfterMs = 3 * 60 * 1000;

/**
 * How often the new-order sound repeats while anything is still NEW. The sound itself is ~2.3 s, so
 * the normal cadence leaves a quiet gap longer than the sound; once the oldest order is overdue the
 * gap closes.
 */
export function alertRepeatMs(oldestNewAgeMs: number): number {
  return oldestNewAgeMs > escalateAfterMs ? 3_500 : 6_000;
}

export function oldestAgeMs(orders: Pick<BusinessOrder, "createdAt">[], now: number): number {
  if (orders.length === 0) return 0;
  return Math.max(...orders.map((order) => now - new Date(order.createdAt).getTime()));
}

export function countItems(order: Pick<BusinessOrder, "items">): number {
  return order.items.reduce((sum, item) => sum + item.quantity, 0);
}

/** The first block of the id: short enough to read aloud across a shop. */
export function shortReference(orderId: string): string {
  return `#${orderId.slice(0, 8).toUpperCase()}`;
}

/** Elapsed time as the i18n key and count to show: minutes under an hour, then hours, then days. */
export function ageLabel(ageMs: number): { key: "liveOrders.elapsed" | "liveOrders.elapsedHours" | "liveOrders.elapsedDays"; count: number } {
  const minutes = Math.max(0, Math.floor(ageMs / 60_000));
  if (minutes < 60) return { key: "liveOrders.elapsed", count: minutes };
  if (minutes < 24 * 60) return { key: "liveOrders.elapsedHours", count: Math.floor(minutes / 60) };
  return { key: "liveOrders.elapsedDays", count: Math.floor(minutes / (24 * 60)) };
}

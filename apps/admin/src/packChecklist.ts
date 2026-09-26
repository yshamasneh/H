/**
 * The packing checklist a business works through while it prepares an order (admin console twin of
 * apps/mobile/src/features/restaurant/pack-checklist.ts — the two are separate workspaces, so the
 * small pure rules are repeated, and each is tested on its own).
 *
 * Whether a line is in the bag (`isPicked`) is state on the order itself, kept by the server and
 * shared by every device on the business, so two staff packing one order — or the phone and this
 * console — see the same ticks live. This module is only the rules over that state.
 *
 * Substitution state is not part of it: it comes from the line's fulfillment adjustment.
 *   PENDING   the customer has not decided yet, so it is not clear what to pack;
 *   APPROVED  with a replacement product: pack the replacement, not the original;
 *   REJECTED  the customer declined: pack the original.
 */
export type PackLine = {
  id: string;
  isPicked?: boolean;
  fulfillmentAdjustment: { status: "PENDING" | "APPROVED" | "REJECTED"; replacementMenuItemId?: string | null } | null;
};

export type PackLineState = "todo" | "picked" | "pickedReplacement" | "awaitingCustomer";

/** The statuses in which a business is physically packing: accepted, until it is marked ready. */
export function isPackingStatus(status: string): boolean {
  return status === "ACCEPTED" || status === "PREPARING";
}

export function packLineState(line: PackLine): PackLineState {
  const adjustment = line.fulfillmentAdjustment;
  if (adjustment?.status === "PENDING") return "awaitingCustomer";
  if (!line.isPicked) return "todo";
  return adjustment?.status === "APPROVED" && adjustment.replacementMenuItemId ? "pickedReplacement" : "picked";
}

export type PackProgress = { total: number; packed: number; remainingIds: string[]; complete: boolean };

export function packProgress(lines: readonly PackLine[]): PackProgress {
  const remainingIds = lines
    .filter((line) => {
      const state = packLineState(line);
      return state === "todo" || state === "awaitingCustomer";
    })
    .map((line) => line.id);
  const packed = lines.length - remainingIds.length;
  return { total: lines.length, packed, remainingIds, complete: lines.length > 0 && remainingIds.length === 0 };
}

/** What tapping a line should ask the server for, or null when the line cannot be ticked (waiting on the customer). */
export function nextPickedValue(line: PackLine): boolean | null {
  return packLineState(line) === "awaitingCustomer" ? null : !line.isPicked;
}

/** The lines with one line's flag set — applies a tick optimistically, and applies a live event. */
export function withPicked<T extends { id: string; isPicked?: boolean }>(lines: readonly T[], lineId: string, isPicked: boolean): T[] {
  return lines.map((line) => (line.id === lineId ? { ...line, isPicked } : line));
}

/** The payload of the `order.packing.changed` socket event, or null when it is not one. */
export function parsePackingEvent(payload: unknown): { orderId: string; orderItemId: string; isPicked: boolean } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { orderId, orderItemId, isPicked } = payload as Record<string, unknown>;
  if (typeof orderId !== "string" || typeof orderItemId !== "string" || typeof isPicked !== "boolean") return null;
  return { orderId, orderItemId, isPicked };
}

/** 2 → "2", 1.5 → "1.5", 1.234 → "1.234": no trailing zeros for whole or short quantities. */
export function trimQuantity(value: number): string {
  return String(Number(value.toFixed(3)));
}

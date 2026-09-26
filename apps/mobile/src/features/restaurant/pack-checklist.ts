import type { FulfillmentAdjustmentView, OrderStatusValue } from "../../core/api";

/**
 * The packing checklist a business works through while it prepares an order.
 *
 * Whether a line is in the bag (`isPicked`) is state on the order itself, kept by the server and
 * shared by every device on the business, so two staff packing one order — or the phone and the
 * admin console — see the same ticks live. This module is only the rules over that state.
 *
 * Substitution state is not part of it: it comes from the line's fulfillment adjustment.
 *   PENDING   the customer has not decided yet, so it is not clear what to pack;
 *   APPROVED  with a replacement product: pack the replacement, not the original;
 *   REJECTED  the customer declined: pack the original.
 */
export type PackLine = {
  id: string;
  isPicked: boolean;
  fulfillmentAdjustment: Pick<FulfillmentAdjustmentView, "status" | "replacementMenuItemId"> | null;
};

export type PackLineState =
  /** Nothing put in the bag yet. */
  | "todo"
  /** Packed as ordered. */
  | "picked"
  /** Packed, but it is the approved replacement rather than the original product. */
  | "pickedReplacement"
  /** A replacement is proposed and the customer has not answered: not packable yet. */
  | "awaitingCustomer";

/** The statuses in which a business is physically packing: accepted, until it is marked ready. */
const packingStatuses: readonly OrderStatusValue[] = ["ACCEPTED", "PREPARING"];

export function isPackingStatus(status: OrderStatusValue): boolean {
  return packingStatuses.includes(status);
}

export function packLineState(line: PackLine): PackLineState {
  const adjustment = line.fulfillmentAdjustment;
  if (adjustment?.status === "PENDING") return "awaitingCustomer";
  if (!line.isPicked) return "todo";
  return adjustment?.status === "APPROVED" && adjustment.replacementMenuItemId ? "pickedReplacement" : "picked";
}

export type PackProgress = {
  total: number;
  packed: number;
  /** Ids of the lines that are not packed yet, in order. */
  remainingIds: string[];
  /** Every line is packed. An order with no lines is never complete. */
  complete: boolean;
};

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

/** Returns the lines with one line's flag set — used to apply a tick optimistically and to apply a live event. */
export function withPicked<T extends PackLine>(lines: readonly T[], lineId: string, isPicked: boolean): T[] {
  return lines.map((line) => (line.id === lineId ? { ...line, isPicked } : line));
}

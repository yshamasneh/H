import type { FulfillmentAdjustmentView, OrderStatusValue } from "../../core/api";

/**
 * The packing checklist a business works through while it prepares an order.
 *
 * It is a view over data the order already has, plus one piece of state the server does not keep:
 * which lines have physically been put in the bag. That set lives on the device (see
 * pack-progress-storage) and is deliberately not a field on the order: it is a working aid for
 * whoever is packing, not something the order, the customer or the accounts depend on.
 *
 * Substitution state is NOT stored here either — it comes from the line's fulfillment adjustment:
 *   PENDING   the customer has not decided yet, so it is not clear what to pack;
 *   APPROVED  with a replacement product: pack the replacement, not the original;
 *   REJECTED  the customer declined: pack the original.
 */
export type PackLine = {
  id: string;
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

export function packLineState(line: PackLine, picked: ReadonlySet<string>): PackLineState {
  const adjustment = line.fulfillmentAdjustment;
  if (adjustment?.status === "PENDING") return "awaitingCustomer";
  if (!picked.has(line.id)) return "todo";
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

export function packProgress(lines: readonly PackLine[], picked: ReadonlySet<string>): PackProgress {
  const remainingIds = lines
    .filter((line) => {
      const state = packLineState(line, picked);
      return state === "todo" || state === "awaitingCustomer";
    })
    .map((line) => line.id);
  const packed = lines.length - remainingIds.length;
  return { total: lines.length, packed, remainingIds, complete: lines.length > 0 && remainingIds.length === 0 };
}

/** Flips one line. A line waiting on the customer cannot be ticked: there is nothing decided to pack. */
export function togglePicked(lines: readonly PackLine[], picked: ReadonlySet<string>, lineId: string): Set<string> {
  const next = new Set(picked);
  const line = lines.find((candidate) => candidate.id === lineId);
  if (!line || packLineState(line, picked) === "awaitingCustomer") return next;
  if (next.has(lineId)) next.delete(lineId);
  else next.add(lineId);
  return next;
}

// --- persistence -----------------------------------------------------------------------------

export function packedStorageKey(orderId: string): string {
  return `jovo.packed.v1.${orderId}`;
}

export function serializePicked(picked: ReadonlySet<string>): string {
  return JSON.stringify([...picked]);
}

/**
 * Reads what was stored, keeping only ids that are still lines of this order: an old, corrupt or
 * foreign value can therefore never mark something packed that is not there.
 */
export function parsePicked(raw: string | null, validIds: readonly string[]): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const valid = new Set(validIds);
    return new Set(parsed.filter((id): id is string => typeof id === "string" && valid.has(id)));
  } catch {
    return new Set();
  }
}

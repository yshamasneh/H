/**
 * The packing checklist a business works through while it prepares an order (admin console twin of
 * apps/mobile/src/features/restaurant/pack-checklist.ts — the two are separate workspaces, so the
 * small pure rules are repeated, and each is tested on its own).
 *
 * It is a view over data the order already has, plus one piece of state the server does not keep:
 * which lines have physically been put in the bag. That set lives in this browser (localStorage,
 * per order) and is deliberately not a field on the order: it is a working aid for whoever is
 * packing, not something the order, the customer or the accounts depend on.
 *
 * Substitution state is NOT stored here — it comes from the line's fulfillment adjustment:
 *   PENDING   the customer has not decided yet, so it is not clear what to pack;
 *   APPROVED  with a replacement product: pack the replacement, not the original;
 *   REJECTED  the customer declined: pack the original.
 */
export type PackLine = {
  id: string;
  fulfillmentAdjustment: { status: "PENDING" | "APPROVED" | "REJECTED"; replacementMenuItemId?: string | null } | null;
};

export type PackLineState = "todo" | "picked" | "pickedReplacement" | "awaitingCustomer";

/** The statuses in which a business is physically packing: accepted, until it is marked ready. */
export function isPackingStatus(status: string): boolean {
  return status === "ACCEPTED" || status === "PREPARING";
}

export function packLineState(line: PackLine, picked: ReadonlySet<string>): PackLineState {
  const adjustment = line.fulfillmentAdjustment;
  if (adjustment?.status === "PENDING") return "awaitingCustomer";
  if (!picked.has(line.id)) return "todo";
  return adjustment?.status === "APPROVED" && adjustment.replacementMenuItemId ? "pickedReplacement" : "picked";
}

export type PackProgress = { total: number; packed: number; remainingIds: string[]; complete: boolean };

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

/** 2 → "2", 1.5 → "1.5", 1.234 → "1.234": no trailing zeros for whole or short quantities. */
export function trimQuantity(value: number): string {
  return String(Number(value.toFixed(3)));
}

// --- persistence (this browser only) ---------------------------------------------------------

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

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** localStorage can be absent or throw (private windows, blocked site data); packing must still work without it. */
function storage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadPicked(orderId: string, validIds: readonly string[]): Set<string> {
  try {
    return parsePicked(storage()?.getItem(packedStorageKey(orderId)) ?? null, validIds);
  } catch {
    return new Set();
  }
}

export function savePicked(orderId: string, picked: ReadonlySet<string>): void {
  try {
    storage()?.setItem(packedStorageKey(orderId), serializePicked(picked));
  } catch {
    // Not remembered across reloads; the in-memory checklist still works.
  }
}

export function clearPicked(orderId: string): void {
  try {
    storage()?.removeItem(packedStorageKey(orderId));
  } catch {
    // Nothing to clean up.
  }
}

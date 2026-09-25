import { parsePositiveMoneyToMinor, parseMoneyToMinor, parseWholeNumber, toMoneyInput } from "./money";

/**
 * Offer form logic, kept apart from the screen so the rules can be tested.
 *
 * These mirror what the API enforces (percentage present unless the offer is free delivery, a
 * restaurant for product and order offers, a product only for product offers, an end after the
 * start) so a mistake shows up beside the field instead of as a server error after submitting.
 *
 * An update is a FULL REPLACE on the server, not a patch: any field left out is reset (a missing
 * `startsAt` becomes "now", a missing `imageUrl` becomes none). So every update built here carries
 * every field the offer already had — including `imageUrl`, which this console never edits but must
 * hand back untouched or an unrelated edit would silently strip the offer's picture.
 */

export const offerTypes = ["PRODUCT_PERCENTAGE", "ORDER_PERCENTAGE", "DELIVERY_PERCENTAGE", "FREE_DELIVERY"] as const;
export type OfferType = (typeof offerTypes)[number];

export type OfferView = {
  id: string;
  type: OfferType;
  restaurantId: string | null;
  restaurantName: string | null;
  menuItemId: string | null;
  menuItemName: string | null;
  title: string;
  description: string | null;
  discountPercent: number | null;
  minimumSubtotalMinor: number;
  maxDiscountMinor: number | null;
  imageUrl: string | null;
  startsAt: string;
  endsAt: string | null;
  isActive: boolean;
  /** At most one offer is featured at a time: the customer app's home banner shows this one. */
  isFeatured: boolean;
  createdAt: string;
};

export type OfferBody = {
  type: OfferType;
  restaurantId?: string;
  menuItemId?: string;
  title: string;
  description?: string;
  discountPercent?: number;
  minimumSubtotalMinor: number;
  maxDiscountMinor?: number;
  imageUrl?: string;
  startsAt?: string;
  endsAt?: string;
  isActive: boolean;
  isFeatured: boolean;
};

export type OfferDraft = {
  type: OfferType;
  restaurantId: string;
  menuItemId: string;
  title: string;
  description: string;
  discountPercent: string;
  minimumSubtotal: string;
  maxDiscount: string;
  /** `datetime-local` value, "YYYY-MM-DDTHH:mm", in the operator's local time. */
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  isFeatured: boolean;
};

export type OfferError =
  | "titleRequired"
  | "restaurantRequired"
  | "productRequired"
  | "percentInvalid"
  | "minimumInvalid"
  | "maxDiscountInvalid"
  | "startInvalid"
  | "endInvalid"
  | "endBeforeStart";

export type OfferResult = { ok: true; body: OfferBody } | { ok: false; error: OfferError; field: keyof OfferDraft };

export const emptyOfferDraft = (): OfferDraft => ({
  type: "ORDER_PERCENTAGE",
  restaurantId: "",
  menuItemId: "",
  title: "",
  description: "",
  discountPercent: "10",
  minimumSubtotal: "0",
  maxDiscount: "",
  startsAt: "",
  endsAt: "",
  isActive: true,
  isFeatured: false
});

export const offerNeedsRestaurant = (type: OfferType): boolean =>
  type === "PRODUCT_PERCENTAGE" || type === "ORDER_PERCENTAGE";
export const offerUsesPercent = (type: OfferType): boolean => type !== "FREE_DELIVERY";

/** ISO instant -> the local "YYYY-MM-DDTHH:mm" a datetime-local input expects. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function offerToDraft(offer: OfferView): OfferDraft {
  return {
    type: offer.type,
    restaurantId: offer.restaurantId ?? "",
    menuItemId: offer.menuItemId ?? "",
    title: offer.title,
    description: offer.description ?? "",
    discountPercent: offer.discountPercent === null ? "" : String(offer.discountPercent),
    minimumSubtotal: toMoneyInput(offer.minimumSubtotalMinor),
    maxDiscount: offer.maxDiscountMinor === null ? "" : toMoneyInput(offer.maxDiscountMinor),
    startsAt: toLocalInput(offer.startsAt),
    endsAt: toLocalInput(offer.endsAt),
    isActive: offer.isActive,
    isFeatured: offer.isFeatured
  };
}

/**
 * Validate the draft and build the body. `existingImageUrl` is passed only when editing: it is
 * handed back unchanged (see the note at the top of the file).
 */
export function buildOffer(
  draft: OfferDraft,
  existing?: { imageUrl: string | null; startsAt: string; endsAt?: string | null }
): OfferResult {
  const title = draft.title.trim();
  if (title.length < 2) return { ok: false, error: "titleRequired", field: "title" };
  if (offerNeedsRestaurant(draft.type) && !draft.restaurantId) {
    return { ok: false, error: "restaurantRequired", field: "restaurantId" };
  }
  if (draft.type === "PRODUCT_PERCENTAGE" && !draft.menuItemId) {
    return { ok: false, error: "productRequired", field: "menuItemId" };
  }

  let discountPercent: number | undefined;
  if (offerUsesPercent(draft.type)) {
    const percent = parseWholeNumber(draft.discountPercent, 1);
    if (percent === null || percent > 100) return { ok: false, error: "percentInvalid", field: "discountPercent" };
    discountPercent = percent;
  }

  const minimumSubtotalMinor = draft.minimumSubtotal.trim() === "" ? 0 : parseMoneyToMinor(draft.minimumSubtotal);
  if (minimumSubtotalMinor === null || minimumSubtotalMinor > 100_000_000) {
    return { ok: false, error: "minimumInvalid", field: "minimumSubtotal" };
  }

  let maxDiscountMinor: number | undefined;
  if (offerUsesPercent(draft.type) && draft.maxDiscount.trim() !== "") {
    const max = parsePositiveMoneyToMinor(draft.maxDiscount);
    if (max === null || max > 100_000_000) return { ok: false, error: "maxDiscountInvalid", field: "maxDiscount" };
    maxDiscountMinor = max;
  }

  // On create an empty start means "now" (the server's default). On edit the existing start is kept
  // when the field is untouched, because omitting it would reset the offer's start to this moment.
  let startsAt: string | undefined;
  if (existing && draft.startsAt === toLocalInput(existing.startsAt)) {
    // Untouched: keep the stored instant exactly (the input only holds minutes, and re-deriving it
    // would move the start by the seconds it dropped).
    startsAt = existing.startsAt;
  } else if (draft.startsAt) {
    const start = new Date(draft.startsAt);
    if (Number.isNaN(start.getTime())) return { ok: false, error: "startInvalid", field: "startsAt" };
    startsAt = start.toISOString();
  } else if (existing) {
    startsAt = existing.startsAt;
  }

  let endsAt: string | undefined;
  if (existing?.endsAt && draft.endsAt === toLocalInput(existing.endsAt)) {
    endsAt = existing.endsAt;
  } else if (draft.endsAt) {
    const end = new Date(draft.endsAt);
    if (Number.isNaN(end.getTime())) return { ok: false, error: "endInvalid", field: "endsAt" };
    const start = startsAt ? new Date(startsAt).getTime() : Date.now();
    if (end.getTime() <= start) return { ok: false, error: "endBeforeStart", field: "endsAt" };
    endsAt = end.toISOString();
  }

  const description = draft.description.trim();
  return {
    ok: true,
    body: {
      type: draft.type,
      ...(draft.restaurantId ? { restaurantId: draft.restaurantId } : {}),
      ...(draft.type === "PRODUCT_PERCENTAGE" ? { menuItemId: draft.menuItemId } : {}),
      title,
      ...(description ? { description } : {}),
      ...(discountPercent !== undefined ? { discountPercent } : {}),
      minimumSubtotalMinor,
      ...(maxDiscountMinor !== undefined ? { maxDiscountMinor } : {}),
      ...(existing?.imageUrl ? { imageUrl: existing.imageUrl } : {}),
      ...(startsAt ? { startsAt } : {}),
      ...(endsAt ? { endsAt } : {}),
      isActive: draft.isActive,
      isFeatured: draft.isFeatured
    }
  };
}

/** Pause or resume an offer without changing anything else about it. */
export function offerToggleBody(offer: OfferView, isActive: boolean): OfferBody {
  return {
    type: offer.type,
    ...(offer.restaurantId ? { restaurantId: offer.restaurantId } : {}),
    ...(offer.menuItemId ? { menuItemId: offer.menuItemId } : {}),
    title: offer.title,
    ...(offer.description ? { description: offer.description } : {}),
    ...(offer.discountPercent !== null ? { discountPercent: offer.discountPercent } : {}),
    minimumSubtotalMinor: offer.minimumSubtotalMinor,
    ...(offer.type !== "FREE_DELIVERY" && offer.maxDiscountMinor !== null
      ? { maxDiscountMinor: offer.maxDiscountMinor }
      : {}),
    ...(offer.imageUrl ? { imageUrl: offer.imageUrl } : {}),
    startsAt: offer.startsAt,
    ...(offer.endsAt ? { endsAt: offer.endsAt } : {}),
    isActive,
    isFeatured: offer.isFeatured
  };
}

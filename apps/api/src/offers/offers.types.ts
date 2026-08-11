import type { BusinessType, OfferType } from "../generated/prisma/enums";

export type OfferView = {
  id: string;
  type: OfferType;
  restaurantId: string | null;
  restaurantName: string | null;
  restaurantBusinessType: BusinessType | null;
  menuItemId: string | null;
  menuItemName: string | null;
  title: string;
  description: string | null;
  discountPercent: number | null;
  minimumSubtotalMinor: number;
  maxDiscountMinor: number | null;
  imageUrl: string | null;
  startsAt: Date;
  endsAt: Date | null;
  isActive: boolean;
  createdAt: Date;
};

/** Who funded an offer. Business-scoped offers are absorbed by the business, platform-scoped ones
 *  by the platform, so the snapshot has to carry the scope rather than making the accounting layer
 *  re-read an Offer row that may have changed since. */
/** `UNKNOWN` is only ever produced when reading a snapshot written before scope was recorded. It is
 *  never written, and the accounting layer must treat it as un-attributable rather than guess. */
export type OfferScope = "PLATFORM" | "BUSINESS" | "UNKNOWN";

export type AppliedPromotion = {
  offerId: string;
  title: string;
  type: OfferType;
  discountMinor: number;
  scope: OfferScope;
  /** The business that funded it, when the scope is BUSINESS. */
  businessId: string | null;
};

export type PromotionCalculation = {
  merchandiseDiscountMinor: number;
  deliveryDiscountMinor: number;
  discountMinor: number;
  appliedPromotions: AppliedPromotion[];
};

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

export type AppliedPromotion = {
  offerId: string;
  title: string;
  type: OfferType;
  discountMinor: number;
};

export type PromotionCalculation = {
  merchandiseDiscountMinor: number;
  deliveryDiscountMinor: number;
  discountMinor: number;
  appliedPromotions: AppliedPromotion[];
};

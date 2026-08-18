import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { writeAuditLog } from "../common/audit-log.util";
import { ApiException } from "../common/api.exception";
import { BusinessType, OfferType, type Offer, type Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { CreateOfferDto, UpdateOfferDto } from "./offers.dto";
import type { AppliedPromotion, OfferView, PromotionCalculation } from "./offers.types";

const offerInclude = { restaurant: true, menuItem: true } as const;
type OfferWithRelations = Prisma.OfferGetPayload<{ include: typeof offerInclude }>;

@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigService
  ) {}

  async listPublicOffers(): Promise<OfferView[]> {
    const restaurantOrderingEnabled = this.config?.get<boolean>("RESTAURANT_ORDERING_ENABLED") ?? false;
    const now = new Date();
    const offers = await this.prisma.offer.findMany({
      where: {
        isActive: true,
        startsAt: { lte: now },
        OR: [
          { endsAt: null },
          { endsAt: { gt: now } }
        ],
        AND: [
          {
            OR: [
              { restaurantId: null },
              { restaurant: { status: "APPROVED", isOpen: true } }
            ]
          },
          // Platform-wide offers (restaurantId: null) and supermarket offers stay visible even
          // while the restaurant vertical's launch gate is closed; only RESTAURANT-scoped offers
          // are hidden, matching the same RESTAURANT_ORDERING_ENABLED flag as browsing/ordering.
          ...(restaurantOrderingEnabled
            ? []
            : [{ OR: [{ restaurantId: null }, { restaurant: { businessType: BusinessType.SUPERMARKET } }] }])
        ]
      },
      include: offerInclude,
      orderBy: [{ createdAt: "desc" }]
    });
    return offers.map(toOfferView);
  }

  async adminList(): Promise<OfferView[]> {
    return (await this.prisma.offer.findMany({ include: offerInclude, orderBy: { createdAt: "desc" } }))
      .map(toOfferView);
  }

  async adminCreate(adminUserId: string, input: CreateOfferDto): Promise<OfferView> {
    const normalized = await this.validateAndNormalize(input);
    const created = await this.prisma.$transaction(async (tx) => {
      const offer = await tx.offer.create({ data: { ...normalized, createdByUserId: adminUserId }, include: offerInclude });
      await writeAuditLog(tx, {
        actorUserId: adminUserId,
        action: "OFFER_CREATED",
        entityType: "Offer",
        entityId: offer.id,
        metadata: { type: offer.type, restaurantId: offer.restaurantId, menuItemId: offer.menuItemId }
      });
      return offer;
    });
    return toOfferView(created);
  }

  async adminUpdate(adminUserId: string, offerId: string, input: UpdateOfferDto): Promise<OfferView> {
    const existing = await this.prisma.offer.findUnique({ where: { id: offerId } });
    if (!existing) throw new ApiException(404, "OFFER_NOT_FOUND", "This offer does not exist.");
    const normalized = await this.validateAndNormalize(input);
    const updated = await this.prisma.$transaction(async (tx) => {
      const offer = await tx.offer.update({ where: { id: offerId }, data: normalized, include: offerInclude });
      await writeAuditLog(tx, {
        actorUserId: adminUserId,
        action: "OFFER_UPDATED",
        entityType: "Offer",
        entityId: offer.id,
        metadata: { type: offer.type, isActive: offer.isActive }
      });
      return offer;
    });
    return toOfferView(updated);
  }

  private async validateAndNormalize(input: CreateOfferDto | UpdateOfferDto) {
    const type = input.type as OfferType;
    const needsPercent = type !== OfferType.FREE_DELIVERY;
    if (needsPercent && input.discountPercent === undefined) {
      throw new ApiException(400, "OFFER_PERCENT_REQUIRED", "A discount percentage is required for this offer type.");
    }
    if (!needsPercent && input.discountPercent !== undefined) {
      throw new ApiException(400, "OFFER_PERCENT_NOT_ALLOWED", "Free delivery does not use a percentage.");
    }
    if ((type === OfferType.PRODUCT_PERCENTAGE || type === OfferType.ORDER_PERCENTAGE) && !input.restaurantId) {
      throw new ApiException(400, "OFFER_RESTAURANT_REQUIRED", "Select a restaurant for this offer type.");
    }
    if (type === OfferType.PRODUCT_PERCENTAGE && !input.menuItemId) {
      throw new ApiException(400, "OFFER_ITEM_REQUIRED", "Select a menu item for a product offer.");
    }
    if (type !== OfferType.PRODUCT_PERCENTAGE && input.menuItemId) {
      throw new ApiException(400, "OFFER_ITEM_NOT_ALLOWED", "Only product offers can target a menu item.");
    }
    if (input.restaurantId && !(await this.prisma.restaurant.findUnique({ where: { id: input.restaurantId } }))) {
      throw new ApiException(404, "RESTAURANT_NOT_FOUND", "The selected restaurant does not exist.");
    }
    if (input.menuItemId) {
      const item = await this.prisma.menuItem.findUnique({ where: { id: input.menuItemId } });
      if (!item || item.restaurantId !== input.restaurantId) {
        throw new ApiException(400, "OFFER_ITEM_RESTAURANT_MISMATCH", "The selected item does not belong to this restaurant.");
      }
    }

    const startsAt = new Date(input.startsAt ?? Date.now());
    const endsAt = input.endsAt ? new Date(input.endsAt) : null;
    if (endsAt && endsAt <= startsAt) {
      throw new ApiException(400, "OFFER_DATES_INVALID", "The offer end must be after its start.");
    }
    return {
      type,
      restaurantId: input.restaurantId ?? null,
      menuItemId: input.menuItemId ?? null,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      discountPercent: input.discountPercent ?? null,
      minimumSubtotalMinor: input.minimumSubtotalMinor ?? 0,
      maxDiscountMinor: type === OfferType.FREE_DELIVERY ? null : input.maxDiscountMinor ?? null,
      imageUrl: input.imageUrl?.trim() || null,
      startsAt,
      endsAt,
      isActive: input.isActive ?? true
    };
  }
}

export function calculatePromotionDiscounts(input: {
  offers: Offer[];
  items: { menuItemId: string; priceMinor: number; quantity: number }[];
  subtotalMinor: number;
  deliveryFeeMinor: number;
}): PromotionCalculation {
  const eligible = input.offers.filter((offer) => offer.minimumSubtotalMinor <= input.subtotalMinor);
  const productApplications: AppliedPromotion[] = [];
  const itemAmounts = new Map<string, number>();
  for (const line of input.items) {
    itemAmounts.set(line.menuItemId, (itemAmounts.get(line.menuItemId) ?? 0) + line.priceMinor * line.quantity);
  }
  for (const [menuItemId, amountMinor] of itemAmounts) {
    const candidates = eligible
      .filter((offer) => offer.type === OfferType.PRODUCT_PERCENTAGE && offer.menuItemId === menuItemId)
      .map((offer) => ({ offer, discount: cappedDiscount(amountMinor, offer) }))
      .sort((left, right) => right.discount - left.discount);
    const best = candidates[0];
    if (best?.discount > 0) productApplications.push(toApplied(best.offer, best.discount));
  }

  const orderApplication = eligible
    .filter((offer) => offer.type === OfferType.ORDER_PERCENTAGE)
    .map((offer) => ({ offer, discount: cappedDiscount(input.subtotalMinor, offer) }))
    .sort((left, right) => right.discount - left.discount)[0];
  const productDiscount = productApplications.reduce((sum, item) => sum + item.discountMinor, 0);
  const merchandiseApplications = orderApplication && orderApplication.discount > productDiscount
    ? [toApplied(orderApplication.offer, orderApplication.discount)]
    : productApplications;

  const deliveryApplication = eligible
    .filter((offer) => offer.type === OfferType.DELIVERY_PERCENTAGE || offer.type === OfferType.FREE_DELIVERY)
    .map((offer) => ({
      offer,
      discount: offer.type === OfferType.FREE_DELIVERY
        ? input.deliveryFeeMinor
        : cappedDiscount(input.deliveryFeeMinor, offer)
    }))
    .sort((left, right) => right.discount - left.discount)[0];

  const merchandiseDiscountMinor = merchandiseApplications.reduce((sum, item) => sum + item.discountMinor, 0);
  const deliveryDiscountMinor = deliveryApplication?.discount ?? 0;
  return {
    merchandiseDiscountMinor,
    deliveryDiscountMinor,
    discountMinor: merchandiseDiscountMinor + deliveryDiscountMinor,
    appliedPromotions: [
      ...merchandiseApplications,
      ...(deliveryApplication ? [toApplied(deliveryApplication.offer, deliveryApplication.discount)] : [])
    ]
  };
}

function cappedDiscount(amountMinor: number, offer: Offer): number {
  const calculated = Math.floor(amountMinor * (offer.discountPercent ?? 0) / 100);
  return Math.min(calculated, offer.maxDiscountMinor ?? calculated);
}

function toApplied(offer: Offer, discountMinor: number): AppliedPromotion {
  return {
    offerId: offer.id,
    title: offer.title,
    type: offer.type,
    discountMinor,
    // An offer tied to a business is funded by that business; a platform-wide offer is the
    // platform's own marketing.
    scope: offer.restaurantId ? "BUSINESS" : "PLATFORM",
    businessId: offer.restaurantId ?? null
  };
}

function toOfferView(offer: OfferWithRelations): OfferView {
  return {
    id: offer.id,
    type: offer.type,
    restaurantId: offer.restaurantId,
    restaurantName: offer.restaurant?.name ?? null,
    restaurantBusinessType: offer.restaurant?.businessType ?? null,
    menuItemId: offer.menuItemId,
    menuItemName: offer.menuItem?.name ?? null,
    title: offer.title,
    description: offer.description,
    discountPercent: offer.discountPercent,
    minimumSubtotalMinor: offer.minimumSubtotalMinor,
    maxDiscountMinor: offer.maxDiscountMinor,
    imageUrl: offer.imageUrl,
    startsAt: offer.startsAt,
    endsAt: offer.endsAt,
    isActive: offer.isActive,
    createdAt: offer.createdAt
  };
}

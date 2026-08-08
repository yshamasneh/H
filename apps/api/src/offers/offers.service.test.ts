import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { OfferType, type Offer } from "../generated/prisma/client";
import { calculatePromotionDiscounts } from "./offers.service";

test("product offers use the best discount per line and beat a weaker order offer", () => {
  const itemId = randomUUID();
  const result = calculatePromotionDiscounts({
    offers: [
      offer({ type: OfferType.PRODUCT_PERCENTAGE, menuItemId: itemId, discountPercent: 20, title: "Item 20" }),
      offer({ type: OfferType.PRODUCT_PERCENTAGE, menuItemId: itemId, discountPercent: 10, title: "Item 10" }),
      offer({ type: OfferType.ORDER_PERCENTAGE, discountPercent: 5, title: "Order 5" })
    ],
    items: [{ menuItemId: itemId, priceMinor: 2_000, quantity: 2 }],
    subtotalMinor: 4_000,
    deliveryFeeMinor: 500
  });

  assert.equal(result.merchandiseDiscountMinor, 800);
  assert.equal(result.appliedPromotions[0].title, "Item 20");
});

test("a merchandise promotion combines with the best delivery promotion", () => {
  const result = calculatePromotionDiscounts({
    offers: [
      offer({ type: OfferType.ORDER_PERCENTAGE, discountPercent: 10, title: "Order 10" }),
      offer({ type: OfferType.DELIVERY_PERCENTAGE, discountPercent: 50, title: "Half delivery" }),
      offer({ type: OfferType.FREE_DELIVERY, discountPercent: null, title: "Free delivery" })
    ],
    items: [{ menuItemId: randomUUID(), priceMinor: 5_000, quantity: 1 }],
    subtotalMinor: 5_000,
    deliveryFeeMinor: 700
  });

  assert.equal(result.merchandiseDiscountMinor, 500);
  assert.equal(result.deliveryDiscountMinor, 700);
  assert.equal(result.discountMinor, 1_200);
  assert.deepEqual(result.appliedPromotions.map((item) => item.title), ["Order 10", "Free delivery"]);
});

test("minimum subtotal and maximum discount are enforced server-side", () => {
  const result = calculatePromotionDiscounts({
    offers: [
      offer({ type: OfferType.ORDER_PERCENTAGE, discountPercent: 50, minimumSubtotalMinor: 10_000, title: "Too high" }),
      offer({ type: OfferType.ORDER_PERCENTAGE, discountPercent: 50, maxDiscountMinor: 600, title: "Capped" })
    ],
    items: [{ menuItemId: randomUUID(), priceMinor: 5_000, quantity: 1 }],
    subtotalMinor: 5_000,
    deliveryFeeMinor: 500
  });

  assert.equal(result.discountMinor, 600);
  assert.equal(result.appliedPromotions[0].title, "Capped");
});

test("a product discount cap cannot be bypassed by repeating the same item in multiple lines", () => {
  const itemId = randomUUID();
  const result = calculatePromotionDiscounts({
    offers: [offer({
      type: OfferType.PRODUCT_PERCENTAGE,
      menuItemId: itemId,
      discountPercent: 50,
      maxDiscountMinor: 500,
      title: "Capped product"
    })],
    items: [
      { menuItemId: itemId, priceMinor: 1_000, quantity: 1 },
      { menuItemId: itemId, priceMinor: 1_000, quantity: 1 }
    ],
    subtotalMinor: 2_000,
    deliveryFeeMinor: 500
  });

  assert.equal(result.discountMinor, 500);
  assert.equal(result.appliedPromotions.length, 1);
});

function offer(overrides: Partial<Offer>): Offer {
  const now = new Date();
  return {
    id: randomUUID(),
    type: OfferType.ORDER_PERCENTAGE,
    restaurantId: randomUUID(),
    menuItemId: null,
    createdByUserId: randomUUID(),
    title: "Offer",
    description: null,
    discountPercent: 10,
    minimumSubtotalMinor: 0,
    maxDiscountMinor: null,
    imageUrl: null,
    startsAt: now,
    endsAt: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

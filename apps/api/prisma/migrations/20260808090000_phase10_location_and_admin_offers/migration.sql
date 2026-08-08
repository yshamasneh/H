CREATE TYPE "OfferType" AS ENUM (
    'PRODUCT_PERCENTAGE',
    'ORDER_PERCENTAGE',
    'DELIVERY_PERCENTAGE',
    'FREE_DELIVERY'
);

ALTER TABLE "Restaurant"
ADD COLUMN "latitude" DOUBLE PRECISION,
ADD COLUMN "longitude" DOUBLE PRECISION,
ADD CONSTRAINT "Restaurant_coordinates_pair_check"
CHECK (("latitude" IS NULL AND "longitude" IS NULL) OR ("latitude" IS NOT NULL AND "longitude" IS NOT NULL)),
ADD CONSTRAINT "Restaurant_latitude_check" CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90),
ADD CONSTRAINT "Restaurant_longitude_check" CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180);

ALTER TABLE "Offer"
ALTER COLUMN "restaurantId" DROP NOT NULL,
ADD COLUMN "type" "OfferType" NOT NULL DEFAULT 'ORDER_PERCENTAGE',
ADD COLUMN "menuItemId" UUID,
ADD COLUMN "createdByUserId" UUID,
ADD COLUMN "minimumSubtotalMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "maxDiscountMinor" INTEGER,
ADD CONSTRAINT "Offer_minimumSubtotalMinor_check" CHECK ("minimumSubtotalMinor" >= 0),
ADD CONSTRAINT "Offer_maxDiscountMinor_check" CHECK ("maxDiscountMinor" IS NULL OR "maxDiscountMinor" >= 0),
ADD CONSTRAINT "Offer_scope_check" CHECK (
    ("type" = 'PRODUCT_PERCENTAGE' AND "restaurantId" IS NOT NULL AND "menuItemId" IS NOT NULL AND "discountPercent" IS NOT NULL)
    OR ("type" = 'ORDER_PERCENTAGE' AND "restaurantId" IS NOT NULL AND "menuItemId" IS NULL AND "discountPercent" IS NOT NULL)
    OR ("type" = 'DELIVERY_PERCENTAGE' AND "menuItemId" IS NULL AND "discountPercent" IS NOT NULL)
    OR ("type" = 'FREE_DELIVERY' AND "menuItemId" IS NULL AND "discountPercent" IS NULL)
);

CREATE INDEX "Offer_type_isActive_startsAt_endsAt_idx"
ON "Offer"("type", "isActive", "startsAt", "endsAt");
CREATE INDEX "Offer_menuItemId_idx" ON "Offer"("menuItemId");

ALTER TABLE "Offer"
ADD CONSTRAINT "Offer_menuItemId_fkey"
FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "Offer_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Order"
ADD COLUMN "deliveryDistanceMeters" INTEGER,
ADD COLUMN "promotionSnapshot" JSONB,
ADD CONSTRAINT "Order_deliveryDistanceMeters_check"
CHECK ("deliveryDistanceMeters" IS NULL OR "deliveryDistanceMeters" >= 0),
ADD CONSTRAINT "Order_delivery_coordinates_pair_check"
CHECK (("deliveryLatitude" IS NULL AND "deliveryLongitude" IS NULL) OR ("deliveryLatitude" IS NOT NULL AND "deliveryLongitude" IS NOT NULL));

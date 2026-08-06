CREATE TABLE "Offer" (
    "id" UUID NOT NULL,
    "restaurantId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "discountPercent" INTEGER,
    "imageUrl" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Offer_discountPercent_check" CHECK ("discountPercent" IS NULL OR ("discountPercent" BETWEEN 1 AND 100)),
    CONSTRAINT "Offer_dates_check" CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt")
);

CREATE INDEX "Offer_isActive_startsAt_endsAt_idx" ON "Offer"("isActive", "startsAt", "endsAt");
CREATE INDEX "Offer_restaurantId_idx" ON "Offer"("restaurantId");

ALTER TABLE "Offer"
ADD CONSTRAINT "Offer_restaurantId_fkey"
FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

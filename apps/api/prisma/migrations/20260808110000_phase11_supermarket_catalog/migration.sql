CREATE TYPE "BusinessType" AS ENUM ('RESTAURANT', 'SUPERMARKET');

ALTER TABLE "Restaurant"
ADD COLUMN "businessType" "BusinessType" NOT NULL DEFAULT 'RESTAURANT';

DROP INDEX IF EXISTS "Restaurant_status_isOpen_idx";
CREATE INDEX "Restaurant_businessType_status_isOpen_idx"
ON "Restaurant"("businessType", "status", "isOpen");

ALTER TABLE "MenuItem"
ADD COLUMN "sku" TEXT,
ADD COLUMN "brand" TEXT,
ADD COLUMN "unitLabel" TEXT NOT NULL DEFAULT 'item',
ADD COLUMN "stockQuantity" INTEGER,
ADD COLUMN "isFeatured" BOOLEAN NOT NULL DEFAULT false,
ADD CONSTRAINT "MenuItem_stockQuantity_check"
CHECK ("stockQuantity" IS NULL OR "stockQuantity" >= 0),
ADD CONSTRAINT "MenuItem_unitLabel_check"
CHECK (length(trim("unitLabel")) > 0);

CREATE UNIQUE INDEX "MenuItem_restaurantId_sku_key"
ON "MenuItem"("restaurantId", "sku");
CREATE INDEX "MenuItem_restaurantId_isFeatured_isAvailable_idx"
ON "MenuItem"("restaurantId", "isFeatured", "isAvailable");

ALTER TABLE "OrderItem"
ADD COLUMN "unitLabelSnapshot" TEXT NOT NULL DEFAULT 'item',
ADD COLUMN "allowSubstitution" BOOLEAN NOT NULL DEFAULT false;

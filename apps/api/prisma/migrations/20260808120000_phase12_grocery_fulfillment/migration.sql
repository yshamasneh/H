CREATE TYPE "FulfillmentAdjustmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "MenuItem"
ADD COLUMN "isVariableWeight" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "OrderItem"
ADD COLUMN "isVariableWeightSnapshot" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "FulfillmentAdjustment" (
    "id" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "replacementMenuItemId" UUID,
    "proposedByUserId" UUID NOT NULL,
    "replacementNameSnapshot" TEXT,
    "replacementUnitLabelSnapshot" TEXT,
    "actualQuantityMilli" INTEGER NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "lineTotalMinor" INTEGER NOT NULL,
    "status" "FulfillmentAdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FulfillmentAdjustment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FulfillmentAdjustment_actualQuantityMilli_check" CHECK ("actualQuantityMilli" > 0),
    CONSTRAINT "FulfillmentAdjustment_unitPriceMinor_check" CHECK ("unitPriceMinor" >= 0),
    CONSTRAINT "FulfillmentAdjustment_lineTotalMinor_check" CHECK ("lineTotalMinor" >= 0)
);

CREATE UNIQUE INDEX "FulfillmentAdjustment_orderItemId_key" ON "FulfillmentAdjustment"("orderItemId");
CREATE INDEX "FulfillmentAdjustment_status_updatedAt_idx" ON "FulfillmentAdjustment"("status", "updatedAt");

ALTER TABLE "FulfillmentAdjustment"
ADD CONSTRAINT "FulfillmentAdjustment_orderItemId_fkey"
FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FulfillmentAdjustment"
ADD CONSTRAINT "FulfillmentAdjustment_replacementMenuItemId_fkey"
FOREIGN KEY ("replacementMenuItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FulfillmentAdjustment"
ADD CONSTRAINT "FulfillmentAdjustment_proposedByUserId_fkey"
FOREIGN KEY ("proposedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

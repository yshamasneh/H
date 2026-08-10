-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "acceptedByUserId" UUID;

-- CreateIndex
CREATE INDEX "Order_restaurantId_status_createdAt_idx" ON "Order"("restaurantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OrderStatusHistory_changedByUserId_createdAt_idx" ON "OrderStatusHistory"("changedByUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill acceptance attribution for orders that were accepted before these columns existed.
-- OrderStatusHistory already records who moved an order into ACCEPTED and when, so the new
-- denormalised columns are derived from it rather than left null for historical orders.
UPDATE "Order" AS o
SET "acceptedByUserId" = h."changedByUserId",
    "acceptedAt" = h."createdAt"
FROM (
  SELECT DISTINCT ON ("orderId") "orderId", "changedByUserId", "createdAt"
  FROM "OrderStatusHistory"
  WHERE "toStatus" = 'ACCEPTED'
  ORDER BY "orderId", "createdAt" ASC
) AS h
WHERE h."orderId" = o."id" AND o."acceptedAt" IS NULL;

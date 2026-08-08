ALTER TABLE "FulfillmentAdjustment"
DROP CONSTRAINT "FulfillmentAdjustment_proposedByUserId_fkey",
ADD CONSTRAINT "FulfillmentAdjustment_proposedByUserId_fkey"
FOREIGN KEY ("proposedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrder"
DROP CONSTRAINT "PurchaseOrder_createdByUserId_fkey",
ADD CONSTRAINT "PurchaseOrder_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

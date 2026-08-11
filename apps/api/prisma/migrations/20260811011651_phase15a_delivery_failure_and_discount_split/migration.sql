-- CreateEnum
CREATE TYPE "DeliveryFailureReason" AS ENUM ('CUSTOMER_REFUSED', 'CUSTOMER_UNREACHABLE', 'WRONG_ADDRESS', 'BUSINESS_ERROR', 'DRIVER_ISSUE', 'OTHER');

-- CreateEnum
CREATE TYPE "DeliveryFaultParty" AS ENUM ('CUSTOMER', 'BUSINESS', 'DRIVER', 'UNDETERMINED');

-- AlterEnum
ALTER TYPE "DeliveryStatus" ADD VALUE 'FAILED';

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'DELIVERY_FAILED';

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_restaurantId_fkey";

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "failureNote" TEXT,
ADD COLUMN     "failureReason" "DeliveryFailureReason",
ADD COLUMN     "faultParty" "DeliveryFaultParty";

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryDiscountMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "merchandiseDiscountMinor" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "serviceFeeMinor" SET DEFAULT 0;

-- CreateIndex
CREATE INDEX "Delivery_failureReason_failedAt_idx" ON "Delivery"("failureReason", "failedAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The commission base is item subtotal after merchandise discounts only, so the split must always
-- reconcile to the stored total. Every existing order has a zero discount, so this holds already.
ALTER TABLE "Order" ADD CONSTRAINT "Order_discount_split_reconciles"
  CHECK (
    "merchandiseDiscountMinor" >= 0
    AND "deliveryDiscountMinor" >= 0
    AND "merchandiseDiscountMinor" + "deliveryDiscountMinor" = "discountMinor"
  );

-- A failed delivery without a recorded reason would be useless to the financial layer, so the
-- requirement is enforced by the database rather than only by the service that writes it.
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_failure_requires_reason"
  CHECK (
    "status" <> 'FAILED'
    OR ("failureReason" IS NOT NULL AND "faultParty" IS NOT NULL AND "failedAt" IS NOT NULL)
  );

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "isPicked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pickedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "isFeatured" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Offer_isFeatured_idx" ON "Offer"("isFeatured");

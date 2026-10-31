-- Run 3, task 1: editorial review state for products, separate from isAvailable.
-- Additive only. Every existing row becomes APPROVED through the column default, so products that
-- customers can see today stay visible. Code that does not know the columns keeps working.
CREATE TYPE "MenuItemReviewStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED');
ALTER TABLE "MenuItem" ADD COLUMN "reviewStatus" "MenuItemReviewStatus" NOT NULL DEFAULT 'APPROVED';
ALTER TABLE "MenuItem" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "MenuItem" ADD COLUMN "reviewedByUserId" UUID;
CREATE INDEX "MenuItem_restaurantId_reviewStatus_idx" ON "MenuItem"("restaurantId", "reviewStatus");

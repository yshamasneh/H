-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN     "costPriceMinor" INTEGER;

-- Nullable (not every product needs a recorded cost), but never negative when set.
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_costPriceMinor_check" CHECK ("costPriceMinor" IS NULL OR "costPriceMinor" >= 0);

-- DropForeignKey
ALTER TABLE "FinancialRateSet" DROP CONSTRAINT "FinancialRateSet_createdByUserId_fkey";

-- AddForeignKey
ALTER TABLE "FinancialRateSet" ADD CONSTRAINT "FinancialRateSet_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

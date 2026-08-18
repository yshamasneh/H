-- CreateEnum
CREATE TYPE "OrderFinancialVertical" AS ENUM ('RESTAURANT', 'SUPERMARKET');

-- CreateEnum
CREATE TYPE "OrderFinancialOutcome" AS ENUM ('DELIVERED', 'DELIVERY_FAILED');

-- CreateEnum
CREATE TYPE "LossAbsorber" AS ENUM ('NONE', 'PLATFORM', 'BUSINESS', 'DRIVER');

-- CreateEnum
CREATE TYPE "PartnerAccountKind" AS ENUM ('PLATFORM_OWNER', 'DELIVERY_OPS', 'SUPERMARKET_PARTNER');

-- CreateEnum
CREATE TYPE "FinancialPayeeType" AS ENUM ('PARTNER', 'BUSINESS', 'DRIVER');

-- CreateEnum
CREATE TYPE "FinancialSourceType" AS ENUM ('ORDER', 'OPERATING_COST', 'SUBSCRIPTION', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "EarningComponent" AS ENUM ('BUSINESS_MERCHANDISE_NET', 'SUPERMARKET_GOODS_COST', 'SUPERMARKET_MARGIN_SHARE', 'PLATFORM_COMMISSION_SHARE', 'BUSINESS_DISCOUNT_ABSORBED', 'PLATFORM_DISCOUNT_ABSORBED', 'DRIVER_DELIVERY_SHARE', 'DELIVERY_OPS_SHARE', 'PLATFORM_DELIVERY_SHARE', 'FAILED_DELIVERY_LOSS', 'OPERATING_COST_SHARE', 'SUBSCRIPTION_CHARGE', 'SUBSCRIPTION_SHARE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "OperatingCostStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OperatingCostCategory" AS ENUM ('WAREHOUSE_RENT', 'STAFF_SALARY', 'UTILITIES', 'MAINTENANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "CashCustodyStatus" AS ENUM ('OUTSTANDING', 'PARTIALLY_SETTLED', 'SETTLED');

-- CreateEnum
CREATE TYPE "CashSettlementMode" AS ENUM ('GROSS', 'NET_OF_EARNINGS');

-- CreateEnum
CREATE TYPE "PartnerSettlementMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'OFFSET');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "commissionBpSnapshot" INTEGER,
ADD COLUMN     "financialRateSetId" UUID;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "costPriceMinorSnapshot" INTEGER;

-- AlterTable
ALTER TABLE "Restaurant" ADD COLUMN     "isPromotionalPartner" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "FinancialRateSet" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restaurantCommissionBp" INTEGER NOT NULL DEFAULT 2000,
    "promotionalCommissionBp" INTEGER NOT NULL DEFAULT 1500,
    "monthlySubscriptionMinor" INTEGER NOT NULL DEFAULT 15000,
    "commissionOwnerAWeight" INTEGER NOT NULL DEFAULT 1,
    "commissionOwnerBWeight" INTEGER NOT NULL DEFAULT 1,
    "supermarketPartnerMarginBp" INTEGER NOT NULL DEFAULT 4000,
    "ownerAMarginBp" INTEGER NOT NULL DEFAULT 3000,
    "ownerBMarginBp" INTEGER NOT NULL DEFAULT 3000,
    "supermarketPartnerCostBp" INTEGER NOT NULL DEFAULT 4000,
    "ownerACostBp" INTEGER NOT NULL DEFAULT 3000,
    "ownerBCostBp" INTEGER NOT NULL DEFAULT 3000,
    "driverDeliveryShareBp" INTEGER NOT NULL DEFAULT 7000,
    "deliveryOpsRemainderWeight" INTEGER NOT NULL DEFAULT 1,
    "ownerADeliveryRemainderWeight" INTEGER NOT NULL DEFAULT 1,
    "ownerBDeliveryRemainderWeight" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "FinancialRateSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerAccount" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PartnerAccountKind" NOT NULL,
    "userId" UUID,
    "businessId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderFinancialRecord" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "rateSetId" UUID NOT NULL,
    "vertical" "OrderFinancialVertical" NOT NULL,
    "outcome" "OrderFinancialOutcome" NOT NULL,
    "isPromotionalBusiness" BOOLEAN NOT NULL,
    "commissionBp" INTEGER,
    "itemSubtotalMinor" INTEGER NOT NULL,
    "merchandiseDiscountMinor" INTEGER NOT NULL DEFAULT 0,
    "deliveryDiscountMinor" INTEGER NOT NULL DEFAULT 0,
    "businessFundedMerchandiseDiscountMinor" INTEGER NOT NULL DEFAULT 0,
    "platformFundedMerchandiseDiscountMinor" INTEGER NOT NULL DEFAULT 0,
    "businessFundedDeliveryDiscountMinor" INTEGER NOT NULL DEFAULT 0,
    "platformFundedDeliveryDiscountMinor" INTEGER NOT NULL DEFAULT 0,
    "unattributedDiscountMinor" INTEGER NOT NULL DEFAULT 0,
    "deliveryFeeMinor" INTEGER NOT NULL,
    "cashCollectedMinor" INTEGER NOT NULL,
    "goodsCostMinor" INTEGER NOT NULL DEFAULT 0,
    "costDataComplete" BOOLEAN NOT NULL DEFAULT true,
    "marginMinor" INTEGER NOT NULL DEFAULT 0,
    "commissionMinor" INTEGER NOT NULL DEFAULT 0,
    "driverShareMinor" INTEGER NOT NULL DEFAULT 0,
    "deliveryRemainderMinor" INTEGER NOT NULL DEFAULT 0,
    "lossAbsorber" "LossAbsorber" NOT NULL DEFAULT 'NONE',
    "absorbedLossMinor" INTEGER NOT NULL DEFAULT 0,
    "faultParty" "DeliveryFaultParty",
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderFinancialRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerEarning" (
    "id" UUID NOT NULL,
    "sourceType" "FinancialSourceType" NOT NULL,
    "sourceId" UUID NOT NULL,
    "orderFinancialRecordId" UUID,
    "operatingCostEntryId" UUID,
    "subscriptionChargeId" UUID,
    "adjustmentId" UUID,
    "payeeType" "FinancialPayeeType" NOT NULL,
    "payeeKey" TEXT NOT NULL,
    "partnerAccountId" UUID,
    "businessId" UUID,
    "driverUserId" UUID,
    "component" "EarningComponent" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerEarning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverCashCustody" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "orderFinancialRecordId" UUID NOT NULL,
    "driverUserId" UUID NOT NULL,
    "expectedAmountMinor" INTEGER NOT NULL,
    "collectedAmountMinor" INTEGER NOT NULL,
    "settledAmountMinor" INTEGER NOT NULL DEFAULT 0,
    "status" "CashCustodyStatus" NOT NULL DEFAULT 'OUTSTANDING',
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverCashCustody_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashSettlement" (
    "id" UUID NOT NULL,
    "driverUserId" UUID NOT NULL,
    "receivedByUserId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "mode" "CashSettlementMode" NOT NULL DEFAULT 'GROSS',
    "expectedAmountMinor" INTEGER NOT NULL,
    "countedAmountMinor" INTEGER NOT NULL,
    "discrepancyMinor" INTEGER NOT NULL,
    "discrepancyNote" TEXT,
    "note" TEXT,
    "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashSettlementAllocation" (
    "id" UUID NOT NULL,
    "settlementId" UUID NOT NULL,
    "custodyId" UUID NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashSettlementAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatingCostEntry" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "category" "OperatingCostCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "incurredOn" DATE NOT NULL,
    "periodLabel" TEXT,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "status" "OperatingCostStatus" NOT NULL DEFAULT 'PROPOSED',
    "proposedByUserId" UUID NOT NULL,
    "approverUserId" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "rateSetId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatingCostEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionCharge" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "isWaived" BOOLEAN NOT NULL DEFAULT false,
    "waivedReason" TEXT,
    "rateSetId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerSettlement" (
    "id" UUID NOT NULL,
    "payeeType" "FinancialPayeeType" NOT NULL,
    "payeeKey" TEXT NOT NULL,
    "partnerAccountId" UUID,
    "businessId" UUID,
    "driverUserId" UUID,
    "amountMinor" INTEGER NOT NULL,
    "method" "PartnerSettlementMethod" NOT NULL,
    "reference" TEXT NOT NULL,
    "paidByUserId" UUID NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "note" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerSettlementAllocation" (
    "id" UUID NOT NULL,
    "settlementId" UUID NOT NULL,
    "earningId" UUID NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerSettlementAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialAdjustment" (
    "id" UUID NOT NULL,
    "orderFinancialRecordId" UUID,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinancialRateSet_version_key" ON "FinancialRateSet"("version");

-- CreateIndex
CREATE INDEX "FinancialRateSet_effectiveFrom_idx" ON "FinancialRateSet"("effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerAccount_key_key" ON "PartnerAccount"("key");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerAccount_userId_key" ON "PartnerAccount"("userId");

-- CreateIndex
CREATE INDEX "PartnerAccount_kind_isActive_idx" ON "PartnerAccount"("kind", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "OrderFinancialRecord_orderId_key" ON "OrderFinancialRecord"("orderId");

-- CreateIndex
CREATE INDEX "OrderFinancialRecord_businessId_computedAt_idx" ON "OrderFinancialRecord"("businessId", "computedAt");

-- CreateIndex
CREATE INDEX "OrderFinancialRecord_vertical_computedAt_idx" ON "OrderFinancialRecord"("vertical", "computedAt");

-- CreateIndex
CREATE INDEX "OrderFinancialRecord_outcome_computedAt_idx" ON "OrderFinancialRecord"("outcome", "computedAt");

-- CreateIndex
CREATE INDEX "PartnerEarning_payeeKey_occurredAt_idx" ON "PartnerEarning"("payeeKey", "occurredAt");

-- CreateIndex
CREATE INDEX "PartnerEarning_orderFinancialRecordId_idx" ON "PartnerEarning"("orderFinancialRecordId");

-- CreateIndex
CREATE INDEX "PartnerEarning_component_occurredAt_idx" ON "PartnerEarning"("component", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerEarning_sourceType_sourceId_payeeKey_component_key" ON "PartnerEarning"("sourceType", "sourceId", "payeeKey", "component");

-- CreateIndex
CREATE UNIQUE INDEX "DriverCashCustody_orderId_key" ON "DriverCashCustody"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "DriverCashCustody_orderFinancialRecordId_key" ON "DriverCashCustody"("orderFinancialRecordId");

-- CreateIndex
CREATE INDEX "DriverCashCustody_driverUserId_status_idx" ON "DriverCashCustody"("driverUserId", "status");

-- CreateIndex
CREATE INDEX "DriverCashCustody_status_collectedAt_idx" ON "DriverCashCustody"("status", "collectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CashSettlement_reference_key" ON "CashSettlement"("reference");

-- CreateIndex
CREATE INDEX "CashSettlement_driverUserId_settledAt_idx" ON "CashSettlement"("driverUserId", "settledAt");

-- CreateIndex
CREATE INDEX "CashSettlement_settledAt_idx" ON "CashSettlement"("settledAt");

-- CreateIndex
CREATE INDEX "CashSettlementAllocation_custodyId_idx" ON "CashSettlementAllocation"("custodyId");

-- CreateIndex
CREATE UNIQUE INDEX "CashSettlementAllocation_settlementId_custodyId_key" ON "CashSettlementAllocation"("settlementId", "custodyId");

-- CreateIndex
CREATE INDEX "OperatingCostEntry_status_createdAt_idx" ON "OperatingCostEntry"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OperatingCostEntry_businessId_incurredOn_idx" ON "OperatingCostEntry"("businessId", "incurredOn");

-- CreateIndex
CREATE UNIQUE INDEX "OperatingCostEntry_businessId_category_periodLabel_key" ON "OperatingCostEntry"("businessId", "category", "periodLabel");

-- CreateIndex
CREATE INDEX "SubscriptionCharge_periodYear_periodMonth_idx" ON "SubscriptionCharge"("periodYear", "periodMonth");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionCharge_businessId_periodYear_periodMonth_key" ON "SubscriptionCharge"("businessId", "periodYear", "periodMonth");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerSettlement_reference_key" ON "PartnerSettlement"("reference");

-- CreateIndex
CREATE INDEX "PartnerSettlement_payeeKey_paidAt_idx" ON "PartnerSettlement"("payeeKey", "paidAt");

-- CreateIndex
CREATE INDEX "PartnerSettlement_paidAt_idx" ON "PartnerSettlement"("paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerSettlementAllocation_earningId_key" ON "PartnerSettlementAllocation"("earningId");

-- CreateIndex
CREATE INDEX "PartnerSettlementAllocation_settlementId_idx" ON "PartnerSettlementAllocation"("settlementId");

-- CreateIndex
CREATE INDEX "FinancialAdjustment_orderFinancialRecordId_idx" ON "FinancialAdjustment"("orderFinancialRecordId");

-- CreateIndex
CREATE INDEX "FinancialAdjustment_createdAt_idx" ON "FinancialAdjustment"("createdAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_financialRateSetId_fkey" FOREIGN KEY ("financialRateSetId") REFERENCES "FinancialRateSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialRateSet" ADD CONSTRAINT "FinancialRateSet_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerAccount" ADD CONSTRAINT "PartnerAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerAccount" ADD CONSTRAINT "PartnerAccount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Restaurant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderFinancialRecord" ADD CONSTRAINT "OrderFinancialRecord_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderFinancialRecord" ADD CONSTRAINT "OrderFinancialRecord_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderFinancialRecord" ADD CONSTRAINT "OrderFinancialRecord_rateSetId_fkey" FOREIGN KEY ("rateSetId") REFERENCES "FinancialRateSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerEarning" ADD CONSTRAINT "PartnerEarning_orderFinancialRecordId_fkey" FOREIGN KEY ("orderFinancialRecordId") REFERENCES "OrderFinancialRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerEarning" ADD CONSTRAINT "PartnerEarning_operatingCostEntryId_fkey" FOREIGN KEY ("operatingCostEntryId") REFERENCES "OperatingCostEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerEarning" ADD CONSTRAINT "PartnerEarning_subscriptionChargeId_fkey" FOREIGN KEY ("subscriptionChargeId") REFERENCES "SubscriptionCharge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerEarning" ADD CONSTRAINT "PartnerEarning_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "FinancialAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerEarning" ADD CONSTRAINT "PartnerEarning_partnerAccountId_fkey" FOREIGN KEY ("partnerAccountId") REFERENCES "PartnerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerEarning" ADD CONSTRAINT "PartnerEarning_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerEarning" ADD CONSTRAINT "PartnerEarning_driverUserId_fkey" FOREIGN KEY ("driverUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverCashCustody" ADD CONSTRAINT "DriverCashCustody_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverCashCustody" ADD CONSTRAINT "DriverCashCustody_orderFinancialRecordId_fkey" FOREIGN KEY ("orderFinancialRecordId") REFERENCES "OrderFinancialRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverCashCustody" ADD CONSTRAINT "DriverCashCustody_driverUserId_fkey" FOREIGN KEY ("driverUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSettlement" ADD CONSTRAINT "CashSettlement_driverUserId_fkey" FOREIGN KEY ("driverUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSettlement" ADD CONSTRAINT "CashSettlement_receivedByUserId_fkey" FOREIGN KEY ("receivedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSettlementAllocation" ADD CONSTRAINT "CashSettlementAllocation_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "CashSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSettlementAllocation" ADD CONSTRAINT "CashSettlementAllocation_custodyId_fkey" FOREIGN KEY ("custodyId") REFERENCES "DriverCashCustody"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatingCostEntry" ADD CONSTRAINT "OperatingCostEntry_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatingCostEntry" ADD CONSTRAINT "OperatingCostEntry_proposedByUserId_fkey" FOREIGN KEY ("proposedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatingCostEntry" ADD CONSTRAINT "OperatingCostEntry_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatingCostEntry" ADD CONSTRAINT "OperatingCostEntry_rateSetId_fkey" FOREIGN KEY ("rateSetId") REFERENCES "FinancialRateSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionCharge" ADD CONSTRAINT "SubscriptionCharge_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionCharge" ADD CONSTRAINT "SubscriptionCharge_rateSetId_fkey" FOREIGN KEY ("rateSetId") REFERENCES "FinancialRateSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionCharge" ADD CONSTRAINT "SubscriptionCharge_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerSettlement" ADD CONSTRAINT "PartnerSettlement_partnerAccountId_fkey" FOREIGN KEY ("partnerAccountId") REFERENCES "PartnerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerSettlement" ADD CONSTRAINT "PartnerSettlement_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerSettlement" ADD CONSTRAINT "PartnerSettlement_driverUserId_fkey" FOREIGN KEY ("driverUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerSettlement" ADD CONSTRAINT "PartnerSettlement_paidByUserId_fkey" FOREIGN KEY ("paidByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerSettlementAllocation" ADD CONSTRAINT "PartnerSettlementAllocation_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "PartnerSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerSettlementAllocation" ADD CONSTRAINT "PartnerSettlementAllocation_earningId_fkey" FOREIGN KEY ("earningId") REFERENCES "PartnerEarning"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAdjustment" ADD CONSTRAINT "FinancialAdjustment_orderFinancialRecordId_fkey" FOREIGN KEY ("orderFinancialRecordId") REFERENCES "OrderFinancialRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAdjustment" ADD CONSTRAINT "FinancialAdjustment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ==============================================================================================
-- Phase 15.6 — database-level financial integrity.
--
-- Everything below is a guarantee the service layer is not allowed to be the only holder of.
-- A bug in a service, a script run by hand, or a future refactor must all still be unable to
-- double-settle an order, double-count an entitlement, or quietly rewrite financial history.
-- ==============================================================================================

-- ---------------------------------------------------------------- rate sets must be coherent
ALTER TABLE "FinancialRateSet"
  ADD CONSTRAINT "FinancialRateSet_commission_bp_range"
    CHECK ("restaurantCommissionBp" BETWEEN 0 AND 10000
       AND "promotionalCommissionBp" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "FinancialRateSet_subscription_nonnegative"
    CHECK ("monthlySubscriptionMinor" >= 0),
  ADD CONSTRAINT "FinancialRateSet_commission_weights_positive"
    CHECK ("commissionOwnerAWeight" >= 0 AND "commissionOwnerBWeight" >= 0
       AND "commissionOwnerAWeight" + "commissionOwnerBWeight" > 0),
  -- The three-way margin split has to be a whole pie, or an order's money would not reconcile.
  ADD CONSTRAINT "FinancialRateSet_margin_split_totals_whole"
    CHECK ("supermarketPartnerMarginBp" + "ownerAMarginBp" + "ownerBMarginBp" = 10000
       AND "supermarketPartnerMarginBp" >= 0 AND "ownerAMarginBp" >= 0 AND "ownerBMarginBp" >= 0),
  -- The cost split is checked independently of the margin split. They match today; the schema
  -- deliberately does not assume they always will.
  ADD CONSTRAINT "FinancialRateSet_cost_split_totals_whole"
    CHECK ("supermarketPartnerCostBp" + "ownerACostBp" + "ownerBCostBp" = 10000
       AND "supermarketPartnerCostBp" >= 0 AND "ownerACostBp" >= 0 AND "ownerBCostBp" >= 0),
  ADD CONSTRAINT "FinancialRateSet_driver_share_range"
    CHECK ("driverDeliveryShareBp" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "FinancialRateSet_delivery_remainder_weights_positive"
    CHECK ("deliveryOpsRemainderWeight" >= 0
       AND "ownerADeliveryRemainderWeight" >= 0
       AND "ownerBDeliveryRemainderWeight" >= 0
       AND "deliveryOpsRemainderWeight" + "ownerADeliveryRemainderWeight" + "ownerBDeliveryRemainderWeight" > 0);

-- ---------------------------------------------------------------- a partner is one kind of thing
ALTER TABLE "PartnerAccount"
  ADD CONSTRAINT "PartnerAccount_supermarket_partner_has_business"
    CHECK ("kind" <> 'SUPERMARKET_PARTNER' OR "businessId" IS NOT NULL);

-- ---------------------------------------------------------------- order financial records
ALTER TABLE "OrderFinancialRecord"
  ADD CONSTRAINT "OrderFinancialRecord_amounts_nonnegative"
    CHECK ("itemSubtotalMinor" >= 0 AND "deliveryFeeMinor" >= 0 AND "cashCollectedMinor" >= 0
       AND "merchandiseDiscountMinor" >= 0 AND "deliveryDiscountMinor" >= 0
       AND "goodsCostMinor" >= 0 AND "absorbedLossMinor" >= 0),
  -- The funded split must add back up to the discount it came from, so no discount can be lost
  -- between the promotion engine and the ledger.
  ADD CONSTRAINT "OrderFinancialRecord_merchandise_discount_reconciles"
    CHECK ("businessFundedMerchandiseDiscountMinor" + "platformFundedMerchandiseDiscountMinor"
           = "merchandiseDiscountMinor"),
  ADD CONSTRAINT "OrderFinancialRecord_delivery_discount_reconciles"
    CHECK ("businessFundedDeliveryDiscountMinor" + "platformFundedDeliveryDiscountMinor"
           = "deliveryDiscountMinor"),
  -- A restaurant record carries a commission rate; a supermarket record never does, because there
  -- is no commission in that vertical at all.
  ADD CONSTRAINT "OrderFinancialRecord_commission_matches_vertical"
    CHECK (("vertical" = 'RESTAURANT' AND "commissionBp" IS NOT NULL)
        OR ("vertical" = 'SUPERMARKET' AND "commissionBp" IS NULL AND "commissionMinor" = 0)),
  -- A delivered order collected the money; a failed one collected none and named an absorber.
  ADD CONSTRAINT "OrderFinancialRecord_failed_collects_nothing"
    CHECK (("outcome" = 'DELIVERED' AND "lossAbsorber" = 'NONE' AND "absorbedLossMinor" = 0)
        OR ("outcome" = 'DELIVERY_FAILED' AND "cashCollectedMinor" = 0 AND "lossAbsorber" <> 'NONE'));

-- ---------------------------------------------------------------- the ledger
ALTER TABLE "PartnerEarning"
  -- Exactly one payee, and it has to be the one the payee type names.
  ADD CONSTRAINT "PartnerEarning_exactly_one_payee"
    CHECK (
      (("partnerAccountId" IS NOT NULL)::int + ("businessId" IS NOT NULL)::int
       + ("driverUserId" IS NOT NULL)::int) = 1
      AND ("payeeType" <> 'PARTNER'  OR "partnerAccountId" IS NOT NULL)
      AND ("payeeType" <> 'BUSINESS' OR "businessId" IS NOT NULL)
      AND ("payeeType" <> 'DRIVER'   OR "driverUserId" IS NOT NULL)
    ),
  -- Exactly one source, matching the source type, and sourceId must be that source's id — which
  -- is what makes the (sourceType, sourceId, payeeKey, component) unique index trustworthy.
  ADD CONSTRAINT "PartnerEarning_exactly_one_source"
    CHECK (
      (("orderFinancialRecordId" IS NOT NULL)::int + ("operatingCostEntryId" IS NOT NULL)::int
       + ("subscriptionChargeId" IS NOT NULL)::int + ("adjustmentId" IS NOT NULL)::int) = 1
      AND ("sourceType" <> 'ORDER'          OR "sourceId" = "orderFinancialRecordId")
      AND ("sourceType" <> 'OPERATING_COST' OR "sourceId" = "operatingCostEntryId")
      AND ("sourceType" <> 'SUBSCRIPTION'   OR "sourceId" = "subscriptionChargeId")
      AND ("sourceType" <> 'ADJUSTMENT'     OR "sourceId" = "adjustmentId")
    ),
  -- payeeKey is what a balance query groups by, so it must agree with the foreign key it stands in
  -- for. A mismatch would silently move money between parties in every report.
  ADD CONSTRAINT "PartnerEarning_payee_key_matches"
    CHECK ("payeeKey" = CASE "payeeType"
      WHEN 'PARTNER'  THEN 'PARTNER:'  || "partnerAccountId"::text
      WHEN 'BUSINESS' THEN 'BUSINESS:' || "businessId"::text
      WHEN 'DRIVER'   THEN 'DRIVER:'   || "driverUserId"::text
    END),
  -- Components that only ever cost a party money can never appear as a credit, and vice versa.
  ADD CONSTRAINT "PartnerEarning_component_sign"
    CHECK (
      CASE "component"
        WHEN 'BUSINESS_DISCOUNT_ABSORBED' THEN "amountMinor" <= 0
        WHEN 'PLATFORM_DISCOUNT_ABSORBED' THEN "amountMinor" <= 0
        WHEN 'FAILED_DELIVERY_LOSS'       THEN "amountMinor" <= 0
        WHEN 'OPERATING_COST_SHARE'       THEN "amountMinor" <= 0
        WHEN 'SUBSCRIPTION_CHARGE'        THEN "amountMinor" <= 0
        WHEN 'SUPERMARKET_GOODS_COST'     THEN "amountMinor" >= 0
        WHEN 'DRIVER_DELIVERY_SHARE'      THEN "amountMinor" >= 0
        WHEN 'DELIVERY_OPS_SHARE'         THEN "amountMinor" >= 0
        WHEN 'SUBSCRIPTION_SHARE'         THEN "amountMinor" >= 0
        ELSE TRUE
      END
    ),
  -- Only a driver can hold a driver's delivery share, and only a business can be billed a
  -- subscription. Cheap to state here, impossible to get wrong later.
  ADD CONSTRAINT "PartnerEarning_component_matches_payee"
    CHECK (
      ("component" <> 'DRIVER_DELIVERY_SHARE' OR "payeeType" = 'DRIVER')
      AND ("component" <> 'SUBSCRIPTION_CHARGE' OR "payeeType" = 'BUSINESS')
      AND ("component" <> 'PLATFORM_COMMISSION_SHARE' OR "payeeType" = 'PARTNER')
      AND ("component" <> 'DELIVERY_OPS_SHARE' OR "payeeType" = 'PARTNER')
      AND ("component" <> 'PLATFORM_DELIVERY_SHARE' OR "payeeType" = 'PARTNER')
    );

-- ---------------------------------------------------------------- cash custody and settlement
ALTER TABLE "DriverCashCustody"
  ADD CONSTRAINT "DriverCashCustody_amounts_nonnegative"
    CHECK ("expectedAmountMinor" >= 0 AND "collectedAmountMinor" >= 0 AND "settledAmountMinor" >= 0),
  -- The double-settlement guarantee. Not a service-layer comparison: the database itself refuses
  -- to let more come back than the driver ever took.
  ADD CONSTRAINT "DriverCashCustody_never_oversettled"
    CHECK ("settledAmountMinor" <= "collectedAmountMinor"),
  -- The status must not disagree with the numbers it claims to summarise.
  ADD CONSTRAINT "DriverCashCustody_status_matches_amounts"
    CHECK (
      ("status" = 'OUTSTANDING'       AND "settledAmountMinor" = 0)
      OR ("status" = 'PARTIALLY_SETTLED' AND "settledAmountMinor" > 0
          AND "settledAmountMinor" < "collectedAmountMinor")
      OR ("status" = 'SETTLED'        AND "settledAmountMinor" = "collectedAmountMinor")
    );

ALTER TABLE "CashSettlement"
  ADD CONSTRAINT "CashSettlement_amounts_nonnegative"
    CHECK ("expectedAmountMinor" >= 0 AND "countedAmountMinor" >= 0),
  -- The discrepancy is derived and stored, never inferred at read time, so a later change to how
  -- it is defined cannot restate what was recorded on the night.
  ADD CONSTRAINT "CashSettlement_discrepancy_is_counted_minus_expected"
    CHECK ("discrepancyMinor" = "countedAmountMinor" - "expectedAmountMinor"),
  ADD CONSTRAINT "CashSettlement_driver_is_not_receiver"
    CHECK ("driverUserId" <> "receivedByUserId");

ALTER TABLE "CashSettlementAllocation"
  ADD CONSTRAINT "CashSettlementAllocation_amount_positive"
    CHECK ("amountMinor" > 0);

-- ---------------------------------------------------------------- operating costs
ALTER TABLE "OperatingCostEntry"
  ADD CONSTRAINT "OperatingCostEntry_amount_positive"
    CHECK ("amountMinor" > 0),
  -- An approved cost is a decided cost: it names its approver, when they decided, and the rate set
  -- its three-way split was frozen against. Nothing can be treated as final without all three.
  ADD CONSTRAINT "OperatingCostEntry_approved_is_fully_decided"
    CHECK (
      "status" <> 'APPROVED'
      OR ("approverUserId" IS NOT NULL AND "decidedAt" IS NOT NULL AND "rateSetId" IS NOT NULL)
    ),
  ADD CONSTRAINT "OperatingCostEntry_rejected_is_decided"
    CHECK ("status" <> 'REJECTED' OR ("approverUserId" IS NOT NULL AND "decidedAt" IS NOT NULL)),
  ADD CONSTRAINT "OperatingCostEntry_recurring_has_period"
    CHECK (NOT "isRecurring" OR "periodLabel" IS NOT NULL);

-- ---------------------------------------------------------------- subscriptions
ALTER TABLE "SubscriptionCharge"
  ADD CONSTRAINT "SubscriptionCharge_period_valid"
    CHECK ("periodMonth" BETWEEN 1 AND 12 AND "periodYear" BETWEEN 2000 AND 2200),
  ADD CONSTRAINT "SubscriptionCharge_amount_nonnegative"
    CHECK ("amountMinor" >= 0),
  ADD CONSTRAINT "SubscriptionCharge_waived_charges_nothing"
    CHECK (NOT "isWaived" OR "amountMinor" = 0);

-- ---------------------------------------------------------------- partner payouts
ALTER TABLE "PartnerSettlement"
  ADD CONSTRAINT "PartnerSettlement_exactly_one_payee"
    CHECK (
      (("partnerAccountId" IS NOT NULL)::int + ("businessId" IS NOT NULL)::int
       + ("driverUserId" IS NOT NULL)::int) = 1
      AND ("payeeType" <> 'PARTNER'  OR "partnerAccountId" IS NOT NULL)
      AND ("payeeType" <> 'BUSINESS' OR "businessId" IS NOT NULL)
      AND ("payeeType" <> 'DRIVER'   OR "driverUserId" IS NOT NULL)
    ),
  ADD CONSTRAINT "PartnerSettlement_payee_key_matches"
    CHECK ("payeeKey" = CASE "payeeType"
      WHEN 'PARTNER'  THEN 'PARTNER:'  || "partnerAccountId"::text
      WHEN 'BUSINESS' THEN 'BUSINESS:' || "businessId"::text
      WHEN 'DRIVER'   THEN 'DRIVER:'   || "driverUserId"::text
    END),
  ADD CONSTRAINT "PartnerSettlement_amount_nonzero"
    CHECK ("amountMinor" <> 0),
  ADD CONSTRAINT "PartnerSettlement_period_ordered"
    CHECK ("periodStart" IS NULL OR "periodEnd" IS NULL OR "periodStart" <= "periodEnd");

ALTER TABLE "PartnerSettlementAllocation"
  ADD CONSTRAINT "PartnerSettlementAllocation_amount_nonzero"
    CHECK ("amountMinor" <> 0);

-- ==============================================================================================
-- Immutability.
--
-- A financial record and a ledger row are written once. Corrections are new rows carrying a
-- reason and an actor (FinancialAdjustment), never an edit to what was recorded at the time.
-- These triggers are the enforcement, so the rule survives a service bug or a hand-run UPDATE.
--
-- Genuine data repair — a migration that has to rewrite history — drops the trigger explicitly,
-- does the work, and puts it back. That is deliberately a visible act rather than a quiet one.
-- ==============================================================================================
CREATE OR REPLACE FUNCTION financial_row_is_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'Financial history is append-only: % on % is not permitted. Record a FinancialAdjustment instead.',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PartnerEarning_immutable"
  BEFORE UPDATE OR DELETE ON "PartnerEarning"
  FOR EACH ROW EXECUTE FUNCTION financial_row_is_immutable();

CREATE TRIGGER "OrderFinancialRecord_immutable"
  BEFORE UPDATE OR DELETE ON "OrderFinancialRecord"
  FOR EACH ROW EXECUTE FUNCTION financial_row_is_immutable();

CREATE TRIGGER "CashSettlement_immutable"
  BEFORE UPDATE OR DELETE ON "CashSettlement"
  FOR EACH ROW EXECUTE FUNCTION financial_row_is_immutable();

CREATE TRIGGER "CashSettlementAllocation_immutable"
  BEFORE UPDATE OR DELETE ON "CashSettlementAllocation"
  FOR EACH ROW EXECUTE FUNCTION financial_row_is_immutable();

CREATE TRIGGER "PartnerSettlement_immutable"
  BEFORE UPDATE OR DELETE ON "PartnerSettlement"
  FOR EACH ROW EXECUTE FUNCTION financial_row_is_immutable();

CREATE TRIGGER "PartnerSettlementAllocation_immutable"
  BEFORE UPDATE OR DELETE ON "PartnerSettlementAllocation"
  FOR EACH ROW EXECUTE FUNCTION financial_row_is_immutable();

CREATE TRIGGER "FinancialAdjustment_immutable"
  BEFORE UPDATE OR DELETE ON "FinancialAdjustment"
  FOR EACH ROW EXECUTE FUNCTION financial_row_is_immutable();

-- A rate set is history too: a rate change inserts a new version rather than editing an old one,
-- which is the whole reason yesterday's orders cannot be recomputed by today's percentages.
CREATE TRIGGER "FinancialRateSet_immutable"
  BEFORE UPDATE OR DELETE ON "FinancialRateSet"
  FOR EACH ROW EXECUTE FUNCTION financial_row_is_immutable();

-- ==============================================================================================
-- DriverCashCustody is the one financial table that legitimately changes: settledAmountMinor
-- rises as cash comes back. It may only ever rise, and only those two columns may move.
-- ==============================================================================================
CREATE OR REPLACE FUNCTION driver_cash_custody_settlement_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Cash custody is append-only: a collected amount cannot be deleted.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."settledAmountMinor" < OLD."settledAmountMinor" THEN
    RAISE EXCEPTION 'Settled cash cannot be reduced (% -> %). Record a correcting settlement instead.',
      OLD."settledAmountMinor", NEW."settledAmountMinor"
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."orderId" <> OLD."orderId"
     OR NEW."driverUserId" <> OLD."driverUserId"
     OR NEW."expectedAmountMinor" <> OLD."expectedAmountMinor"
     OR NEW."collectedAmountMinor" <> OLD."collectedAmountMinor"
     OR NEW."orderFinancialRecordId" <> OLD."orderFinancialRecordId" THEN
    RAISE EXCEPTION 'Only the settled amount and status of a cash custody row may change.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DriverCashCustody_settlement_only"
  BEFORE UPDATE OR DELETE ON "DriverCashCustody"
  FOR EACH ROW EXECUTE FUNCTION driver_cash_custody_settlement_only();

-- ==============================================================================================
-- Version 1 of the rate set: the revenue model as agreed today. Inserted here rather than seeded
-- from application code so that every environment — including a fresh deploy — has the rates the
-- accounting layer needs before the first order can be delivered.
-- ==============================================================================================
INSERT INTO "FinancialRateSet" (
  "id", "version", "effectiveFrom", "note", "createdAt",
  "restaurantCommissionBp", "promotionalCommissionBp", "monthlySubscriptionMinor",
  "commissionOwnerAWeight", "commissionOwnerBWeight",
  "supermarketPartnerMarginBp", "ownerAMarginBp", "ownerBMarginBp",
  "supermarketPartnerCostBp", "ownerACostBp", "ownerBCostBp",
  "driverDeliveryShareBp", "deliveryOpsRemainderWeight",
  "ownerADeliveryRemainderWeight", "ownerBDeliveryRemainderWeight"
) VALUES (
  gen_random_uuid(), 1, TIMESTAMP '1970-01-01 00:00:00',
  'Initial revenue model: 20% restaurant commission (15% promotional, subscription waived), 150 ILS monthly subscription, 40/30/30 supermarket margin and cost split, 70% driver delivery share with the remainder divided evenly three ways.',
  NOW(),
  2000, 1500, 15000,
  1, 1,
  4000, 3000, 3000,
  4000, 3000, 3000,
  7000, 1, 1, 1
);

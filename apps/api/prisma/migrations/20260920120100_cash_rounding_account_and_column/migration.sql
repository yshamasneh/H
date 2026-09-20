-- The platform account that holds the cash-rounding surplus. An accounting identity, not a balance.
INSERT INTO "PartnerAccount" (
  "id", "key", "name", "kind", "isActive", "createdAt", "updatedAt"
)
VALUES
  (gen_random_uuid(), 'PLATFORM_ROUNDING', 'JOVO platform (cash rounding)', 'PLATFORM_ACCOUNT', true, now(), now())
ON CONFLICT ("key") DO NOTHING;

-- How much of the cash collected on an order was rounding. Existing records keep 0: they were valued
-- before rounding existed and collected exactly their total.
ALTER TABLE "OrderFinancialRecord" ADD COLUMN "cashRoundingMinor" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "OrderFinancialRecord"
  -- Rounding up to a whole shekel adds between 0 and 99 agorot, and a failed delivery collects
  -- nothing, so it can have no rounding either.
  ADD CONSTRAINT "OrderFinancialRecord_cash_rounding_range"
    CHECK ("cashRoundingMinor" >= 0 AND "cashRoundingMinor" < 100
       AND ("outcome" = 'DELIVERED' OR "cashRoundingMinor" = 0));

ALTER TABLE "PartnerEarning"
  -- The rounding surplus is always a credit, always to a partner-type account (the platform
  -- account), and always comes from an order. It can never be a driver's, a business's, or negative.
  ADD CONSTRAINT "PartnerEarning_cash_rounding_shape"
    CHECK ("component" <> 'CASH_ROUNDING'
       OR ("amountMinor" > 0 AND "amountMinor" < 100 AND "payeeType" = 'PARTNER' AND "sourceType" = 'ORDER'));

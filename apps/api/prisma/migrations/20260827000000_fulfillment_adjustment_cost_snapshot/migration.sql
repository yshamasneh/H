-- ==============================================================================================
-- A fulfillment adjustment now snapshots the cost of what was actually packed, not only its price.
--
-- An approved adjustment replaces a line's effective product and/or its effective quantity, and
-- `lineTotalMinor` already froze what the customer pays for it. Nothing froze what that line
-- *cost*, so the supermarket margin was still computed from `OrderItem.costPriceMinorSnapshot`
-- times the originally ordered integer quantity: the retail side tracked the substitution or the
-- packed weight and the cost side did not.
--
-- The gap cannot be closed by rewriting `OrderItem.costPriceMinorSnapshot`, because the effective
-- quantity is fractional (milli-units) and `OrderItem.quantity` is a whole number — 1.3 kg of
-- tomatoes has no integer representation there. So the effective cost is frozen here, beside the
-- effective price it pairs with, and the order item keeps its honest record of what was ordered.
--
-- Nullable, for the same reason `costPriceMinorSnapshot` is: a line whose product had no recorded
-- cost carries none, and the financial record flags that rather than treating the cost as zero.
-- Existing rows are left NULL deliberately — no cost price exists anywhere to backfill them from,
-- and inventing one would be worse than reporting the record as provisional.
-- ==============================================================================================
ALTER TABLE "FulfillmentAdjustment"
  ADD COLUMN "unitCostMinor" INTEGER,
  ADD COLUMN "lineCostMinor" INTEGER;

ALTER TABLE "FulfillmentAdjustment"
  ADD CONSTRAINT "FulfillmentAdjustment_costs_nonnegative"
    CHECK (("unitCostMinor" IS NULL OR "unitCostMinor" >= 0)
       AND ("lineCostMinor" IS NULL OR "lineCostMinor" >= 0)),
  -- The two travel together: a line cost without the unit cost it came from could not be audited.
  ADD CONSTRAINT "FulfillmentAdjustment_costs_recorded_together"
    CHECK (("unitCostMinor" IS NULL) = ("lineCostMinor" IS NULL));

-- Sale price: an optional per-product price below the regular one.
--
-- MenuItem.salePriceMinor is the price customers pay while a sale is on (NULL = no sale).
-- OrderItem.regularPriceMinorSnapshot freezes the regular price a sale line replaced, so an order
-- can always show what was saved and so a later change to (or removal of) the sale cannot alter a
-- past order: priceMinorSnapshot already holds the price actually charged.
ALTER TABLE "MenuItem" ADD COLUMN "salePriceMinor" INTEGER;
ALTER TABLE "OrderItem" ADD COLUMN "regularPriceMinorSnapshot" INTEGER;

-- The service validates this with a clear message; the constraint is the backstop for any path
-- that writes prices directly (an import, a script), so a "sale" can never be a price rise.
ALTER TABLE "MenuItem"
  ADD CONSTRAINT "MenuItem_sale_price_below_price"
    CHECK ("salePriceMinor" IS NULL OR ("salePriceMinor" >= 1 AND "salePriceMinor" < "priceMinor"));

-- A snapshot of the regular price only makes sense when it was higher than what was charged.
ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_regular_price_above_charged"
    CHECK ("regularPriceMinorSnapshot" IS NULL OR "regularPriceMinorSnapshot" > "priceMinorSnapshot");

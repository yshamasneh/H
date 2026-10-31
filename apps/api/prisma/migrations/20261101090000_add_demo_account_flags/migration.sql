-- Store audit B6/M7: app-review demo accounts and their orders.
-- Additive only: two NOT NULL columns with a constant default (a metadata-only change on
-- PostgreSQL 11+, no table rewrite). Code that does not know the columns keeps working.
ALTER TABLE "User" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;

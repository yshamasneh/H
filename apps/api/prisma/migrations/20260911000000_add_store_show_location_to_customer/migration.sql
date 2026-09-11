-- Per-store toggle governing whether the store's coordinates are shown to customers on its
-- profile. Defaults to false so a store's location stays hidden until an admin explicitly opts
-- it in. Independent of delivery tracking, which reads the coordinates server-side regardless.
ALTER TABLE "Restaurant" ADD COLUMN "showLocationToCustomer" BOOLEAN NOT NULL DEFAULT false;

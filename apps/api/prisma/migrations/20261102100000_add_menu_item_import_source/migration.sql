-- Run 3, task 3: catalogue importer bookkeeping. Additive: two nullable columns and a unique index
-- that every existing row satisfies (NULLs never collide in PostgreSQL).
ALTER TABLE "MenuItem" ADD COLUMN "importSourceId" TEXT;
ALTER TABLE "MenuItem" ADD COLUMN "importChecksum" TEXT;
CREATE UNIQUE INDEX "MenuItem_restaurantId_importSourceId_key" ON "MenuItem"("restaurantId", "importSourceId");

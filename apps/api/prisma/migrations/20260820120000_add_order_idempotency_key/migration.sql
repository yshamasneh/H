-- Order placement idempotency (QA M-1): a client-supplied key dedupes retried checkouts.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "idempotencyKey" UUID;

-- CreateIndex
-- NULLs are distinct in Postgres, so orders without a key never collide; a repeated
-- non-null key for the same customer is rejected at the database level.
CREATE UNIQUE INDEX "Order_customerId_idempotencyKey_key" ON "Order"("customerId", "idempotencyKey");

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'OFFER_ACTIVE';
ALTER TYPE "NotificationType" ADD VALUE 'ANNOUNCEMENT';

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "activationNotifiedAt" TIMESTAMP(3);

-- Mark every offer that is already live as already-announced, so shipping this feature does not
-- retroactively blast every customer about promotions that have been running for a while.
UPDATE "Offer"
SET "activationNotifiedAt" = now()
WHERE "isActive" = true
  AND "startsAt" <= now()
  AND ("endsAt" IS NULL OR "endsAt" > now());

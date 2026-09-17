CREATE TYPE "PushDeliveryStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'AWAITING_RECEIPT',
  'DELIVERED',
  'RETRYABLE_FAILED',
  'PERMANENT_FAILED'
);

CREATE TABLE "PushDelivery" (
  "id" UUID NOT NULL,
  "notificationId" UUID NOT NULL,
  "pushTokenId" UUID NOT NULL,
  "deduplicationKey" TEXT NOT NULL,
  "status" "PushDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "receiptAttemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processingStartedAt" TIMESTAMP(3),
  "expoTicketId" TEXT,
  "lastErrorCode" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PushDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushDelivery_deduplicationKey_key" ON "PushDelivery"("deduplicationKey");
CREATE INDEX "PushDelivery_status_nextAttemptAt_idx" ON "PushDelivery"("status", "nextAttemptAt");
CREATE INDEX "PushDelivery_expoTicketId_idx" ON "PushDelivery"("expoTicketId");
CREATE INDEX "PushDelivery_pushTokenId_status_idx" ON "PushDelivery"("pushTokenId", "status");

ALTER TABLE "PushDelivery"
  ADD CONSTRAINT "PushDelivery_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PushDelivery"
  ADD CONSTRAINT "PushDelivery_pushTokenId_fkey"
  FOREIGN KEY ("pushTokenId") REFERENCES "PushToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;

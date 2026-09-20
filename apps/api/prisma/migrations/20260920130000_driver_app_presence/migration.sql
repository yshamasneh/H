-- Whether a driver's app is running, held as a lease the app renews (see drivers/presence.rules.ts).
-- Additive and nullable: existing drivers start with no lease, so they are not alerted until their
-- app next reports in, which is the safe default for "is this app actually running".
CREATE TYPE "DriverAppState" AS ENUM ('FOREGROUND', 'BACKGROUND');

ALTER TABLE "DriverProfile"
  ADD COLUMN "appState" "DriverAppState",
  ADD COLUMN "appLeaseUntil" TIMESTAMP(3),
  ADD COLUMN "appSeenAt" TIMESTAMP(3);

CREATE INDEX "DriverProfile_status_isOnline_appLeaseUntil_idx"
  ON "DriverProfile"("status", "isOnline", "appLeaseUntil");

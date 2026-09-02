-- Platform-wide configuration held as a single row (id = 'singleton'). Currently
-- carries one policy flag: whether customers may request "no substitution" at
-- checkout. A dedicated settings table rather than a per-product column, because
-- the choice is platform policy, not a property of any one product.
CREATE TABLE "PlatformSetting" (
    "id" TEXT NOT NULL,
    "substitutionOptionEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton row so the setting exists (and defaults to the current
-- behaviour: the substitution option is available) before any admin touches it.
INSERT INTO "PlatformSetting" ("id", "substitutionOptionEnabled", "updatedAt")
VALUES ('singleton', true, CURRENT_TIMESTAMP);

-- CreateEnum
CREATE TYPE "RoleScope" AS ENUM ('PLATFORM', 'BUSINESS');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "platformRoleId" UUID;

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "RoleScope" NOT NULL,
    "permissions" TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessMember" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "invitedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");

-- CreateIndex
CREATE INDEX "Role_scope_idx" ON "Role"("scope");

-- CreateIndex
CREATE INDEX "BusinessMember_userId_isActive_idx" ON "BusinessMember"("userId", "isActive");

-- CreateIndex
CREATE INDEX "BusinessMember_businessId_isActive_idx" ON "BusinessMember"("businessId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessMember_businessId_userId_key" ON "BusinessMember"("businessId", "userId");

-- CreateIndex
CREATE INDEX "User_platformRoleId_idx" ON "User"("platformRoleId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_platformRoleId_fkey" FOREIGN KEY ("platformRoleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessMember" ADD CONSTRAINT "BusinessMember_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessMember" ADD CONSTRAINT "BusinessMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessMember" ADD CONSTRAINT "BusinessMember_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessMember" ADD CONSTRAINT "BusinessMember_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the system roles. Keys are the stable identifiers, so this is idempotent and safe to
-- re-run. SUPER_ADMIN's list is stored in full for readability and for a future roles screen, but
-- authorization treats SUPER_ADMIN as holding every permission implicitly, so a permission added
-- to the catalogue later is included without needing a data change here.
INSERT INTO "Role" ("id", "key", "name", "scope", "permissions", "isSystem", "createdAt", "updatedAt")
VALUES
  (
    gen_random_uuid(), 'SUPER_ADMIN', 'Super Admin', 'PLATFORM',
    ARRAY[
      'MANAGE_BUSINESSES','MANAGE_USERS','MANAGE_ADMINS','MANAGE_ROLES','MANAGE_DRIVERS',
      'MANAGE_OFFERS','VIEW_ACCOUNTING','MANAGE_ACCOUNTING_SETTINGS','MANAGE_PRODUCTS',
      'MANAGE_PRICES','MANAGE_MENU','MANAGE_INVENTORY','VIEW_ORDERS','MANAGE_ORDERS','VIEW_SALES',
      'VIEW_REPORTS','MANAGE_BUSINESS_SETTINGS','MANAGE_BUSINESS_STAFF','VIEW_AUDIT_LOG'
    ]::TEXT[],
    true, now(), now()
  ),
  (
    gen_random_uuid(), 'BUSINESS_ADMIN', 'Business Admin', 'BUSINESS',
    ARRAY[
      'MANAGE_PRODUCTS','MANAGE_PRICES','MANAGE_MENU','MANAGE_INVENTORY','VIEW_ORDERS',
      'MANAGE_ORDERS','VIEW_SALES','VIEW_REPORTS','MANAGE_BUSINESS_SETTINGS',
      'MANAGE_BUSINESS_STAFF','VIEW_AUDIT_LOG'
    ]::TEXT[],
    true, now(), now()
  ),
  (
    gen_random_uuid(), 'BUSINESS_STAFF', 'Business Account', 'BUSINESS',
    ARRAY['VIEW_ORDERS','MANAGE_ORDERS','VIEW_SALES']::TEXT[],
    true, now(), now()
  )
ON CONFLICT ("key") DO NOTHING;

-- Every existing ADMIN becomes a SUPER_ADMIN. Without this the only administrator on the platform
-- would lose access to their own dashboard the moment permission checks start being enforced.
UPDATE "User"
SET "platformRoleId" = (SELECT "id" FROM "Role" WHERE "key" = 'SUPER_ADMIN')
WHERE "role" = 'ADMIN' AND "platformRoleId" IS NULL;

-- Give every existing business owner a BUSINESS_ADMIN membership of their own business, so the
-- access they have today is expressed through membership and nothing they could do before becomes
-- forbidden. Restaurant.ownerUserId is retained as the legal/billing owner.
INSERT INTO "BusinessMember" ("id", "businessId", "userId", "roleId", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), r."id", r."ownerUserId", (SELECT "id" FROM "Role" WHERE "key" = 'BUSINESS_ADMIN'), true, now(), now()
FROM "Restaurant" r
ON CONFLICT ("businessId", "userId") DO NOTHING;

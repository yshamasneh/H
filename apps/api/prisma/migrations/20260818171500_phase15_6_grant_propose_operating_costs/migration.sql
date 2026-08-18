-- Grant PROPOSE_OPERATING_COSTS to the seeded BUSINESS_ADMIN role.
--
-- SystemRolesService deliberately never rewrites a business role's permissions on startup: giving
-- a role a new capability is a decision, not something a deploy should do quietly, and a future
-- roles editor's changes must not be reverted on the next restart. So a new business permission
-- reaching existing roles is exactly this — a reviewed data change.
--
-- Idempotent, and it leaves any role that already has it untouched.
UPDATE "Role"
SET "permissions" = array_append("permissions", 'PROPOSE_OPERATING_COSTS'),
    "updatedAt" = NOW()
WHERE "key" = 'BUSINESS_ADMIN'
  AND NOT ('PROPOSE_OPERATING_COSTS' = ANY("permissions"));

-- SUPER_ADMIN needs no grant: it holds every permission implicitly (see hasPermission), and its
-- stored list is kept complete by SystemRolesService on every start.

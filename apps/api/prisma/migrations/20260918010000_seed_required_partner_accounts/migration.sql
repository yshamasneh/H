-- These are accounting identities, not balances. Existing rows are deliberately left untouched:
-- readiness will reject an existing key whose kind/scope/active state is inconsistent rather than
-- silently changing financial reference data during deploy.
INSERT INTO "PartnerAccount" (
  "id", "key", "name", "kind", "isActive", "createdAt", "updatedAt"
)
VALUES
  (gen_random_uuid(), 'OWNER_A', 'Mohammad (platform owner)', 'PLATFORM_OWNER', true, now(), now()),
  (gen_random_uuid(), 'OWNER_B', 'Khaldoun (platform owner)', 'PLATFORM_OWNER', true, now(), now()),
  (gen_random_uuid(), 'DELIVERY_OPS', 'Abdullah (delivery operations)', 'DELIVERY_OPS', true, now(), now())
ON CONFLICT ("key") DO NOTHING;

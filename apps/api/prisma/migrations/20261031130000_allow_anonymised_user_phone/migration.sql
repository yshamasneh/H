-- Store audit H1: account deletion anonymises a user by replacing the phone with
-- 'deleted-<user id>'. The original E.164-only check (20260804190000_customer_phone_auth) refused that
-- value, so every self-service deletion failed with a constraint violation (HTTP 500).
-- The new check still requires a real +970/+972 number for every live account, and allows the
-- anonymised value only for that same row's own id and only on a deactivated account.
ALTER TABLE "User" DROP CONSTRAINT "User_phone_e164_check";
ALTER TABLE "User" ADD CONSTRAINT "User_phone_e164_check" CHECK (
  "phone" ~ '^\+(970|972)[1-9][0-9]{7,8}$'
  OR ("phone" = 'deleted-' || "id"::text AND "isActive" = false)
);

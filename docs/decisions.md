# Decisions

## 2026-08-04: Persist authentication in PostgreSQL

The earlier Express demo and in-memory users/sessions were replaced by NestJS, Prisma, and PostgreSQL. Database uniqueness on normalized phone is the final duplicate-account protection, with serializable transactions handling signup races.

## 2026-08-04: Phone-only customer identity

Customer registration and login use only `+970` or `+972` phone numbers. The country prefix and local number are separate in the app and normalized with `libphonenumber-js` in both client and server. Public clients cannot choose a role; self-registration always creates `CUSTOMER`.

## 2026-08-04: Free terminal OTP for development

OTP delivery is behind a provider interface. The current provider prints the code only in the NestJS terminal, while PostgreSQL stores an HMAC bound to challenge, phone, and purpose. Production startup rejects this provider. A real WhatsApp Business or SMS implementation can replace the provider without changing auth flow code.

## 2026-08-04: Stateful refresh and reset credentials

Access tokens are short-lived JWTs. Refresh and reset tokens are opaque random values whose hashes are persisted so they can be rotated, revoked, and consumed once. A successful password reset increments the access-token version and revokes all refresh sessions.

## 2026-08-04: Keep the existing native mobile setup

The Expo SDK 54 development-client, checked-in Android project, three-second branded splash, logo asset, SecureStore use, and VS Code tasks were preserved. Authentication screens use the project's existing lightweight conditional navigation style.

The checked-in Android project is the native source of truth. Expo Doctor's app-config synchronization warning is disabled explicitly for that reason; native configuration changes must be applied to Android Studio files as well as app config when applicable. The existing square Android launcher icons remain unchanged, while the wide TasawaQ asset remains the in-app and splash logo.

## 2026-08-04: Use npm workspaces locally

The repository keeps `pnpm-workspace.yaml` for compatibility with the original specification, while exact local commands use the installed npm workspace setup.

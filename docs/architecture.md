# Architecture

TasawaQ is an npm workspace with two runnable applications:

- `apps/mobile`: Expo React Native application and native Android development project.
- `apps/api`: NestJS API backed by PostgreSQL through Prisma.

## Authentication data

`User` is the persistent identity. Public signup can create only `CUSTOMER` users. Phone numbers are unique normalized E.164 values restricted to `+970` and `+972`. Passwords use Argon2id hashes.

`PendingCustomerRegistration` holds a normalized phone, full name, and already-hashed password until phone verification. `PhoneVerificationChallenge` stores HMAC-SHA-256 OTP hashes, purpose, expiration, attempts, resend time, and consumption state. `RefreshSession` stores only a hash of each rotating refresh token. `PasswordResetToken` stores only a hash of each short-lived reset token.

## Signup sequence

1. The app validates the selected prefix, local number, full name, and matching password fields.
2. NestJS repeats validation and normalization and rejects a registered phone with `PHONE_ALREADY_REGISTERED`.
3. In one database transaction, the API upserts the pending registration and creates a signup challenge. Older active signup challenges are consumed.
4. The development provider prints the plain six-digit code only in the API terminal.
5. Verification checks purpose, HMAC, expiry, attempts, and consumed state.
6. A serializable transaction rechecks uniqueness, creates one verified active `CUSTOMER`, consumes the challenge, deletes the pending row, and creates access/refresh credentials.

## Login and session sequence

1. The API normalizes the phone and checks the Argon2id password hash.
2. Inactive or unverified users are rejected. Incorrect phone/password combinations share the generic `INVALID_CREDENTIALS` response.
3. A short-lived access JWT contains only identity/session claims. A rotating refresh token is represented in PostgreSQL by its SHA-256 hash.
4. The access guard verifies the JWT, session, active/verified user, and token version. Logout revokes the refresh session.

## Password reset sequence

1. Forgot Password creates an OTP only when the normalized phone belongs to an existing user.
2. OTP verification creates a random, short-lived, reset-only token and stores only its hash.
3. Password reset consumes the token atomically, changes the Argon2id hash, increments the user's token version, and revokes all refresh sessions.

## Mobile navigation

The mobile app preserves its lightweight typed state navigation instead of introducing a new navigation dependency. Routes cover Login, Customer Sign Up, Forgot Password, reusable OTP verification, New Password, and Home. Access and refresh tokens are stored with Expo SecureStore. The server-provided role controls home routing; the signup UI never accepts a role.

## Development infrastructure

Docker Compose runs PostgreSQL 17 with a health check and named persistent volume. Prisma migration `20260804190000_customer_phone_auth` creates all authentication tables, constraints, enums, indexes, and foreign keys. The native splash, TasawaQ logo, Android project, Expo development-client configuration, and VS Code tasks remain in place.

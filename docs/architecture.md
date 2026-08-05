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

## Restaurants and menus

`Restaurant` belongs to exactly one `RESTAURANT`-role `User` (`ownerUserId`, unique). `status` is `PENDING | APPROVED | REJECTED`; `isOpen` is a separate toggle the owner controls directly. A restaurant only appears in the public catalog when `status = APPROVED AND isOpen = true`; its detail and menu endpoints only require `status = APPROVED`, so a temporarily closed restaurant stays reachable by direct link. `MenuCategory` and `MenuItem` belong to a restaurant; items also belong to a category. `MenuItem.priceMinor` is a Postgres `INTEGER` (never a float), matching the money-handling rule in the product spec. Categories use `isActive` and items use `isAvailable` as soft-disable flags instead of deletion, so historical orders (once orders exist) can still reference a since-hidden item.

### Restaurant onboarding sequence

1. `POST /api/v1/restaurants/register` validates a strong password pair, normalizes the phone the same way customer signup does, and rejects an already-registered phone with `PHONE_ALREADY_REGISTERED`.
2. One transaction creates a `RESTAURANT` `User` (with `phoneVerifiedAt` set immediately — there is no OTP step for restaurant onboarding) and a `PENDING` `Restaurant` owned by that user.
3. The owner logs in through the existing, unmodified `POST /api/v1/auth/login`. They can manage their profile and menu while `PENDING`; only the public catalog is gated on approval.
4. An `ADMIN` calls `POST /api/v1/admin/restaurants/:id/approve` (or `/reject`). Both only accept a restaurant currently in `PENDING` status.

### Restaurant-portal ownership

Every `/api/v1/restaurant/me/...` route resolves the caller's restaurant from `Restaurant.ownerUserId = request.user.id` — never from a client-supplied restaurant id. Where a category or item id does appear in a URL, the service re-verifies that resource's `restaurantId` matches the caller's own restaurant before reading or writing it, returning `404` (not `403`) on a mismatch. Role enforcement is a new `RolesGuard` + `@Roles()` decorator (`common/guards`, `common/decorators`) layered on top of the existing `JwtAuthGuard`, which is reused unchanged.

### Public catalog

`GET /api/v1/restaurants` (paginated), `GET /api/v1/restaurants/:id`, and `GET /api/v1/restaurants/:id/menu` require no authentication. The menu response only includes active categories and available items, each already filtered server-side — the mobile client does no additional filtering.

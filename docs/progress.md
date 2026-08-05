# Progress

## 2026-08-04

Completed:

- Replaced Express in-memory authentication with a validated NestJS API.
- Added Docker Compose PostgreSQL with health check and persistent named volume.
- Added Prisma schema, migration, generated client workflow, and idempotent customer seed.
- Implemented `+970`/`+972` normalization, Argon2id passwords, HMAC OTPs, rate limiting, OTP cooldown/expiry/attempt limits, and purpose isolation.
- Implemented verified customer signup, duplicate protection, login, refresh rotation, logout, current user, forgot password, one-time reset tokens, and refresh-session invalidation.
- Added Login, Customer Sign Up, Forgot Password, reusable OTP, New Password, and Customer Home screens with loading and error states.
- Preserved the TasawaQ logo, three-second splash, Expo development build, native Android project, and VS Code tasks.
- Replaced React Native's deprecated built-in safe-area view with Expo's compatible safe-area module.
- Added backend behavior tests and mobile navigation tests.
- Updated setup, database, development OTP, seed, native Android, and production-provider documentation.

Verified:

- PostgreSQL became healthy and accepted the checked-in migration.
- Running the seed twice left exactly one local test customer.
- The API connected to PostgreSQL and the seeded login worked.
- A live signup printed an OTP in the backend log and created no `User` before verification.
- OTP verification created exactly one active verified `CUSTOMER`.
- Repeating signup returned `PHONE_ALREADY_REGISTERED`, created no duplicate, and printed no new OTP.
- Existing-account password reset worked; reset-token reuse, old password, and old refresh token were rejected.
- Unknown-account forgot password returned `ACCOUNT_NOT_FOUND` without creating a user.
- Data remained after restarting both PostgreSQL and the API.
- Backend and mobile tests, lint, type checking, API build, Prisma generation, and Prisma validation passed.
- Expo Doctor passed 17/17 checks, Metro exported both native bundles, and Android `assembleDebug` completed successfully.
- The rebuilt development client was installed on an emulator; the splash, login, seeded PostgreSQL login, Customer Home, and Metro connection were visually verified without Expo Go.

Remaining production integration:

- Replace the development terminal OTP provider with an approved WhatsApp Business or SMS provider and production delivery/anti-enumeration policies.
- Plan a tested Expo SDK upgrade before production; the current repository audit reports transitive Expo SDK 54 CLI/config advisories whose npm-proposed fix is a breaking Expo 57 upgrade. The API production dependency audit is clean.

## 2026-08-04: Phase 3 — Restaurants & Menus

Completed:

- Added `Restaurant`, `MenuCategory`, and `MenuItem` to the Prisma schema plus migration `20260804200000_restaurants_and_menus`, with `RestaurantStatus` (`PENDING | APPROVED | REJECTED`), an independent `isOpen` toggle, and `priceMinor` stored as a Postgres integer.
- Added restaurant-owner onboarding: `POST /api/v1/restaurants/register` creates a `RESTAURANT`-role `User` and a `PENDING` `Restaurant` together, in a transaction, without a new OTP flow. The owner then logs in through the existing, unmodified `POST /api/v1/auth/login`.
- Added a `RolesGuard` and `@Roles()` decorator (`common/guards`, `common/decorators`) on top of the existing `JwtAuthGuard` to gate the new `RESTAURANT`- and `ADMIN`-only routes.
- Added the restaurant portal: profile read/update, open-status toggle, and full menu category/item CRUD under `/api/v1/restaurant/me/...`, all scoped to the caller's own restaurant — the restaurant id is never taken from the client, and mismatched category/item ids return a generic `404`.
- Added the public catalog: paginated restaurant listing (approved + open only), single-restaurant profile, and menu (active categories, available items only) under `/api/v1/restaurants/...`, no authentication required.
- Added a minimal admin approval flow: `POST /api/v1/admin/restaurants/:id/approve` and `.../reject`, both restricted to a restaurant currently `PENDING`.
- Extended the idempotent seed script with a local `ADMIN` account (`+970590000001` / `Test@12345`) so the approval flow is testable without a real admin panel.
- Added a mobile restaurant browse screen and a restaurant detail/menu screen (no cart — that is Phase 4), reachable from Customer Home via a new "Browse Restaurants" button shown only to `CUSTOMER` accounts.
- Added 14 new backend tests (`restaurants.service.test.ts`, `menu.service.test.ts`) covering registration, approved+open public filtering, active/available menu filtering, and — the security-critical case — that one restaurant cannot read or write another restaurant's category or item. Added 3 new mobile navigation tests for the browse/menu/home transitions.

Verified:

- `npm run typecheck`, `npm run lint`, and `npm test` pass across both workspaces (47 tests total: 37 API, 10 mobile).
- `npm run build --workspace @wasel/api` and `npm run prisma:validate` succeed.
- `npx expo export --platform android` bundles the mobile app cleanly (700 modules) with the new screens wired in.
- The auth module (`apps/api/src/auth/**`) was not modified; restaurant login reuses it as-is.

Remaining before Phase 4 (cart/checkout/orders) can start:

- No mobile UI exists yet for restaurant owners to register, manage their profile, or edit their menu — Phase 3 only required the backend endpoints plus customer-facing browse/menu screens, so owner-side testing currently goes through Swagger (`/api/docs`) rather than the app.
- No admin UI exists yet either; approval also currently goes through Swagger. A real admin panel remains out of scope until its own phase.
- `Restaurant.status` has no `SUSPENDED` state and no endpoint changes an already-approved restaurant's status; that decision is deferred (see `docs/decisions.md`).
- The public menu and detail endpoints are unauthenticated by design (matches the spec), but there is still no rate limiting tuned specifically for catalog browsing beyond the global throttler defaults.
- Phase 4 will need `Order`, `OrderItem`, and a local cart; menu items and categories created in this phase are ready to be referenced by `menuItemId` with server-side price snapshots.

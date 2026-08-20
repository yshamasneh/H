# QA & Pre-Launch Audit Report

_App: **JOVO** — React Native (Expo) customer/driver app + NestJS API + Vite super-admin web. Four roles: customer, driver, restaurant/store admin, super admin. Launch vertical is **JOVO MARKET** (supermarket); the restaurant vertical is built but gated off._
_Audit date: 2026-08-20. Branch: `agent/phase-15-and-jovo-brand`. Scope: static analysis, automated tests, and full manual code review. No code changed except added tests (see below). Nothing was pushed, deployed, or run against remote services._

## Launch Readiness Verdict

**Go with fixes.** The codebase is genuinely strong: server-side RBAC is enforced (not just hidden in the UI), the previously-critical "restaurants are Coming Soon" gate is now closed server-side, auth uses rotating hashed refresh tokens with `tokenVersion` invalidation, order/stock/delivery concurrency is handled with atomic compare-and-swap writes, delete-account really anonymizes, secrets are validated and never shipped, and the production build config is hardened. **No Critical (launch-blocking security or data-loss) issues were found.** However, three High-priority reliability issues degrade real user sessions — a cold launch while offline silently wipes the stored session, there is no mid-session token refresh (15-minute access tokens surface as errors), and driver "live" location is effectively static — and these should be fixed before public release. None require re-architecture.

## Summary

- **Total issues found: 21** (Critical: 0, High: 3, Medium: 8, Low: 6, plus 4 informational strengths noted inline)
- **Test suite status:** API **281 tests, 279 pass, 0 fail** (2 pre-existing `todo`/skipped); Mobile **25 pass, 0 fail**. Total **306 automated tests, 304 passing, 0 failing** after this audit added 8. No coverage tool is configured (project uses `node:test`; there is no `c8`/Istanbul, so a coverage % is unavailable).
- **Typecheck:** clean (0 errors) across all three workspaces **after `prisma:generate`** (see Low-1). "Lint" scripts are `tsc --noEmit` — there is no separate ESLint config.
- **Dependency audit:** 27–28 advisories (15 high, 12–13 moderate), **all in the Expo/Metro build toolchain** (`@expo/config`/`@expo/prebuild-config` via expo-constants/-notifications/-asset/-splash-screen). No server-runtime advisories. See Medium-7.
- **Build status:** Android + iOS config (`apps/mobile/app.json`) is consistent and hardened — same version (0.13.0 / build 13) and bundle id (`com.jovo.app`) on both platforms, `usesCleartextTraffic:false`, `allowBackup:false`, minimal permissions. API compiles clean via `tsc`. _A full EAS/native binary was not produced (out of scope / no remote build)._

---

## Critical Issues (must fix before launch)

**None found.** The two Critical items from the prior audit (`AUDIT_REPORT.md`) are verified fixed on this branch:

- **C-1 (restaurant-ordering gate) — FIXED.** `OrdersService.calculateOrderQuote` now rejects `businessType: RESTAURANT` orders unless `RESTAURANT_ORDERING_ENABLED` is on (`apps/api/src/orders/orders.service.ts:747`), default **false** (`orders.service.ts:736`). The flag is coerced to a real boolean and rejects invalid values (`apps/api/src/config/environment.ts:96,176`), and is wired through `ConfigModule.forRoot({ validate })` (`apps/api/src/app.module.ts:24-28`), so `config.get<boolean>` returns a true boolean, not the truthy string `"false"`.
- **C-2 (public restaurant endpoints) — FIXED.** `listPublicRestaurants` returns empty when the flag is off (`apps/api/src/restaurants/restaurants.service.ts:278`) and single-resource routes throw (`restaurants.service.ts:295,301,669`). Supermarket endpoints remain public by design.

---

## High Priority

### H-1 — Cold launch while offline (or during an API blip) silently clears the stored session
- **File:** `apps/mobile/App.tsx:204-221` (specifically `clearTokens()` at `:218`)
- **What's wrong:** On boot, `restoreSession()` calls `fetchCurrentUser(accessToken)` and, on failure, `refreshSession(...)`. Both are wrapped in one catch-all that runs `await clearTokens()`. A network failure throws `ApiError(0, "NETWORK_ERROR")` (`apps/mobile/src/core/api.ts:1140-1142`) — indistinguishable here from a genuine 401. So launching the app in airplane mode / on a dropped connection / during a backend outage **deletes the user's stored access and refresh tokens**, logging them out permanently until they re-authenticate.
- **Why it matters:** Every returning user on a flaky connection (common for a delivery app) gets logged out through no fault of their own, and loses their saved session. It converts a transient, recoverable condition into a hard logout.
- **Suggested fix:** Only `clearTokens()` when the failure is a real auth rejection (`ApiError.statusCode === 401`). On `NETWORK_ERROR` (statusCode 0), keep the tokens and either retry or boot into an offline/last-known state.

### H-2 — No mid-session token refresh; 15-minute access tokens surface as errors
- **Files:** `apps/mobile/src/core/api.ts:1125-1159` (the shared `request()` has no 401 interceptor); refresh is only performed at cold boot (`apps/mobile/App.tsx:208-216`). Access-token TTL is 900s (`JWT_ACCESS_EXPIRATION_SECONDS`, default `apps/api/src/config/environment.ts:81`, and `.env`).
- **What's wrong:** Screens read the stored token via `getAccessToken()` and call the API directly. When the 15-minute access token expires mid-session, the request returns 401 and the screen shows "session expired"/an error. There is **no silent refresh** — the refresh token is only used once, during app boot. The same pattern exists on the super-admin web, which stores only the access token and never persists the refresh token (`apps/admin/src/api.ts:80` stores `accessToken` only).
- **Why it matters:** Any shopping/checkout session longer than 15 minutes (routine for grocery baskets) starts throwing errors, including potentially mid-checkout, and the only recovery is a full app restart (which triggers the boot refresh). It makes the app feel broken on longer sessions.
- **Suggested fix:** Add a single refresh-on-401 wrapper in `request()`: on a 401, call `refreshSession(storedRefreshToken)` once, save the new tokens, and replay the original request; if refresh fails, then route to login. Persist and use the refresh token on the admin web too.

### H-3 — Driver location is one-shot, not continuous; no background location → "live" tracking doesn't move
- **Files:** `apps/mobile/src/features/driver/screens.tsx:65-74,101-104,106-110` (`refreshLocation` runs only on mount, on go-online, and on pull-to-refresh); the continuous tracker `watchCurrentCoordinates` in `apps/mobile/src/core/location.ts:29-40` (uses `watchPositionAsync`) is **never called** anywhere; `apps/mobile/app.json:34-37,55-58` declares only `WhenInUse` location (no `ACCESS_BACKGROUND_LOCATION`).
- **What's wrong:** The driver's position is pushed to the server (`updateDriverLocation`) only at those three discrete moments. The customer's "Delivery in progress / live updates" card (`apps/mobile/src/features/customer/cart-screens.tsx:842-866`) therefore shows a driver pin that barely changes, and stops updating entirely once the driver backgrounds the app to use turn-by-turn navigation.
- **Why it matters:** Live driver tracking is a core promise of a delivery app; as built it is effectively static. The infrastructure (`watchPositionAsync`, distanceInterval 30 m / 10 s) is already written but not wired up.
- **Suggested fix:** Subscribe to `watchCurrentCoordinates` for the duration of an active delivery and throttle `updateDriverLocation` to it. If tracking must survive backgrounding, add background-location permission + an `expo-location` background task and disclose it in the store listing; otherwise document that tracking is foreground-only.

---

## Medium Priority

### M-1 — No server-side idempotency on order creation (double-tap can duplicate orders)
- **Files:** `apps/api/src/orders/orders.service.ts:64-134` (`createOrder` has no idempotency key/dedup); client guard only in `apps/mobile/src/features/customer/cart-screens.tsx:261-307` (`submit()` sets `loading` and the button is `disabled={loading}`).
- **What's wrong:** The only protection against a double "Place order" is the button's `disabled` flag, which has a brief render-gap between the first tap and the state update. There is no idempotency key on `POST /orders` and no server-side dedup, so two rapid requests create two distinct orders (each decrementing stock).
- **Why it matters:** Duplicate orders → duplicate charges/deliveries and stock over-reservation; the ask ("idempotency protection") is explicitly a launch concern.
- **Suggested fix:** Have the client generate an idempotency key per checkout attempt and send it as a header/field; the API upserts/returns the existing order for a repeated key (a short-TTL unique constraint on `(customerId, idempotencyKey)` is enough).

### M-2 — Mobile API client has no request timeout and no retry/backoff
- **File:** `apps/mobile/src/core/api.ts:1125-1159`
- **What's wrong:** `request()` uses bare `fetch` with no `AbortController`/timeout and no retry. A hung/half-open connection never rejects, so the calling screen's spinner (e.g., the checkout "Place order" button) can spin indefinitely, and a single transient failure breaks the flow with no automatic retry.
- **Why it matters:** The prompt calls out timeout and transient-failure handling explicitly; on mobile networks this is common. Screens do offer manual "Retry" buttons (good), but there is no bounded timeout.
- **Suggested fix:** Wrap `fetch` in an `AbortController` with a sane timeout (e.g., 15–20s) mapped to a `TIMEOUT` `ApiError`, and add a small bounded retry/backoff for idempotent GETs.

### M-3 — Cart is in-memory only; lost on app kill/restart
- **Files:** `apps/mobile/App.tsx:180` (`useState<Cart | null>`), `apps/mobile/src/features/customer/cart.ts` (pure state, no persistence).
- **What's wrong:** The cart lives only in React state. Backgrounding keeps it (JS state retained), but a process kill / restart / OS reclaim drops it entirely. Nothing writes it to SecureStore/AsyncStorage.
- **Why it matters:** Users who get interrupted mid-shop and return after the app is killed lose their whole basket — a common abandonment driver for grocery orders.
- **Suggested fix:** Persist the cart (e.g., AsyncStorage) on change and rehydrate on boot; clear it on successful order placement / logout (both already have the hooks — `onPlaced` and `handleLogout`).

### M-4 — RTL/language toggle depends on `DevSettings.reload()`, which is unreliable in production builds
- **Files:** `apps/mobile/src/i18n/rtl.ts:71-77` (native reload via `DevSettings.reload()`), `apps/mobile/src/i18n/LanguageSwitcher.tsx:22`; `expo-updates` is **not** a dependency (no `Updates.reloadAsync()` available).
- **What's wrong:** Switching language flips `I18nManager.forceRTL` and then relies on `DevSettings.reload()` to re-layout. That API is reliable under the Expo dev client but is not guaranteed in a store (non-dev-client) build, and the code comment itself flags this. After toggling to Arabic in production the app can be left half-mirrored until the user manually kills and reopens it. (Cold start does derive the correct direction from stored language, so new installs and restarts are fine — only the in-session toggle is affected.)
- **Why it matters:** RTL/Arabic is a first-class feature for this market; an unreliable live toggle is a visible defect.
- **Suggested fix:** Add `expo-updates` and call `Updates.reloadAsync()` for the reload (with a graceful "please reopen the app" fallback), or gate the language switch behind an explicit "restart to apply" confirmation.

### M-5 — Realtime: no re-sync on socket reconnect (missed events aren't caught up)
- **Files:** `apps/mobile/src/core/socket.ts:30-66`, `apps/mobile/src/core/order-subscription.ts`
- **What's wrong:** Socket.IO auto-reconnects, and screens re-fetch REST on each received event (a good "event = go re-fetch" design). But nothing triggers a re-fetch **on reconnect**, so any events emitted while the socket was down are simply missed until the *next* event arrives. A driver/customer whose connection drops mid-delivery can see stale status until they pull-to-refresh.
- **Why it matters:** "What happens if the connection drops mid-delivery" is an explicit launch question; today the UI can silently stick on stale state.
- **Suggested fix:** On the socket `connect`/`reconnect` event, invoke the screen's refresh callback once to reconcile.

### M-6 — Super-admin web stores its access token in `localStorage`
- **File:** `apps/admin/src/api.ts:168-174`
- **What's wrong:** The highest-privilege surface (super admin) keeps its bearer token in `localStorage`, which is readable by any injected script (XSS). No refresh token is stored, so sessions also die at 15 minutes (related to H-2).
- **Why it matters:** A token in `localStorage` is directly exfiltratable; on the admin console the blast radius is the whole platform. The short 15-minute TTL limits the window but does not remove the exposure.
- **Suggested fix:** Prefer an httpOnly, `Secure`, `SameSite` refresh cookie with an in-memory access token, or at minimum keep the access token in memory and re-obtain it via a cookie-based refresh. Ensure a strict CSP is set on the admin app.

### M-7 — 27–28 dependency advisories (15 high) in the Expo build toolchain
- **Evidence:** `npm audit` — chains under `@expo/config`/`@expo/prebuild-config` via `expo-constants`, `expo-notifications`, `expo-asset`, `expo-splash-screen`, `expo-manifests`, `expo-dev-client`, `expo-dev-launcher`.
- **What's wrong:** All advisories are in Expo config/prebuild tooling, not in shipped server runtime code (the API tree is clean). Several are pulled by runtime Expo packages, but the vulnerable code paths are config-parsing used at build/prebuild time.
- **Why it matters:** Not exploitable on-device in the usual sense, but 15 high-severity advisories should be tracked and cleared before/around launch, and dev-only packages (`expo-dev-client`/`-launcher`) must not be in the production build.
- **Suggested fix:** Bump to an Expo SDK patch line that resolves the `@expo/config` advisories; confirm `expo-dev-client` is excluded from release builds; re-run `npm audit` and record residuals.

### M-8 — Revenue/stats summed in JS instead of SQL aggregate
- **Files:** `apps/api/src/restaurants/restaurants.service.ts:186-197` (`periodStats` does `findMany(... select totalMinor).reduce(...)`), `restaurants.service.ts:493-497` (`adminGetRestaurant`); same pattern in the admin dashboard revenue.
- **What's wrong:** "Today/month/total revenue" is computed by loading every delivered order into memory and reducing in JS, rather than a `prisma.aggregate({ _sum })`/`groupBy`.
- **Why it matters:** Correct today, but memory and latency grow linearly with order volume; a high-traffic store's dashboard/admin will slow down and pressure memory. (Carried over from prior audit M-1.)
- **Suggested fix:** Replace with `aggregate`/`groupBy _sum: { totalMinor }` filtered by status/date.

---

## Low Priority / Nice-to-have

### L-1 — Build depends on `prisma:generate` running first (stale generated client fails `tsc`/tests)
- **Evidence:** A fresh `npm run typecheck` failed with ~10 TS errors in `apps/api` (`orders.service.ts` `financialRateSetId`/`isPromotionalPartner`, `phase11.e2e.test.ts` accounting models) until `npm run prisma:generate` was run, after which typecheck is clean.
- **Why it matters:** A CI job or new contributor that runs `tsc`/tests without the prebuild step will see spurious failures. The generated client (`apps/api/src/generated/`) is gitignored, so it must be built.
- **Suggested fix:** Make `prisma:generate` a `pretest`/`pretypecheck`/CI prebuild step so ordering can't be missed.

### L-2 — Tap targets below 44×44 on cart controls
- **File:** `apps/mobile/src/features/customer/cart-screens.tsx` — `stepperButton` and `removeButton` are 32×32 (styles ~`:1021-1033`).
- **Why it matters:** Below the ~44pt minimum recommended touch target; fiddly for quantity edits. (Primary CTAs are 52–54pt and icon header buttons are 44×44 — those are fine.)
- **Suggested fix:** Increase hit area (size or `hitSlop`) to ≥44×44.

### L-3 — Checkout quote not invalidated when the address text is edited
- **File:** `apps/mobile/src/features/customer/cart-screens.tsx:346-372` — editing the address `TextInput` doesn't reset `quote` (only `selectSavedAddress`/`chooseMapLocation` do).
- **Why it matters:** The displayed delivery quote can reflect a different address string than what's typed. The **charge is correct** because `createOrder` recomputes server-side (`orders.service.ts:67`), so this is display-only.
- **Suggested fix:** Reset `quote` to `null` in the address `onChangeText`, forcing a recalculation before "Place order".

### L-4 — Residual PII in historical orders after account deletion
- **File:** `apps/api/src/users/users.service.ts:106-134` — anonymizes the `User` and deletes addresses/tokens, but past orders keep their `deliveryAddressLine`/`customerNote` snapshots.
- **Why it matters:** Reasonable for financial/audit retention, but the delivery address and any notes from prior orders remain readable after "delete account." Worth a conscious data-retention decision for GDPR-style requests.
- **Suggested fix:** Decide policy explicitly; if needed, scrub `deliveryAddressLine`/`customerNote` on terminal orders during deletion, or document the retention rationale.

### L-5 — A couple of non-virtualized lists
- **Files:** `apps/mobile/src/features/driver/screens.tsx:222,246` (available/active deliveries via `.map()` in a `ScrollView`); several admin list screens do the same.
- **Why it matters:** Fine at current scale (server caps most lists), but "available deliveries" is unbounded and could grow in a busy area. Note: the primary customer catalog correctly uses a virtualized `FlatList numColumns={2}` and the home preview is capped at 8 items, so the main flows are fine.
- **Suggested fix:** Move the driver available-deliveries list (and large admin tables) to `FlatList`.

### L-6 — Dead code: the continuous location tracker
- **File:** `apps/mobile/src/core/location.ts:29-40` — `watchCurrentCoordinates` is exported but unused; it is the intended fix for H-3.
- **Suggested fix:** Wire it into the driver active-delivery flow (see H-3) or remove it.

---

## Verified Strengths (context for the verdict — not issues)

- **Authorization is server-enforced, not UI-only.** The mobile app's role routing (`homeForUser`, `App.tsx`) is presentation only; every privileged endpoint runs `JwtAuthGuard` + `PermissionsGuard`/`RolesGuard` (`apps/api/src/common/guards/permissions.guard.ts`), super-admin bypass is explicit, and business-scoped data resolves to the caller's own business (`requireOwnRestaurant`). A customer token cannot reach driver/admin operations by manipulating client state.
- **Auth/session hygiene:** rotating refresh tokens with atomic revoke-and-reissue, refresh tokens hashed and constant-time compared, JWT guard re-checks session revocation + `tokenVersion` + `isActive` + `phoneVerifiedAt` on every request (`apps/api/src/auth/jwt-auth.guard.ts:46-61`), serializable OTP transactions with retry, OTP hashed + attempt-limited + resend cooldown. On native, tokens are in `expo-secure-store` (`apps/mobile/src/core/session.ts`). _(Web build uses `sessionStorage` — acceptable for the non-native target.)_
- **Delete-account truly anonymizes** (scrubs name/phone/email/password, revokes sessions, bumps `tokenVersion`, deletes addresses/push tokens, writes an audit log) rather than just signing out — now covered by the tests added below.
- **Order/stock/delivery concurrency** uses atomic compare-and-swap (`updateMany where status = expected`, stock `decrement where gte`, delivery claim `where driverId: null`), preventing double-accept and oversell.
- **Config & secrets are validated and safe:** production rejects placeholder secrets, `*` CORS, non-HTTPS, and dev OTP provider (`apps/api/src/config/environment.ts`); the mobile client throws unless `EXPO_PUBLIC_API_URL` is HTTPS in release (`apps/mobile/src/core/api.ts:365-367`). The root `.env` is dev-only and gitignored; no secrets or non-localhost URLs are hardcoded in source (only the public Leaflet CDN on the web map). 500s return a generic message with no stack trace (`apps/api/src/common/all-exceptions.filter.ts`).
- **Build config hardened:** minimal Android permissions with sensitive ones explicitly blocked, `usesCleartextTraffic:false`, `allowBackup:false`, consistent version/bundle-id across platforms.

---

## Missing Test Coverage

The API service layer is well tested (281 tests) via an in-memory `fake-prisma`. Gaps that remain, and why:

- **Mobile app behavior is essentially untested at the UI/integration level.** Tests are pure-logic only (`cart.ts`, `navigation.ts`, `socket.ts`); there is no React Native Testing Library / render harness. In particular there is **no test for the session-restore/`clearTokens` logic** (the H-1 bug would have been caught), the checkout **double-submit guard** (M-1), or the **RTL reconcile** path (M-4). Adding RNTL would need test-runner/babel setup that isn't currently present.
- **End-to-end order lifecycle against a real DB** (checkout → placed → accepted → preparing → ready → delivered/cancelled, with stock and delivery) exists (`apps/api/src/integration/*.e2e.test.ts`) but is **gated** behind `RUN_DATABASE_E2E=true` + a Postgres instance + applied migrations, so it does not run in the default `npm test`.
- **Socket reconnect / catch-up** (M-5) is not exercised.
- **Order idempotency / double-submit** (M-1) has no test because the protection doesn't exist yet server-side.

## Tests Added During This Audit

- **`apps/api/src/users/users.service.test.ts`** (8 tests, all passing) plus its harness **`apps/api/src/users/testing/fake-prisma.ts`** — `UsersService` previously had **no test file**, despite owning two prompt-critical flows (delete-account and saved-address CRUD). New coverage:
  1. `deleteMyAccount` anonymizes the customer and scrubs linked data (name → "Deleted account", email → null, password → "DELETED", `isActive` false, `phone` prefixed `deleted-`, `tokenVersion` incremented), deletes addresses + push tokens, revokes live refresh sessions, and writes a `CUSTOMER_ACCOUNT_DEACTIVATED` audit log.
  2. `deleteMyAccount` refuses non-customer (store/driver/admin) accounts with `ACCOUNT_DELETION_SUPPORT_REQUIRED` and leaves their data intact.
  3. `deleteMyAccount` rejects an already-deleted (inactive) account.
  4. First saved address is forced to be the default.
  5. Marking a new address default demotes the previous default (exactly one default invariant).
  6. Deleting the default address promotes another saved address to default.
  7. A customer cannot **delete** another customer's saved address (`ADDRESS_NOT_FOUND`, cross-user isolation).
  8. A customer cannot **update** another customer's saved address (`ADDRESS_NOT_FOUND`).

  Run: `cd apps/api && node --import tsx --test src/users/users.service.test.ts` → 8/8 pass. Full API suite remains green (281 tests, 279 pass, 0 fail) and typecheck is clean.

## Code Changes Made During This Audit

- **No application/source code was modified.** Only the two test files above were added (`apps/api/src/users/users.service.test.ts`, `apps/api/src/users/testing/fake-prisma.ts`).
- I ran `npm run prisma:generate`, which regenerated `apps/api/src/generated/` (gitignored build output, not source) — required for typecheck to pass (see L-1). No committed files were altered by this.

## Assumptions Made

- **Test credentials / running backend:** none were provided, so I did not exercise live endpoints or produce a native binary. I relied on the in-memory `fake-prisma` unit suites, `tsc`, `npm audit`, and static review. The DB-backed e2e suite (`RUN_DATABASE_E2E`) was not run because it needs a Postgres instance and applied migrations.
- **Backend URL / env:** the root `.env` is a development config (localhost, `NODE_ENV=development`, dev secrets). I assumed production is deployed with a real env; the env validator (`config/environment.ts`) enforces HTTPS/secret/CORS rules in production, so the dev values cannot leak to a prod build.
- **`RESTAURANT_ORDERING_ENABLED` is intended off at launch** (JOVO MARKET only); I treated the restaurant vertical being gated as by-design, not a defect.
- **Web build of the mobile app is a secondary target;** I weighted native (Expo iOS/Android) behavior as primary, which is why `sessionStorage` token storage on web is noted as acceptable rather than flagged.
- **Severity calls** reflect user/business impact for a pre-launch food-delivery app; where a finding is recoverable (e.g., by restart or re-login) I rated it below Critical even when user-visible.

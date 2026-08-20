# Fix Report — H-1, H-2, M-3 + Test Coverage

_Follow-up to `QA_REPORT.md`. All work is local; nothing was pushed, deployed, or run against remote services. Re-verified with a full test + typecheck run immediately before writing this._

## Summary
- **Issues fixed:** H-1 (**fixed**), H-2 (**fixed** — mobile + admin), M-3 (**fixed**). One small in-scope hardening was added to the checkout double-submit guard so its UI test is meaningful (see M-1 note under "UI test harness").
- **Test harness added:** yes — `@testing-library/react-native` on `jest-expo`, running as a separate `test:ui` script alongside the existing `node:test` `test:unit` suite (both rolled into `npm test`).
- **DB-backed E2E:** **ran** against a real PostgreSQL 17 — **21/21 passing** (`RUN_DATABASE_E2E=true`).
- **Full suite status after all changes:** **337/337 runnable passing, 0 failures, 0 regressions** (2 pre-existing `skipped` in the API suite remain skipped). Broken down: Admin 3, API 281 (279 pass + 2 skipped), Mobile unit 50, Mobile UI 5. The 21 DB-E2E tests run via the separate `test:e2e` script (real Postgres) and also pass. Typecheck: **0 errors** across all three workspaces.
- Net new automated tests this session: **33** (25 mobile unit + 5 mobile UI + 3 admin), plus the 21 DB-E2E that were previously never executed.

Baseline before this session was 306 passing (281 API + 25 mobile); all 306 still pass.

---

## H-1 — Offline cold launch

**Root cause:** `App.tsx`'s boot wrapped both `fetchCurrentUser` and the fallback refresh in one catch-all that always called `clearTokens()`. A `NETWORK_ERROR` (statusCode `0`) at launch was indistinguishable there from a real `401`, so an airplane-mode / backend-outage launch silently wiped the session.

**Fix:** The restore decision is now a pure, injectable function that clears tokens **only** on a genuine `401`, keeps them on any network/other failure, and boots into an offline state using a locally cached identity.

### Files changed
- `apps/mobile/src/core/session-restore.ts` **(new)** — pure `restoreSession(deps)` returning `authenticated | offline | signed-out | unauthenticated`; `isAuthRejection()` (401-only). Heavily commented so the 401-vs-network distinction isn't "simplified" back.
- `apps/mobile/src/core/api-error.ts` **(new)** — `ApiError` extracted into a leaf module (no react-native/i18n imports) so the pure logic and its tests can depend on it; `isUnauthorized()` helper.
- `apps/mobile/App.tsx` — boot now calls `restoreSession(...)`; `authenticated`/`offline`(with cached user) → home; `signed-out`/`unauthenticated` → login. Added `getCachedUser` to the deps.
- `apps/mobile/src/core/session.ts` — persists a cache of the last `PublicUser` (identity only, never a credential) on `saveTokens`; `getCachedUser()`/clear on `clearTokens`.

### Tests added
- `apps/mobile/src/core/session-restore.test.ts` (7): no token → unauthenticated (tokens untouched); success → authenticated; **401 → tokens cleared, signed-out**; **network error (statusCode 0) → tokens kept, boots offline with cached user**; offline with no cached user → offline/null; non-`ApiError` throw → offline (kept); 5xx → offline (kept).

### Notes / edge cases
- Offline boot deliberately reuses the app's existing per-screen "couldn't load — pull to refresh" states (e.g. the home screen's "market unavailable" card) rather than adding a new offline banner.
- A `signed-out`/`unauthenticated` boot also clears the in-memory cart, so a logged-out user never sees a stale basket.

---

## H-2 — Mid-session token refresh

**Root cause:** the shared `request()` had no 401 handling, and refresh only ran at cold boot; 15-minute access tokens surfaced mid-session as errors. The admin web persisted only the access token, so it couldn't refresh at all.

**Fix (mobile):** `request()` now transparently refreshes the access token once on a 401 and replays the original request with the new token. Concurrent 401s share a **single** in-flight refresh (no refresh storm). It never refreshes for the refresh endpoint itself or for unauthenticated calls, so it can't recurse; if the refresh token is itself rejected (401) the session is cleared, matching H-1's distinction.

**Fix (admin web):** the refresh token is now persisted and used with the same refresh-on-401 + single-flight behavior, so super-admin sessions survive past 15 minutes.

### Files changed
- `apps/mobile/src/core/auth-retry.ts` **(new)** — `createRefreshCoordinator` (single-flight) + `sendWithAuthRetry` (refresh-once-and-replay). Pure/injectable.
- `apps/mobile/src/core/api.ts` — imports `ApiError` from the leaf module and re-exports it (keeps every `import { ApiError } from "./api"` working); adds `performTokenRefresh` + a module-level coordinator; `request()` now routes through `sendWithAuthRetry`.
- `apps/admin/src/auth-retry.ts` **(new)** — the same coordinator/retry for the web client.
- `apps/admin/src/api.ts` — `refreshTokenStorageKey`, `getRefreshToken`/`setRefreshToken`, `storeSession`/`clearSession`; `performTokenRefresh` (raw fetch, can't recurse) + coordinator; `request()` refreshes-and-replays on 401 and only clears the session on a surviving 401.
- `apps/admin/src/auth.tsx` — `storeSession(result)` on sign-in; `clearSession()` on sign-out and on a not-admin restore; the boot `catch` now clears **only** on a 401 (mirrors H-1) instead of on any error.
- `apps/admin/package.json` — added a `test` script so the admin workspace runs under `node:test`.

### Tests added
- `apps/mobile/src/core/auth-retry.test.ts` (8): concurrent callers share one refresh; coordinator refreshes again after settling; non-401 passes through without refreshing; **401 → refresh once → replay with new token**; no refresh when `canRefresh` is false (the refresh call itself) or for unauthenticated requests; refresh-returns-null surfaces the original 401 with no replay; **many concurrent 401s trigger exactly one refresh**.
- `apps/admin/src/auth-retry.test.ts` (3): concurrent 401s share one refresh; 401 → refresh → replay with new token; **the refresh token is persisted on sign-in and read back for a refresh** (with a small in-test `localStorage` shim).
- API side: refresh-token rotation is already covered by `apps/api/src/auth/auth.service.test.ts` and exercised end-to-end by the DB-E2E; not duplicated.

### Notes (incl. admin web and the M-6-adjacent decision)
- **M-6 (access token in `localStorage`) — deliberately scoped:** the required H-2 fix persists the *refresh* token and adds refresh-on-401. Moving the *access* token to memory-only would change the admin boot/reload flow (every reload would need a network refresh, and would fail offline) — the exact "large unrelated refactor" the task warned against — so it is left as a follow-up. Net security posture is unchanged, not worse: no new secret is exposed that wasn't already, and the short 15-minute access-token TTL still bounds exposure.

---

## M-3 — Cart persistence

**Root cause:** the cart lived only in React state and was lost on app kill/restart.

**Fix:** the cart is persisted on every change, rehydrated at boot before the first customer screen renders, cleared on placed-order and logout, and any corrupt/unreadable stored payload degrades to an empty cart instead of crashing.

### Files changed
- `apps/mobile/src/core/cart-storage.ts` **(new)** — pure `serializeCart`/`deserializeCart` (strict shape validation → `null` on anything malformed) and `createCartRepository(store, onWarn)` over a small `KeyValueStore` interface. All reads/writes are fail-soft.
- `apps/mobile/src/core/kv-storage.ts` **(new)** — the backing for that interface, using **AsyncStorage** (no size cap; ships a web impl over `localStorage`), so large carts persist on every platform. See the corrected "Storage choice" note below for why this isn't SecureStore.
- `apps/mobile/src/core/session.ts` — exposes a `cartRepository`; `clearTokens()` now also clears the persisted cart (and cached user), so logout/dead-session drops the basket.
- `apps/mobile/App.tsx` — hydrates the cart in the boot sequence (gated behind a `cartHydrated` flag so the first empty render can't overwrite it), then persists every cart change via one effect. `onPlaced` and `handleLogout` already set `cart = null`, which the effect turns into a storage clear.

### Tests added
- `apps/mobile/src/core/cart-storage.test.ts` (10): **survives a simulated restart** (save → fresh repository over the same store → identical items); **`save(null)` clears** (placed order / logout); `clear()` removes; an emptied cart clears; **corrupt stored data doesn't crash and loads empty (with a warning)**; well-formed-but-wrong-shape JSON rejected; serialize↔deserialize round trip; **a large 25-item (>2KB) Arabic cart round-trips with no loss or truncation**; a storage write failure is swallowed; a storage read failure degrades to empty.

### Notes
- **Storage choice (corrected after review):** the cart is backed by **`@react-native-async-storage/async-storage`** (installed via `npx expo install`, SDK-aligned `2.2.0`), not SecureStore. An initial version reused SecureStore for consistency with `session.ts`, but measuring a realistic basket showed SecureStore's ~2KB/value Android cap is exceeded at **~13–15 items** (worse with Arabic names, 2 bytes/char in UTF-8 — a 20-item cart serializes to ~3.2–3.7KB). Above that cap SecureStore warns and fails to persist, and because `save()` is fail-soft that failure would be **silent** — losing exactly the large carts M-3 exists to protect. AsyncStorage has no such limit (~6MB on Android) and ships a web implementation over `localStorage`, so it now backs every platform (tokens stay in SecureStore). The `KeyValueStore` seam is unchanged, so this was a one-file swap in `kv-storage.ts`. A round-trip test with a 25-item (>2KB) Arabic cart guards against regression.

---

## UI test harness

**Stack:** `jest-expo` + `@testing-library/react-native`, kept separate from the fast pure-logic `node:test` suite.

- `apps/mobile/package.json`: `test` = `test:unit && test:ui`; `test:unit` = the existing `node:test` command; `test:ui` = `jest`. Dev deps added: `jest-expo@~54`, `jest@^29.7`, `@testing-library/react-native@^13.3`, `react-test-renderer@19.1`, `@types/jest@^29`.
- `apps/mobile/jest.config.js`, `apps/mobile/babel.config.js` **(new)**. Jest only picks up `*.ui.test.tsx`; the `node:test` files (`*.test.ts`) are excluded, so the two runners never touch each other's files.

**How to run:** `npm run test:ui -w @wasel/mobile` (or `npm run test:unit -w @wasel/mobile`, or `npm test -w @wasel/mobile` for both).

### Coverage added beyond the three fixes
- `apps/mobile/src/features/customer/checkout.ui.test.tsx` (2): **a rapid double-tap on "Place order" submits exactly one order** (M-1 UI guard), and "Place order" is refused until a delivery quote is calculated.
- `apps/mobile/src/i18n/LanguageSwitcher.ui.test.tsx` (2): the switcher renders both language options in the Arabic/RTL default and after switching to English/LTR, without crashing.
- `apps/mobile/src/harness.ui.test.tsx` (1): a one-line sanity check that fails fast if the harness itself breaks.

### M-1 UI-guard note (small extra code change)
The double-submit test needs the guard to actually stop a *same-frame* second tap. The pre-existing `disabled={loading}` only takes effect on the next render, so two taps in one frame both slip through. I added a synchronous `useRef` lock in `CheckoutScreen.submit()` (`apps/mobile/src/features/customer/cart-screens.tsx`) that flips before the first `await` and resets in `finally`. This is UI-guard hardening only — the server-side idempotency half of M-1 remains out of scope, as instructed.

---

## Database-backed E2E

**Ran — 21/21 passing.** Docker Desktop was not running at first; I started it, and a `postgres:17-alpine` container (`tasawaq-postgres`, port 5432) came up. Steps taken (all local, against the `tasawaq_test` database — localhost + a name containing "test", which satisfies the suite's `assertSafeE2eDatabase` guard, so the dev `tasawaq` DB was untouched):

1. Confirmed/created the `tasawaq_test` database.
2. `npm run prisma:deploy` — applied all migrations (3 pending accounting migrations applied).
3. `npm run prisma:seed` — seeded roles/fixtures.
4. `npm run test:e2e` — builds the API, then runs `dist/integration/phase11.e2e.test.js` + `dist/integration/accounting.e2e.test.js` with `RUN_DATABASE_E2E=true RESTAURANT_ORDERING_ENABLED=true`.

Result: **`tests 21, pass 21, fail 0`** (the accounting money-split/cash-custody/immutability suite plus the phase-13 delivery→grocery→cash→inventory lifecycle). Observed non-fatal `pg` deprecation warnings ("client.query() while already executing a query") — pre-existing, matching M-3 in the original `AUDIT_REPORT.md`; no failures.

To reproduce elsewhere (e.g. CI): a reachable PostgreSQL, root `.env` `DATABASE_URL` pointing at a localhost or `*test*` database, `prisma migrate deploy` + `prisma db seed`, then `npm run test:e2e`.

---

## Full Test Suite Result

Commands run (from repo root), all green:

- `npm run typecheck` → **0 errors** (admin, api, mobile).
- `npm test` → Admin **3/3**, API **281 (279 pass, 2 skipped, 0 fail)**, Mobile unit **50/50**, Mobile UI **5/5** → **337 runnable pass, 2 skipped, 0 fail, 0 regressions**.
- `npm run test:e2e` (real Postgres) → **21/21**.

---

## Anything deliberately left out of scope
- **M-1 server-side idempotency** (idempotency key on `POST /orders`): out of scope per the task; only the UI double-submit guard was covered/hardened here.
- **M-6 memory-only admin access token:** left as a follow-up to avoid the admin boot/reload refactor the task cautioned against; the required refresh-token persistence + refresh-on-401 are done.
- _(Resolved during review) Cart storage:_ initially reused SecureStore; on measuring that its ~2KB Android cap silently drops carts of ~15+ items, switched the cart to AsyncStorage. See the M-3 "Storage choice" note.
- **`pg` "query while already executing" deprecation warnings** surfaced by the E2E: pre-existing (original audit M-3), not a regression from this work, so not addressed here.

---

# Fix Report — M-2, M-4, M-5, M-7, M-8 (2026-08-20, round 2)

_Second fix round, building on the H-1/H-2/M-3 work above. Five more Medium findings. All local; nothing pushed/deployed. Full suite (unit + UI + DB-backed E2E) re-run and re-confirmed immediately before writing — numbers at the bottom._

## M-2 — Request timeout + bounded GET retry
- **Files changed:**
  - `apps/mobile/src/core/http-retry.ts` **(new)** — pure, injectable primitives: `fetchWithTimeout` (AbortController timeout → `TIMEOUT` `ApiError`; other transport failures → `NETWORK_ERROR`), `runWithRetry` (bounded retry with injectable sleep), `isTransientError`, and `retryPolicyFor(method)` (GET → 3 attempts, everything else → 1).
  - `apps/mobile/src/core/api.ts` — `request()` now sends through `fetchWithTimeout` (20s per attempt) and wraps the H-2 `sendWithAuthRetry` call in `runWithRetry(retryPolicyFor(method))`.
  - `apps/mobile/src/i18n/locales/{en,ar}/common.json` — `requestTimeout` message.
- **Tests added:** `apps/mobile/src/core/http-retry.test.ts` (10) — a hung request aborts with `TIMEOUT`; a GET that fails transiently once then succeeds is retried; a **mutation (POST/PATCH/DELETE) is not auto-retried**; a non-transient HTTP 500 is not retried even for a GET; a persistently-timing-out GET stops after exactly `maxAttempts` with exponential backoff `[300,600]`; a transport failure becomes `NETWORK_ERROR`; and a combined timeout-then-401-then-success stays within the attempt cap.
- **Key decisions:**
  - **Only idempotent GETs are auto-retried.** M-1 (order-creation idempotency key) is out of scope/not landed, so no mutation carries a dedup key — blindly replaying a POST could double-apply it. `retryPolicyFor` gives non-GETs `maxAttempts: 1`.
  - **Composes with H-2 without runaway.** A 401 comes back as a *Response* (handled once by `sendWithAuthRetry`, never retried by `runWithRetry`); a timeout/network error is *thrown* (retried by `runWithRetry`, never by the auth layer). The two never feed each other, so total attempts are hard-capped at `maxAttempts × (1 request + 1 refresh-replay)` — a test asserts the cap explicitly.

## M-4 — RTL/language reload via expo-updates (not DevSettings.reload)
- **Files changed:**
  - Added dependency **`expo-updates@29.0.20`** (via `npx expo install`, SDK-54 aligned).
  - `apps/mobile/src/i18n/reload.ts` **(new)** — pure `performReload(deps)`: web → page reload; native → `reloadNative()` (wired to `Updates.reloadAsync()`), returning `false` if it throws so the caller can fall back.
  - `apps/mobile/src/i18n/rtl.ts` — `reloadApp()` now returns `Promise<boolean>` and uses `Updates.reloadAsync()`; removed the `DevSettings` import/usage.
  - `apps/mobile/src/i18n/LanguageSwitcher.tsx` — awaits the reload; on `false` shows the existing `common:restartRequiredBody` ("please restart") message instead of a silent no-op.
  - `apps/mobile/App.tsx` — boot's rare reconcile-reload is now `void reloadApp()` (fire-and-forget).
- **Tests added:** `apps/mobile/src/i18n/reload.test.ts` (3, node) — native-success → `true`, native-failure → `false`, web path. `LanguageSwitcher.ui.test.tsx` grew to 4 (RNTL): renders both directions, **switching direction triggers the reload path**, and **when reload is unavailable the manual-restart message is shown**.
- **Key decisions:** cold-start direction derivation is untouched (it never called `reloadApp`; only the in-session toggle did). The UI test mocks `./rtl` so it controls the reload outcome and doesn't load the native `expo-updates` module.

## M-5 — Socket reconnect re-sync
- **Files changed:**
  - `apps/mobile/src/core/reconnect-resync.ts` **(new)** — pure `createReconnectResync(onResync, {debounceMs, timers})`: skips the first `connect` (screen already loaded on mount), debounces subsequent reconnects (default 500ms), exposes `cancel()`.
  - `apps/mobile/src/core/order-subscription.ts` — `attachOrderSubscription` now listens for the socket's `connect` event; on a *reconnect* it re-emits `order.subscribe` (re-joins the room after the socket id changes) and calls the screen's `onChange` once to refetch. Cleanup offs the handler and cancels any pending resync. New optional `resync` option injects timers for tests.
- **Tests added:** `apps/mobile/src/core/reconnect-resync.test.ts` (4) — initial connect → no refetch; a reconnect → exactly one refetch; **rapid flapping → a single refetch (no storm)**; `cancel()` prevents a pending resync. `socket.test.ts` +1 integration test drives the fake socket through connect→reconnect and asserts re-subscribe + one refetch (and the pre-existing "normal event still refetches" test is unchanged).
- **Key decisions:** REST stays the source of truth, so "reconnect" just means "refetch once"; debounce guards against reconnect flapping.

## M-7 — Dependency advisories
- **Files changed:** `apps/api/package.json` (`@nestjs/swagger` `11.4.5` → `^11.4.7`); root `package.json` (`overrides: { "nanoid": "^3.3.18" }`).
- **Before → after:** `npm audit` **30 → 28** advisories. The swagger bump cleared **2 high** (`@nestjs/swagger` + its `js-yaml`).
- **Key decisions & residual advisories (honest):**
  - A full SDK bump was **rejected** as too risky per the task: the only "fix" npm offers for the Metro/Expo build chain (`metro`, `metro-config`, `metro-transform-worker`, `image-size`, `postcss`, `uuid`, `xcode`) is `expo@57.0.14` — an SDK 54→57 major jump that would reopen the jest-29 pin from the last round and bump React Native. These are **build/prebuild-time tooling, not shipped in the release JS bundle or native binary**, so they are not a production runtime surface; left as residual.
  - The `prisma` / `@prisma/config` / `deepmerge-ts` advisories only "fix" by **downgrading Prisma 7→6** (major, breaking) — not viable; left as residual.
  - The `nanoid` (high, via `postcss`) override was added in the correct form, but **this environment's npm (12.0.2) does not apply the root `overrides` field** (verified: the lockfile's `overrides` stays undefined and `nanoid` stays `3.3.17` across a clean lockfile regen and both the plain and selective override syntaxes). The override is left in place because it is correct and will apply under a standard npm in CI; it did **not** reduce the count in this run, and I report the count I actually measured (28), not a hypothetical.
  - **Dev-client is dev-only:** `apps/mobile/eas.json` enables `developmentClient: true` only on the `development` profile; the `preview` and `production` profiles do not, so `expo-dev-client`/`expo-dev-launcher` are excluded from release builds.

## M-8 — Revenue/stats via SQL aggregate
- **Files changed:**
  - `apps/api/src/restaurants/restaurants.service.ts` — `periodStats` and `adminGetRestaurant` now use `prisma.order.aggregate({ _sum: { totalMinor } })` instead of `findMany().reduce()`, with the **same** filters (restaurant + `DELIVERED` + date window).
  - `apps/api/src/admin/admin.service.ts` — dashboard `revenueTodayMinor` likewise, keeping its distinct filter (`createdAt >= today`, `status notIn [CANCELLED, REJECTED]`).
  - `apps/api/src/{restaurants,admin}/testing/fake-prisma.ts` — added a faithful `order.aggregate` (same predicate as the existing `findMany`, summing the requested `_sum` keys) so the tests exercise the real path.
- **Tests added:** 3 new (existing tests already pinned the mixed-status/out-of-range semantics and now run through `aggregate`):
  - `admin.service.test.ts` — "dashboard revenue is 0 (not an error) when no order qualifies".
  - `restaurants.service.test.ts` — "owner stats report 0 revenue when nothing has been delivered" and "adminGetRestaurant reports 0 revenue when there are no delivered orders".
- **Key decisions:** behavior-preserving — a null `_sum` (no matching rows) is surfaced as `0`, matching the old reduce over an empty array. Each of the three call sites keeps its own exact status/date filter.

## Full test suite result (re-confirmed immediately before writing)
- `npm run typecheck` → **0 errors** (admin, api, mobile).
- `npm test` → Admin **3/3**, API **284 (282 pass, 2 skipped, 0 fail)**, Mobile unit **68/68**, Mobile UI **7/7** → **360 runnable pass, 2 skipped, 0 fail, 0 regressions**.
- `npm run test:e2e` (real PostgreSQL 17) → **21/21**.

## Scope confirmation
- **H-3 / driver location — not touched.** No changes to `apps/mobile/src/features/driver/screens.tsx`, `apps/mobile/src/core/location.ts`, or `apps/mobile/app.json` location permissions.
- **M-1 (order idempotency) — not implemented here** and explicitly respected: the M-2 retry auto-retries GETs only, never a mutation, precisely because no idempotency key exists yet.
- **M-6 (admin memory-only access token) — not touched.** This round made **no edits under `apps/admin/src/`** at all (the admin `api.ts`/`auth.tsx` diffs visible in `git status` are the previous round's H-2 refresh-token work, not this round's, and specifically do **not** move the access token to memory-only — that remains the documented M-6 follow-up). The only `apps/api` change here is the M-7 `package.json` swagger bump, unrelated to token storage.

---

# Fix Report — Discount Recompute + M-1 Order Idempotency (2026-08-20, round 3)

_Two issues I had identified while writing tests but not fixed. Both fixed here, with coverage. All local; nothing pushed. Full suite (unit + UI + DB-backed E2E) re-run and re-confirmed immediately before writing._

## Discount Recompute Fix
- **What was wrong:** approving a fulfillment substitution recomputed `subtotal` and `total` but kept the original `discountMinor`. A percentage promotion's amount is a function of the subtotal, so the customer was over/under-charged after a substitution changed the basket (original audit **QA M-2**; my own **TC-106** documented it as the actual buggy behavior).
- **Files changed:**
  - `apps/api/src/orders/orders.service.ts` — `decideFulfillmentAdjustment` now marks the adjustment approved, then calls a new `recomputeOrderPricingAfterAdjustment(tx, order)`. That helper rebuilds the effective line items (each item's approved-adjustment line total, or its original line), re-runs **the same** `calculatePromotionDiscounts` engine used at order creation over the new lines/subtotal, using the offers re-fetched by the ids in the order's `promotionSnapshot`, and writes back `subtotalMinor`, `merchandiseDiscountMinor`, `deliveryDiscountMinor`, `discountMinor`, `promotionSnapshot`, and a `Math.max(0, …)`-clamped `totalMinor`.
  - `apps/api/src/orders/testing/fake-prisma.ts` — `order.update` now applies the discount/snapshot fields; `offer.findMany` handles the `{ id: { in } }` re-fetch.
- **Tests updated/added** (`orders.service.test.ts`):
  - **TC-106 rewritten** to assert the *corrected* behavior: a 10% order promo re-derives from 200 → 400 when a substitution grows the subtotal from 2000 → 4000.
  - **Flat/cap case:** a percentage with a `maxDiscountMinor` cap (the model's only "flat-like" discount — there is no pure flat-amount offer type) stays at its cap and does not scale.
  - **No-discount case:** a substitution on a promo-free order invents no discount.
  - **Shrink/negative-clamp case:** a substitution that drops the subtotal below the original discount re-derives the discount downward and keeps `total ≥ 0`.
- **Key decision:** offers are re-fetched by the snapshot's ids (not "all currently active offers"), so an order's commercial terms stay the ones that applied when it was placed; an offer since expired/deleted simply stops contributing. Documented that the offer model is percentage-only, so a pure flat discount doesn't exist — the cap is its analog.

## M-1 — Order Idempotency
- **What was wrong:** `createOrder` had no server-side dedup, so a double-submit/retry could create duplicate orders (only a client `disabled`/ref guard existed).
- **Files changed:**
  - `apps/api/prisma/schema.prisma` — `Order.idempotencyKey String? @db.Uuid` + `@@unique([customerId, idempotencyKey])` (NULLs distinct in Postgres, so keyless orders never collide).
  - `apps/api/prisma/migrations/20260820120000_add_order_idempotency_key/migration.sql` — hand-written (migrate dev is non-interactive here); applied via `prisma migrate deploy`.
  - `apps/api/src/orders/orders.dto.ts` — optional `@IsUUID() idempotencyKey`.
  - `apps/api/src/orders/orders.service.ts` — `createOrder` pre-checks `findOrderByIdempotencyKey` (fast path, returns the original without touching stock), stamps the key on the order, and catches a `P2002` unique-violation from the create race (transaction rolls back — including its stock reservation — and the winning order is returned). `findOrderByIdempotencyKey` uses the compound unique `customerId_idempotencyKey`.
  - `apps/api/src/orders/testing/fake-prisma.ts` — models the unique index (throws a real `Prisma.PrismaClientKnownRequestError` P2002 on a duplicate non-null key) and the compound `findUnique`.
  - `apps/mobile/src/core/uuid.ts` **(new)** — dependency-free RFC-4122 v4 (crypto source when available, else `Math.random`; adequate for an idempotency key).
  - `apps/mobile/src/core/api.ts` — `CreateOrderInput.idempotencyKey?`.
  - `apps/mobile/src/features/customer/cart-screens.tsx` — `CheckoutScreen` holds one key per attempt in a ref keyed by the basket signature: stable across re-renders and retries of the same basket, regenerated when the basket changes (or on a fresh mount), and sent on `createOrder`.
- **Tests added:**
  - `orders.service.test.ts` (TC-081): same key twice → one order returned twice, stock reserved once; different keys → two orders; no key → never deduped.
  - `apps/api/src/integration/order-idempotency.e2e.test.ts` **(new, DB-gated; added to `scripts/run-api-e2e.mjs`)**: two `createOrder` calls raced with the same key against real PostgreSQL → **one order, stock decremented exactly once** (the loser's transaction rolls back on the unique index), both calls return the same order id.
  - `apps/mobile/src/core/uuid.test.ts`: v4 format + uniqueness.
  - `apps/mobile/src/features/customer/checkout.ui.test.tsx`: the key is reused across a retry within one attempt, and a new attempt with a different basket mints a fresh key.
- **Key decisions:** dedup is enforced at the **DB unique index**, not a racy app-level check-then-insert; the pre-check is only a fast path. Interaction with the M-2 client retry is safe — `http-retry.ts` retries GETs only, never the checkout POST, and a manual resubmit reuses the same key. Chosen policy: a key is scoped to a checkout attempt (basket signature); there is no TTL — a later genuinely-new attempt gets a new basket signature and thus a new key.

## Full test suite result (re-confirmed immediately before writing)
- `npm run typecheck` → **0 errors** (admin, api, mobile).
- `npm test` → Admin **3/3**, API **322 (319 pass, 3 skipped, 0 fail)**, Mobile unit **70/70**, Mobile UI **16/16** → **408 runnable pass, 3 skipped (DB-E2E gated out of the unit run), 0 fail, 0 regressions**.
- `npm run test:e2e` (real PostgreSQL 17) → **22/22** (was 21; +1 the new idempotency concurrency test).

## Scope confirmation
- **H-3 / driver location — not touched.** No changes to `apps/mobile/src/features/driver/screens.tsx`, `apps/mobile/src/core/location.ts`, or `apps/mobile/app.json`.
- **M-6 (admin token storage) — not touched.** This round made **no edits under `apps/admin/src/`**; the admin diffs visible in `git status` are the earlier H-2 round's refresh-token work, and the access token remains as it was (M-6 is being handled separately).

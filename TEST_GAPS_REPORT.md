# Test Gap Closure Report

_Closing the gaps flagged in `test.md` (the 200-case TC catalogue). All local; nothing pushed/deployed. Full suite (unit + UI + DB-backed E2E) re-run and re-confirmed immediately before writing — numbers at the bottom. `test.md` was updated row-by-row as each gap closed._

## Summary
- **Gaps at start:** 43 ⬜ (true gaps) + 38 🟡 (partial) = 81 rows not fully automated.
- **Gaps at end:** 26 ⬜ + 26 🟡 = 52. **29 rows moved to ✅** (17 previously-⬜, 12 previously-🟡).
- **How they closed:** 24 new test cases authored across 9 files, plus 10 catalogue mis-marks corrected (a passing test already existed — see "Mismatches").
- **Prioritisation:** security/RBAC & auth/session first, then order/checkout & substitution data-integrity, then catalog/admin/offers/notifications, then mobile i18n/error/icon logic. The heavier UI-render and harness-extension gaps were deprioritised and are listed as remaining.

### New automated tests added this run
| Area | File | New cases | TC-### |
|------|------|:--:|------|
| Auth/session | `apps/api/src/auth/auth.service.test.ts` | 5 | 013, 014, 016, 021, 025 |
| JWT guard | `apps/api/src/auth/jwt-auth.guard.test.ts` **(new)** | 2 | 017 |
| Orders / substitution | `apps/api/src/orders/orders.service.test.ts` | 6 | 091, 095, 099, 100, 103, 106 |
| Offer validation | `apps/api/src/offers/offers.service.test.ts` | 1 | 163 |
| Admin console | `apps/api/src/admin/admin.service.test.ts` | 2 | 143, 145 |
| Catalog 404s | `apps/api/src/restaurants/restaurants.service.test.ts` | 2 | 046, 052 |
| Payment surface | `apps/api/src/orders/payment-method.test.ts` **(new)** | 1 | 186 |
| Directional icons | `apps/mobile/src/theme/icon.ui.test.tsx` **(new)** | 2 | 176 |
| Error localization | `apps/mobile/src/core/errors.ui.test.tsx` **(new)** | 3 | 173 |

### Catalogue corrections (test already existed; marker was pessimistic → flipped to ✅)
TC-009 (expired OTP), TC-024 (reset-OTP → token), TC-026 (reset-token reuse), TC-096 (admin cancel closes courier), TC-098 (substitution not allowed), TC-166 (mark-read ownership), and the four round-2 fixes whose tests already exist: TC-170 (reconnect resync → `reconnect-resync.test.ts`), TC-174 (RTL reload → `reload.test.ts`/`LanguageSwitcher.ui.test.tsx`), TC-190 (SQL aggregate → `admin`/`restaurants.service.test.ts`), TC-198 (request timeout → `http-retry.test.ts`).

## Mismatches found between test.md and actual code behavior
- **TC-106 — the catalogue was right; the code had the bug (SUBSEQUENTLY FIXED).** During test-writing the code (`orders.service.ts` `decideFulfillmentAdjustment`) kept the original `discountMinor` after a substitution instead of re-deriving it — matching the original audit's **QA M-2**. At that point (a test-coverage task) I documented the actual behavior rather than fixing it. **It has since been fixed** in a follow-up task (see `FIX_REPORT.md` → "Discount Recompute Fix"): the discount is now re-derived on the new subtotal via the same promotion engine, and TC-106 (plus flat-cap / no-discount / shrink cases) asserts the corrected behavior. No longer an open mismatch.
- **Marker inaccuracies (not behavior mismatches):** several rows marked ⬜/🟡 already had passing tests (the 10 listed under "Catalogue corrections"). Markers were corrected; no new behavior was discovered.

## Gaps remaining, and why each one remains

### Blocked on a pending fix (must land before the test can pass)
- **TC-081** — server-side order idempotency (two concurrent `POST /orders` → one order). Needs the **M-1** idempotency key, which `FIX_REPORT.md` shows is *not* implemented. Per task rules, left ⬜.
- **TC-187** — admin access token memory-only (not `localStorage`). Needs **M-6**, not implemented. Asserting the fixed behavior now would fail; left ⬜.

### Out of scope — H-3 / driver location (deferred product decision)
- **TC-117** — continuous/background driver-location tracking. This *is* the deferred H-3 feature; not implemented, not to be tested around.
- **TC-189** — driver available-deliveries list virtualization (a `.map`-in-`ScrollView` perf item on the same driver screen H-3 governs). Left ⬜ as H-3-adjacent + performance.

### Not automatable in this environment (manual / device / tooling)
- **TC-175** — Arabic numerals/prices/dates *visual* rendering on Hermes: a device/visual check.
- **TC-177** — "no hardcoded English strings": a source-scan lint rule, not a runtime test.
- **TC-191** — image optimization/lazy-loading: profiling/manual.
- **TC-193** — CTA tap targets ≥44×44: the cart steppers are **32×32** today (known **QA L-2**). An assertion of ≥44 would *fail* against current code; closing it needs the product fix, which is out of scope. Left ⬜ and flagged.
- **TC-194** — colour-contrast WCAG AA: needs a contrast/measurement tool.
- **TC-148** — admin-web alert sound / live-orders auto-refresh: the Vite admin app has no render-test harness; effectively manual here.

### Ran out of scope for this task (automatable, but needs harness work — good next targets)
- **TC-028, TC-037** — profile-normalization & saved-address ordering: closeable as `users.service` integration tests (small).
- **TC-047, TC-049** — catalog search & pagination boundaries: need the restaurants `fake-prisma` `menuItem.findMany` extended to honour the search `OR`/`AND` clause and `skip`/`take`.
- **TC-129, TC-130** — inventory low-stock summary & barcode lookup: no inventory-service test harness exists yet (would need a new `fake-prisma`).
- **TC-116** — one-shot driver-location *endpoint* persistence: a plain `drivers.service` integration test (this is the endpoint, **not** the H-3 tracking feature) — deprioritised, closeable.
- **TC-038, 039, 040, 043, 074, 075, 118, 188, 192** — customer/driver **UI render** tests (storefront states, saved-address prefill, quote invalidation, notification dot, a11y labels, list virtualization). Each needs RNTL renders with heavy module mocking (`core/api`, `session`, `location`, maps, `socket`); doable but substantial, and lower-value than the logic/security coverage prioritised here.

### Partials (🟡, 26) left as-is
These rows are **already indirectly covered** by existing tests (e.g. TC-070 quote-location, TC-088 realtime emit, TC-113 driver active-delivery block, TC-135/182 business isolation, TC-169 gateway auth, TC-200 prod-HTTPS). They are not true gaps; upgrading each to a dedicated ✅ test was lower priority than closing the ⬜ gaps and was left for a follow-up.

## Full Test Suite Result
Commands run (repo root), all green, re-confirmed immediately before writing:
- `npm run typecheck` → **0 errors** (admin, api, mobile).
- `npm test` → Admin **3/3**, API **303 (301 pass, 2 skipped, 0 fail)**, Mobile unit (node:test) **68/68**, Mobile UI (jest-expo) **12/12** → **384 runnable pass, 2 skipped, 0 fail, 0 regressions**.
- `npm run test:e2e` (real PostgreSQL 17) → **21/21**.

**Test count before → after this run:** default suite **362 → 386** (+24 new cases); DB-E2E **21 → 21** (unchanged). `test.md` coverage: **✅ 119 → 148**, 🟡 38 → 26, ⬜ 43 → 26.

---

# Second gap-closure pass (2026-08-20)

A follow-up run over the remaining gaps, closing the next tier of automatable integration/UI cases.

## Summary
- **At start of this pass:** ✅ 148 / 🟡 26 / ⬜ 26.
- **At end:** **✅ 167 / 🟡 13 / ⬜ 20** — **19 rows moved to ✅** (13 🟡→✅, 6 ⬜→✅).
- **How:** 14 new test cases authored + 5 catalogue mis-marks corrected (test already existed).

### New automated tests added this pass
| Area | File | New cases | TC-### |
|------|------|:--:|------|
| Driver location | `apps/api/src/drivers/drivers.service.test.ts` (+fake `driverProfile.update` now persists coords) | 1 | 116 |
| Profile & addresses | `apps/api/src/users/users.service.test.ts` | 3 | 027, 028, 037 |
| Orders | `apps/api/src/orders/orders.service.test.ts` | 2 | 070, 088 |
| Restaurants (open-gate, admin filter, admin-create) | `apps/api/src/restaurants/restaurants.service.test.ts` | 3 | 125, 137, 141 |
| Catalog search/featured/pagination | `apps/api/src/restaurants/restaurants.service.test.ts` (+fake `menuItem.findMany`/`count` extended with a faithful catalog matcher) | 3 | 047, 048, 049 |
| Cart accessibility | `apps/mobile/src/features/customer/cart-screen.ui.test.tsx` **(new)** | 2 | 192, 195 |

### Catalogue corrections this pass (test already existed → flipped ✅)
TC-113 (accept-while-active block), TC-115 (driver stats/earnings), TC-142 (admin driver approve/reject/suspend — all in `drivers.service.test.ts`), TC-128 (availability hides from public menu — `menu.service.test.ts`), TC-144 (`adminListOrders` filters — `orders.service.test.ts`). The catalogue had mismarked TC-142's location as `admin.service.test.ts`; the moderation actually lives in `drivers.service`.

## Mismatches found this pass
- **TC-142 file mis-attribution** (marker, not behavior): the catalogue pointed at `admin.service.test.ts`, but admin driver approve/reject/suspend is implemented and tested in `drivers.service`. Corrected the reference.
- No behavior mismatches this pass. (The TC-106 discount mismatch from pass 1 was later **fixed** — see the updated pass-1 mismatch note above and `FIX_REPORT.md`.)

## Gaps remaining after both passes (⬜ 20)
- **Blocked on a pending fix:** TC-081 (needs M-1 order idempotency), TC-187 (needs M-6 memory-only admin token).
- **Out of scope — H-3 / driver location:** TC-117 (background tracking), TC-189 (driver-list virtualization on the H-3 screen).
- **Needs a new inventory `fake-prisma` harness (deferred, not built this task):** TC-129 (low-stock summary), TC-130 (barcode lookup). The inventory *money/stock* path is already covered end-to-end by `phase11.e2e.test.ts` (PO create/receive).
- **Not automatable in this environment (manual / device / tooling):** TC-175 (Arabic numerals/dates visual on Hermes), TC-177 (hardcoded-string source-scan lint), TC-191 (image profiling), TC-193 (tap targets ≥44 — cart steppers are **32×32** today per QA L-2; asserting ≥44 would fail without the product fix), TC-194 (colour-contrast tooling), TC-148 (admin-web Vite app has no render-test harness).
- **UI render tests (heavy module mocking; deferred as lower-value than the logic/security coverage done):** TC-038, 039, 040, 043, 074, 075, 118, 188.

## Remaining 🟡 partials (13) — indirectly covered
TC-041, 044, 059, 089, 119, 131, 134, 135, 147, 169, 182, 183, 200. Each is exercised indirectly by an existing test (e.g. TC-119 owner-via-membership is implicit in every owner-scoped restaurant test; TC-135/182 business isolation by the cross-business order/menu tests; TC-169 gateway auth by `realtime.gateway.test.ts`; TC-131/134 inventory by the E2E). Upgrading each to a dedicated ✅ was lower priority than closing true ⬜ gaps.

## Full Test Suite Result (this pass — re-confirmed immediately before writing)
- `npm run typecheck` → **0 errors** (admin, api, mobile).
- `npm test` → Admin **3/3**, API **315 (313 pass, 2 skipped, 0 fail)**, Mobile unit **68/68**, Mobile UI **14/14** → **398 runnable pass, 2 skipped, 0 fail, 0 regressions**.
- `npm run test:e2e` (real PostgreSQL 17) → **21/21**.

**Test count before → after this pass:** default suite **386 → 400** (+14 new cases); DB-E2E **21 → 21**. `test.md` coverage across both passes: **✅ 119 → 167**, 🟡 38 → 13, ⬜ 43 → 20.

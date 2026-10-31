# Final readiness report — cloud run 2

- **Date:** 2026-11-01.
- **Branch:** `store-remediation-2` (pushed after every task), on top of run 1 (`d2612b9`). Per-task evidence: `cloud-run-log.md`. Open items with owners: `remaining-work.md`. Owner actions: `owner-action-items.md` (section F lists every auth, authorization and public-route change of this run).
- **Nothing was deployed, built for upload, published or changed in any cloud account or production system.** No secret was read, created or written.

## Verdict per store

| Store | Verdict | Why |
|---|---|---|
| **Google Play closed test** | **NOT READY** | Code side ready for a closed-test build, but: the API with the three new migrations is not deployed (R1); production sends OTP codes to the log instead of SMS (R2, security S11 HIGH); legal pages are not hosted and 21 placeholders are unfilled (R8, R22); no Firebase project (R7, driver push); demo accounts not created (R20); no release AAB has ever been built or checked on a device (R34, R35); lockfile not updated (R24). |
| **Google Play production** | **NOT READY** | Everything above, plus account verification and the closed-test period (R18), admin web on the old API and CORS cleanup (R10, R11), licensed map tiles (R25), live catalogue check (R23). |
| **Apple App Store** | **NOT READY** | Apple Developer enrollment pending; no iOS build has ever been produced (R19). Guest browsing (Apple 5.1.1(v)) is now implemented but untested on a device. All shared items above. |

Code side: **PARTIALLY READY.** Every repository-fixable item in the run-2 task list was implemented and tested where a test could run here; what remains is listed in `remaining-work.md` §D and needs owner decisions, a device, or a build.

## What changed in run 2 (all tested where stated)

| # | Item | Result |
|---|---|---|
| 1 | WebSocket disconnect after suspension, role change, deletion, scheduled-deletion sweep, password reset; per-session on sign-out (S5) | FIXED — real-socket PostgreSQL e2e 3/3 |
| 2 | Driver/store-staff deletion with real deliveries, cash custody and earnings | VERIFIED, no bug found — PostgreSQL e2e 6/6 |
| 3 | Guest browsing (H2): login-screen entry, one navigation gate, cart kept, checkout → sign-in → back to cart; new public `GET /supermarkets/:id/delivery-area` | FIXED — e2e 4/4 (public data has no private fields; 10 account routes 401), unit +3, UI +3 |
| 4 | Android push wiring (H3) that never breaks a build without `google-services.json` | PREPARED — script tests 3/3, native-config check passes; **no Gradle build run** |
| 5 | Demo accounts (B6/M7): admin flag, demo/real dispatch isolation, demo orders can never complete into money; reviewer guide AR/EN | FIXED — e2e 4/4, unit +1; additive migration |
| 6 | Restricted products: availability switch-on and category re-activation now screened | FIXED — unit +3; seed CSV report 0/0 |
| 7 | Location disclosure vs behaviour (H4/H8) | VERIFIED consistent; device test written, **not run** |
| 8 | Server reverse geocoding (M4) with config provider + UA; configurable tiles (M3) | FIXED (M4) / CONFIGURABLE (M3, provider decision open) — unit 5 + 9 + 3 |
| 9 | Vendor-neutral app error reporting (M2), off by default | FIXED — unit 3 |
| 10 | Store texts updated; placeholder inventory | DONE (docs) |
| 11 | Push explainer before the system prompt (L4) | FIXED — unit 2 |
| 12 | Security review | `security-audit.md` (S5, S9 fixed; S11 HIGH config; S6, S10 open) |
| 13 | Financial review | `financial-integrity-audit.md` (nothing financial changed; F1–F3, F9, F10 open, report-only) |

## Tests actually run (cloud container, local throwaway PostgreSQL 16)

| Suite | Result |
|---|---|
| API typecheck (`tsc --noEmit`) | OK |
| API unit (`npm test` in `apps/api`) | 736 pass, 0 fail, 16 skipped (database-only suites, run below) |
| API e2e (`npm run test:e2e`, all 17 files) | **103 / 103 passed** (82 before this run + 21 new); afterwards `delivery-claim-race.e2e` (18th file) passed 3/3 runs on its own |
| Mobile typecheck | OK |
| Mobile unit (`npm run test:unit`) | 295 / 295 |
| Mobile UI (`jest`) | 209 / 209 |
| Mobile native-config check | OK |
| `install-google-services.test.cjs` | 3 / 3 |
| `check-financial-integrity.mjs` | clean — **local test database only** |
| `restricted-catalogue-report.ts` on `products/products_seed.csv` | 130 rows, 0 BLOCKED, 0 REVIEW |

## Not run (and why)

- Any Android/iOS build, Gradle, EAS or bundletool step: no Android SDK/Xcode here, and builds that upload are out of scope.
- Every device test (background location with a navigation app, push, guest flow on a phone, RTL and screen reader pass, notification explainer).
- Production checks (catalogue, `check:financial`, OTP provider, health of the new code): no production access by rule.
- A real reverse-geocoding call to Nominatim (no `GEOCODER_USER_AGENT` configured here).
- Admin web tests (no admin code was changed).

## Compatibility with production

- All three migrations are additive (new table, a CHECK widened only for inactive `deleted-<own id>` rows, two `BOOLEAN NOT NULL DEFAULT false` columns). Code from before this branch keeps working on the migrated database. The new code needs the migrations first.
- New API routes: `GET /supermarkets/:id/delivery-area` (public), `GET /geocode/reverse` (signed-in), `PATCH /admin/users/:id/demo` (admin). Responses of existing routes only gained fields (`isDemo` on admin user views).
- Mobile builds from this branch work against the current production API except: geocoding returns null until the API is deployed and `GEOCODER_USER_AGENT` is set (the person types the address), and the guest delivery-area call is not used by the app yet.

## Owner actions (summary; details in `owner-action-items.md` and `remaining-work.md`)

1. Deploy the API with the three migrations (R1).
2. Switch OTP to TweetSMS, set `OTP_REQUIRE_REAL_PROVIDER=true`, then `NODE_ENV=production`; purge logs holding codes (R2–R4, R13).
3. EAS variables, lockfile `npm install`, Firebase (R5, R24, R7).
4. Fill P1–P21, legal review, host the four pages, mailboxes (R22, R8, R9).
5. Create and mark the demo accounts; screenshots (R20, R21).
6. Catalogue and image-rights check (R23, Khaldoun).
7. First AAB + device tests (R34, R35); then Play Console (R15) and the closed test.
8. Admin web to the new API, CORS cleanup, backup key rotation, tiles decision (R10–R12, R25).
9. Apple enrollment and the first iOS build (R19).

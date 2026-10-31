# Remaining work — after cloud run 3 (`store-remediation-2`)

**Run 3 closed:** R26/S6 still open (patch plan only), R27/S10 **done**, R29 **done**, R30 concurrent-claim e2e **done** (F1–F3 tests still open), catalogue review workflow, admin product review, catalogue importer, S11 code side, production self-check, build-guard tests, placeholder checklist, review notes, lifecycle e2e. New migrations to deploy: `20261102090000_add_menu_item_review_status`, `20261102100000_add_menu_item_import_source` (both additive).

Owners: **Mohammad** (owner, accounts, decisions), **Khaldoun** (store operations, catalogue), **Claude Code** / **Codex** (repository work), **store account** (actions only possible inside Google Play Console / App Store Connect / Apple Developer). Effort is working time, not calendar time. "Blocks" names the first store milestone that cannot pass without the item: **PCT** = Google Play closed test, **PP** = Google Play production, **iOS** = App Store.

## A. Production and infrastructure (outside the repository)

| ID | Item | Owner | Effort | Depends on | Blocks |
|---|---|---|---|---|---|
| R1 | Deploy this branch's API to production and run the **five** new migrations in order: `20261031120000_add_account_deletion_request`, `20261031130000_allow_anonymised_user_phone`, `20261101090000_add_demo_account_flags`, `20261102090000_add_menu_item_review_status`, `20261102100000_add_menu_item_import_source`. **Do R2 first:** this code withholds OTP codes from the log on a production deployment. Migrations before code. Verify `GET /health`, then delete a test customer account (204). | Mohammad | 1–2 h | — | PCT |
| R2 | **Real SMS provider.** Production uses the development OTP provider, which writes phone numbers and codes to the API log (security S11, HIGH). Configure TweetSMS (`OTP_PROVIDER=tweetsms` + credentials), run `npm run otp:tweetsms:preflight` locally with the real key, then set `OTP_REQUIRE_REAL_PROVIDER=true`. | Mohammad | 2–4 h | TweetSMS account | PCT |
| R3 | **Production mode switch:** run `npm run prod:selfcheck --workspace @wasel/api` with the production variables (names only; exit 0 = ready), then `NODE_ENV=production` on Railway (it enforces CORS, Swagger off, real OTP, error tracking). | Mohammad | 1 h | R2, R13 | PCT |
| R4 | Purge or restrict existing API logs that contain OTP codes; rotate/force-reset affected accounts if logs were exposed. | Mohammad | 1 h | R2 | PCT |
| R5 | EAS production variables: `EXPO_PUBLIC_API_URL=https://api.jovops.com` (builds now fail without it); optional `EXPO_PUBLIC_MAP_TILE_*` (R25), `EXPO_PUBLIC_ERROR_REPORT_URL` (owner-action-items F.7), `GOOGLE_SERVICES_JSON` file (R7). Delete `EXPO_PUBLIC_GEOCODER_URL` (no longer read). Replace the ngrok value in the local `.env.production`. | Mohammad | 30 min | — | PCT |
| R6 | `GEOCODER_USER_AGENT` on Railway (needs P21 contact email); without it address lookup stays off. | Mohammad | 10 min | P21 | — (UX) |
| R7 | Firebase project + `google-services.json` (EAS file variable) + FCM V1 key in EAS credentials; then the push device test. | Mohammad | 2 h | Google account | PCT (driver alerts) |
| R8 | Host the four legal pages at `https://jovops.com/{privacy,terms,delete-account,support}` (domain did not respond on 2026-10-31). | Mohammad | 1–2 h | P1–P21 filled | PCT |
| R9 | Support and privacy mailboxes (P3, P4) working. | Mohammad | 30 min | domain | PCT |
| R10 | Admin web points at the old API host: repoint the Vercel admin to `https://api.jovops.com` after R1. | Mohammad | 30 min | R1 | PP (operations) |
| R11 | CORS cleanup: production `CORS_ORIGIN` = only the real admin/web origins (remove old/trial hosts). | Mohammad | 15 min | R10 | PP |
| R12 | Age key rotation (backup encryption key) as planned in `docs/railway-setup.md`. | Mohammad | 1 h | — | PP |
| R13 | Server error tracking: set `ERROR_TRACKING_WEBHOOK_URL` (required with `NODE_ENV=production`); name the provider (P17). | Mohammad | 30 min | — | PCT (via R3) |
| R14 | Run `npm run check:financial` against production (read-only). | Mohammad | 15 min | R1 | PP |

## B. Store accounts and consoles

| ID | Item | Owner | Effort | Depends on | Blocks |
|---|---|---|---|---|---|
| R15 | Play Console: app creation, Data safety (from `docs/store/data-safety-and-app-privacy.md`), background-location declaration + ≤30 s video, foreground-service declaration, content rating, target audience (P9), App access (demo credentials). | store account (Mohammad) | 1 day | R8, R20, R21 | PCT |
| R18 | Play developer account verification (identity/organisation) and the closed-test testers list (required testers and test duration as Play currently requires for new personal accounts — check the console). | store account | days (Google) | — | PP |
| R19 | Apple Developer enrollment (pending), App Store Connect record, App Privacy answers, first iOS build (`eas build -p ios`), privacy-manifest check on the real build. | store account / Mohammad | 1–2 days + Apple wait | enrollment | iOS |
| R20 | Create the demo customer and demo driver with numbers you control (P19), mark both with `PATCH /admin/users/:id/demo`, prepare the review order procedure (`reviewer-access-guide.md`). | Mohammad / Khaldoun | 1 h | R1 | PCT |
| R21 | Screenshots and feature graphic from a release build with demo accounts. | Khaldoun | 0.5 day | R1, R20 | PCT |

## C. Legal and business facts (placeholders)

| ID | Item | Owner | Effort | Blocks |
|---|---|---|---|---|
| R22 | Fill P1–P21 (`owner-action-items.md` table A); legal review of privacy policy and terms; regenerate the HTML pages. | Mohammad (+ lawyer) | 1–3 days | PCT |
| R23 | Catalogue check and import: run `restricted-catalogue-report.ts` on a live export, then the new importer locally (dry-run) as in `catalogue-import-guide.md`; approve products in the admin **Product review** page; remove/hide tobacco, nicotine, vape, alcohol; image-rights check with `image-licence-audit-template.csv` (M5). | Khaldoun | 0.5–1 day | PCT |

## D. Repository work still open (no secrets needed)

| ID | Item | Owner | Effort | Depends on | Blocks |
|---|---|---|---|---|---|
| R24 | Lockfile: `npm install` at the repo root to drop `expo-camera` from `package-lock.json` (L1); commit. | Mohammad (command) | 10 min | — | PCT (clean build) |
| R25 | Map tiles (M3): pick a licensed source and set the EAS variables; switch the admin web maps too. | Mohammad (decision) / Claude Code | 2 h after decision | decision D10 | PP |
| R26 | Security S6: require an APPROVED, online driver to list available deliveries and hide the street line until accepted (auth change → owner review). | Claude Code / Codex | 0.5 day | owner OK | PP |
| R27 | ~~Security S10~~ **done in run 3.** | — | — | — | — |
| R28 | Admin web: a "demo account" toggle on the user page (API exists). | Codex / Claude Code | 2 h | — | — |
| R29 | ~~Guest delivery-area line~~ **done in run 3.** | — | — | — | — |
| R30 | Financial F1–F3 tests (the concurrent-accept e2e was added in run 2). | Claude Code | 0.5 day | — | — |
| R31 | Analytics: exclude demo orders from counts (F9; owner decision). | Claude Code | 2 h | decision | — |
| R32 | Driver location D3 option (one-shot report only when online or delivering) if the owner wants a narrower disclosure. | Claude Code | 2 h | decision | — |
| R33 | Restaurant vertical API endpoints still exist behind flags; removing them is out of launch scope. | — | — | — | — |

## E. Device and build verification (cannot run in the cloud container)

| ID | Item | Owner | Effort | Blocks |
|---|---|---|---|---|
| R34 | First closed-test AAB via EAS; `bundletool dump manifest` to confirm merged permissions (L5) and that `ACCESS_BACKGROUND_LOCATION` is present as intended. | Mohammad | 2 h | PCT |
| R35 | Device tests: background tracking with Google Maps in front (`technical-analyses.md#h8-run2`), push (`#h3`), guest browsing → checkout → sign-in → back to cart, account deletion for each role, notification explainer, Arabic RTL pass. | Mohammad / Khaldoun | 0.5 day | R1, R7, R34 | PCT |

## Critical paths

- **Google Play closed test:** R1 → R2 → R4 → R13 → R3 → R5 → R24 → R7 → R34 → R35 → R20 → R21 → (R22 → R8 → R9) → R23 → R15 → upload to closed track.
- **Google Play production:** closed test above → R18 (verification + required tester period) → R10 → R11 → R12 → R14 → R25 → R26 → promote.
- **iOS App Store:** R19 (enrollment) → R1–R5, R8, R9, R22 as above → iOS build → device tests on iPhone (location strings, guest browsing for Apple 5.1.1(v), deletion) → App Privacy (R19) → review notes with demo accounts (R20) → submit.

## F. New in run 3 (open)

| ID | Item | Owner | Effort | Depends on | Blocks |
|---|---|---|---|---|---|
| R36 | Decide whether imported price changes on approved products need re-approval (financial-integrity-audit run 3). | Mohammad | decision | — | — |
| R37 | Upload product images to storage before an import that uses `--image-base-url` (the importer validates hashes but does not upload). | Khaldoun / Mohammad | 0.5 day | storage access | PCT (catalogue) |
| R38 | Browser test of the admin **Product review** page (not run here). | Khaldoun | 30 min | R1, R10 | — |
| R39 | Store-staff catalogue screen could show a "pending review" badge (API already returns `reviewStatus`). | Claude Code | 1 h | — | — |

## Owner checklist (ordered)

**Tomorrow**
1. TweetSMS account and key; `npm run otp:tweetsms:preflight` locally (R2).
2. Set on Railway: `OTP_PROVIDER=tweetsms`, `TWEETSMS_API_KEY`, `TWEETSMS_SENDER`, `OTP_REQUIRE_REAL_PROVIDER=true`, `DEPLOYMENT_ENV=production`, `GEOCODER_USER_AGENT` (R2, R6).
3. Back up the database, deploy this branch's API (five migrations run before the code), check `/health` (R1).
4. Purge/restrict old logs that contain OTP codes (R4).
5. `npm install` at the repo root, commit the lockfile (R24).

**This week**
6. `npm run prod:selfcheck --workspace @wasel/api` until it says READY, then `NODE_ENV=production` (R3, R13).
7. EAS variables and Firebase (`eas-and-build-steps.md` §1–2) (R5, R7).
8. Fill P1–P21 (`docs/store/PLACEHOLDERS.md`), legal review, host the four pages, create the mailboxes (R22, R8, R9).
9. Admin web → new API; CORS cleanup (R10, R11).
10. Catalogue: live export → restricted report → importer dry-run on a local copy → approve in Product review (R23, R37, R38).
11. Create and mark the two demo accounts (R20).

**Before launch**
12. First AAB, bundletool check, internal testing, device tests R35 (`eas-and-build-steps.md` §4–5).
13. Screenshots, Play Console forms and declarations, closed test (R21, R15).
14. Play account verification and the closed-test period; backup key rotation; map tiles decision; `check:financial` on production (R18, R12, R25, R14).
15. Apple enrollment → first iOS build → App Store submission (R19).

# Final readiness report — store remediation run 1

- **Date:** 2026-10-31.
- **Branch:** `store-remediation-1`, 13 commits on top of `23e9045`, local only (not pushed).
- **Your uncommitted change** to `apps/mobile/src/features/driver/screens.tsx` is untouched and uncommitted.

**Nothing was deployed, published, uploaded or changed in any cloud account.** Production was only called with `GET /api/v1/health`, during the earlier audit.

## Verdict

**NOT READY to submit to either store today.** The code side is **PARTIALLY READY**.

Every repository-fixable BLOCKER and most HIGH items are fixed and tested. What remains is outside the repository:

- hosting the legal pages;
- the EAS production variable;
- deploying the API with the two new migrations;
- demo accounts;
- the Play declarations and video;
- Firebase;
- the live catalogue clean-up;
- Apple enrollment.

Two code items remain by decision, not by omission: guest browsing (H2) and foreground-service-only tracking (H4).

## 1. Fixed (with tests)

| Item | What changed |
|---|---|
| B1–B4 | JOVO privacy policy, terms, delete-account and support pages (Arabic and English, placeholders marked), static script-free pages, and a JOVO MARKET listing. The in-app legal links come from one constant, on Login, Signup (consent line) and Settings for every role. |
| B5 | Release native builds refuse any API but `https://api.jovops.com`; every release bundle refuses HTTP, ngrok and local hosts. A production EAS build fails early unless the variable is right. |
| B7 | Play declaration text, the video script, and corrected Data safety and Apple privacy answers. |
| H1 | Deletion for drivers (immediate, or scheduled with a date) and store staff (immediate). Owner and admin are refused with clear codes. The copy no longer says "deactivate". **A production-affecting bug was found and fixed:** the phone CHECK constraint made every deletion, customers included, fail with HTTP 500. |
| H5 | The "Development API" label shows only in development builds. |
| H6 | Tobacco, nicotine, vaping and alcohol are refused at product and category create, rename and import; ambiguous items are hidden for review; there is an offline catalogue report. |
| H7 | Restaurant browsing, registration and the server-flag entry are removed from the app; no restaurant copy appears in user-facing strings (guard test). |
| H8 | Accurate Arabic and English iOS location prompts. The driver disclosure now matches real behaviour, including the one-off foreground position (disclosure version 2). |
| M1, M6, L1, L2, L6 | OTA wait 0; iOS privacy manifest; `expo-camera` dropped (lockfile pending); health shows `jovo-api` with no public commit; stale comment gone. |

## 2. Verified with no change needed

- L3: internal storage keys.
- L7: the placeholder image is not used by the app.
- L8: signing setup.
- targetSdk 36, 64-bit, package consistency.
- HTTPS-only release.
- Payments are exempt from Play Billing and in-app purchase.
- Sign in with Apple and App Tracking Transparency are not applicable.
- The security baseline (`security-audit.md` "Verified correct").

## 3. Unresolved

| Item | Why | Where |
|---|---|---|
| H2 guest browsing | Analysed only (about 1.5–2 days, app-only) | `technical-analyses.md#h2` |
| H3 Firebase / FCM | Needs your Firebase project and credentials | `technical-analyses.md#h3` |
| H4 foreground-service-only tracking | You chose to keep background location; analysis and device test written | `technical-analyses.md#h4` |
| M2, M3, M4, M5, M7, M8, L4 | Analysed only | `technical-analyses.md`, `reviewer-access-guide.md` |
| L5 merged manifest | The local release build could not run | Below |
| Security S5 (open sockets after suspension or deletion), S6–S10 | Report-only; auth behaviour not changed | `security-audit.md` |
| Financial F1–F3 (total-formula consistency) | Report-only | `financial-integrity-audit.md` |
| B8 / Apple | Enrollment | `apple-app-store-submission-checklist.md` |

## 4. Tests actually run (all local)

| Command | Result |
|---|---|
| `cd apps/mobile && npx tsc -p tsconfig.json --noEmit` | exit 0 |
| `cd apps/mobile && node scripts/check-native-config.cjs` | "Native config is consistent: com.jovo.app, version 0.17.0 (17), 8 granted and 5 blocked Android permissions." |
| `cd apps/mobile && npm run test:unit` | 283 tests, 283 pass, 0 fail (was 263 before this run) |
| `cd apps/mobile && npx jest` | 35 suites, 206 tests passed (was 34 / 194) |
| `cd apps/mobile && node scripts/check-release-env.cjs --profile production` | exit 1 when the variable is unset (intended); exit 0 with `EXPO_PUBLIC_API_URL=https://api.jovops.com` |
| `cd apps/mobile && npx expo config --type public --json` | locales, `privacyManifests` and updates resolved as committed |
| `cd apps/api && npx tsc -p tsconfig.json --noEmit` | exit 0 |
| `cd apps/api && npx prisma validate` | valid |
| `cd apps/api && npm test` | 737 tests, 725 pass, **0 fail**, 12 skipped (database-only tests skip without `RUN_DATABASE_E2E`) |
| Throwaway `postgres:17-alpine` on port 5433 (DB `jovo_ci_test`), CI test variables, then `npx prisma migrate deploy` and `npm run test:e2e --workspace @wasel/api` | First run (before the new e2e): 75/75. With the new deletion e2e: **failed, 4 subtests (500 on deletion)**. That exposed the constraint bug, which was fixed with the new migration. Final run: **82/82 pass**. |
| `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` on a fresh migrated database | "No difference detected" (42 migrations). The container was removed afterwards. |
| `npx tsx scripts/restricted-catalogue-report.ts --file ../../products/products_seed.csv` | 130 rows: 0 BLOCKED, 0 REVIEW (read-only; `products/` not modified) |
| `git diff --check` over the run's commits | clean, after trimming one blank line in the new migration |
| **Local Android release build:** `./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a` (unsigned, no secrets) | **NOT COMPLETED.** First attempt: `JAVA_HOME` points to a missing Android Studio `jbr`. Second attempt (shell-only `JAVA_HOME` = JDK 21): `[CXX1101] NDK at …\ndk\27.1.12297006 did not have a source.properties file` (the folder is empty). Repairing the SDK changes your machine, so it was not done. |
| iOS build | **BLOCKED**: no enrollment, no `ios/` folder |

## 5. Known limitations of this run

- The EAS production variables, the production database and catalogue, Play Console and App Store Connect could not be inspected (rules).
- Apple's privacy-manifest documentation page did not render. The manifest reasons come from the dependencies' own `PrivacyInfo.xcprivacy` files and Expo's guide. Confirm after the first TestFlight upload (ITMS-91053).
- The restricted-product classifier is word-list based. It is tuned on the repo seed and common Palestinian grocery names; the ~1,820-product file and the live database were not available.
- The scheduled driver deletion completes **on or after** the shown date, and only once settled. If still blocked, it stays pending with a warning log; there is no admin screen for pending deletions yet.

## 6. Production commit 56dcff4 and mobile/backend compatibility

- **Why 56dcff4.** Production `/health` reports `56dcff4`; the repo was at `23e9045`. The four commits in between change only `deploy/railway/backup/*` and `docs/railway-setup.md`, so no API code changed. The running API image was last built at `56dcff4`, and that is expected.
- **New app against today's production API (56dcff4):**
  - Deletion: for customers it hits the constraint bug (500, shown as a generic error). Drivers and staff get 409 `ACCOUNT_DELETION_SUPPORT_REQUIRED` (translated message).
  - `GET /users/me/deletion` is 404, and the app ignores it silently.
  - Everything else is unchanged.
  - **Deploy this branch's API before any store review.**
- **Old installed app (versionCode 17) against the new API:**
  - The DELETE contract for customers is unchanged (204). Old builds offer deletion to customers only, so they never see 202.
  - Health response fields changed (`service`, `commit`); only the trial deploy workflow reads `commit`.
- **Migrations to run on deploy:**
  - `20261031120000_add_account_deletion_request`: a new table.
  - `20261031130000_allow_anonymised_user_phone`: replaces one CHECK. The existing rows all satisfy it, because the old constraint was stricter.

## 7. Remaining store-review risks

Judgment, not data.

**Google Play**

- After you complete the owner actions (pages hosted, EAS variable, API deployed, demo accounts, declarations and video, catalogue clean, Firebase): **about 20–30 %** for a first-submission bounce, mostly the background-location declaration review. This assumes the closed test (12 testers, 14 days) passes.
- Remaining main risks:
  1. The background-location declaration (manual review).
  2. Push not working without Firebase (functional).
  3. Esri tile licensing (M3).
- Today, without the owner actions: still **85–95 %**. The pages are not live and the declarations are not filed.

**Apple** (after enrollment)

- After the owner actions: **about 30–45 %**. The largest single cause is the **login wall (H2)**; after H2 it is about 15–25 %.
- Others:
  - 2.5.4 background location, which the reviewer will test with the demo driver.
  - Privacy-manifest gaps found only on the first TestFlight upload.
  - 5.2 image provenance (M5).

## 8. Recommended order of next steps

1. Set the EAS `EXPO_PUBLIC_API_URL`, fix the local `.env.production`, and run `npm install` to update the lockfile.
2. Fill the placeholders, get a legal review, and host the four pages on `jovops.com`; create the mailboxes.
3. Review and merge `store-remediation-1`; deploy the API (two migrations); confirm customer deletion works in production with a test account.
4. Khaldoun: run the restricted-catalogue report on the live export, deactivate BLOCKED rows, start the image licence audit.
5. Create Firebase and FCM credentials, then a short follow-up run to wire `google-services.json` into the Android project.
6. Repair the local NDK, build the release AAB locally (or with EAS), and smoke-test it on a real device.
7. Create the demo accounts and the demo delivery. File the Play declarations, record the video, enter Data safety, then start the closed test.
8. Next code run: guest browsing (H2), WebSocket disconnect on revocation (S5), and optionally the geocoding proxy (M4) and map tiles (M3).
9. When Apple enrollment clears: run the iOS build and TestFlight, enter App Privacy and the age rating, and submit with the review notes.

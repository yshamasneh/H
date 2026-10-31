# Owner action items — store remediation run 1

Everything here needs Mohammad: a decision, a fact only you have, or an action in an external account that this run was not allowed to take. Nothing was published, deployed, uploaded or changed in any cloud account.

## A. Placeholders to fill (in `docs/store/*.md`; then regenerate or hand-edit `docs/store/site/*.html`)

| # | Placeholder | Used in | Notes |
|---|---|---|---|
| P1 | Operator legal name / الاسم القانوني للجهة المشغلة | privacy policy, terms | Must match the developer and seller name on both stores |
| P2 | Legal address / العنوان القانوني | privacy policy | |
| P3 | Privacy email / بريد الخصوصية | privacy, delete-account | Needs a working mailbox |
| P4 | Support email / بريد الدعم | terms, support, listing, review notes, site footer | Can be the same as P3 |
| P5 | Support phone or WhatsApp / رقم هاتف الدعم | privacy, terms, support | |
| P6 | Support hours / ساعات الدعم | support | |
| P7 | Town / service area / اسم البلدة / منطقة الخدمة | all pages, listing, review notes | |
| P8 | Delivery radius in km / نصف قطر التوصيل | terms, support, listing, notes | Must equal the API's configured maximum distance |
| P9 | Minimum age / الحد الأدنى للعمر | privacy, terms, Play target audience | Suggested 18 (cash orders); your decision |
| P10 | Accounting record retention period | privacy, delete-account | Legal advice: Palestinian tax and commercial rules |
| P11 | Backup retention period | privacy, delete-account | Must match the Backblaze lifecycle you configured |
| P12 | Scheduled driver deletion delay (default 30 days) | privacy, delete-account | The code reads `ACCOUNT_DELETION_SCHEDULE_DAYS` (default 30). Set it on Railway only if you choose a different value. |
| P13 | Days to complete a web deletion request | delete-account | |
| P14 | Governing law and competent courts | privacy, terms | Legal advice |
| P15 | Cancellation and refund policy | terms | |
| P16 | Limitation-of-liability clause | terms | Legal advice |
| P17 | Server error-tracking provider | privacy, inventory | The service behind `ERROR_TRACKING_WEBHOOK_URL` on Railway |
| P18 | Publication date | privacy, terms | |
| P19 | Demo account phone numbers and a safe in-zone demo address | reviewer guide | Numbers you control; no real person may use them |
| P20 | Developer name exactly as on the store accounts | listing | |
| P21 | Contact email in the geocoder User-Agent (future M4) | technical analyses | |

## B. External actions (in order)

1. **EAS environment (B5).** Run `eas env:list --environment production` locally and check `EXPO_PUBLIC_API_URL`. If it is missing or wrong:
   ```
   eas env:create --environment production --name EXPO_PUBLIC_API_URL --value https://api.jovops.com --visibility plaintext
   ```
   Production builds now fail on purpose without it (`apps/mobile/scripts/check-release-env.cjs`).
   - Also replace the ngrok value in your **local** `apps/mobile/.env.production`. Any local `expo export` or `eas update` reads it, and since this run a release bundle built from it refuses to start.
   - Prefer `eas update --environment production` so updates use the EAS values.
2. **Lockfile (L1).** `expo-camera` was removed from `apps/mobile/package.json` only. Run `npm install` at the repo root, check that only the expo-camera entries leave `package-lock.json`, and commit.
3. **Deploy the API** (when you choose) from this branch. On deploy, two new migrations must run:
   - `20261031120000_add_account_deletion_request`: a new table.
   - `20261031130000_allow_anonymised_user_phone`: replaces the `User` phone CHECK.

   **Without the second one, account deletion returns 500 in production.** It is very likely failing there today.

   Both are additive and quick, and both were verified on a throwaway PostgreSQL 17 database, together with all 82 e2e tests.
4. **Health endpoint (L2).** The public health response no longer includes `commit` unless `HEALTH_EXPOSE_COMMIT=true`.
   - The **trial** workflow `.github/workflows/deploy-trial-api.yml` compares `.commit`, so set `HEALTH_EXPOSE_COMMIT=true` on the Azure trial app, or accept that check failing.
   - On Railway, set it only if you want to keep seeing the commit.
5. **Host the four static pages** (`docs/store/site/*.html`) at `https://jovops.com/privacy`, `/terms`, `/delete-account` and `/support`. `jovops.com` did not respond on 2026-10-31.
   - Any static host works, for example Cloudflare Pages or the admin Vercel project.
   - Serve clean URLs (`/privacy` → `privacy.html`).
   - Create the support and privacy mailboxes.
6. **Firebase (H3).** Follow `technical-analyses.md#h3` steps 1–4. Then ask for a follow-up run to wire `google-services.json` into the hand-maintained Android project.
7. **Catalogue (H6, Khaldoun).**
   - Export the live catalogue as CSV and run `cd apps/api && npx tsx scripts/restricted-catalogue-report.ts --file <export.csv> --out report.csv`. It is offline and read-only.
   - Deactivate every BLOCKED product in the admin console.
   - Decide on each REVIEW row.
   - Keep the full ~1,820-product import file free of tobacco and alcohol: the importer now refuses them.
8. **Image provenance (M5, Khaldoun):** fill `docs/release-readiness/image-licence-audit-template.csv`.
9. **Demo accounts (B6):** create them per `reviewer-access-guide.md` §1, and arrange test-order handling with store staff (§3).
10. **Play Console (B7):** fill App content from `docs/store/play-console-declarations.md` and `data-safety-and-app-privacy.md`, record the video, set up the closed test (12+ testers, 14 consecutive days), and add the listing text and screenshots.
11. **Apple:** wait for enrollment, then follow `apple-app-store-submission-checklist.md`.
12. **Local Android release build:** repair the NDK (Android Studio → SDK Manager → SDK Tools → NDK 27.1.12297006 → reinstall; the folder is empty today). Then:
    ```
    cd apps/mobile/android
    JAVA_HOME=<JDK 21> EXPO_PUBLIC_API_URL=https://api.jovops.com ./gradlew :app:assembleRelease
    ```
    `JAVA_HOME` currently points at a missing Android Studio `jbr`; JDK 21 is installed at `C:\Program Files\Eclipse Adoptium\jdk-21.0.9.10-hotspot`.

## C. Decisions needed

| # | Decision | Default taken in this run (most conservative) |
|---|---|---|
| D1 | Keep `ACCESS_BACKGROUND_LOCATION` in v1, or switch to foreground-service-only tracking (H4) | Kept, as you instructed. The analysis and device test are in `technical-analyses.md#h4`. |
| D2 | Guest browsing (H2) before the first Apple submission | Not implemented (analysis only). It is strongly recommended before iOS. |
| D3 | Driver location sent once from the driver home when there is no active delivery (H8) | **Behaviour kept**, because `apps/mobile/src/features/driver/screens.tsx` holds your uncommitted change and I may not touch it. The disclosure, iOS strings and privacy policy were changed to describe it (disclosure version 2). Alternative: guard `refreshLocation()` with `hasActiveDelivery || isOnline` in a later run. |
| D4 | Should a driver with a pending (scheduled) deletion be prevented from claiming new deliveries? | Not prevented: the deletion completes once they are settled. Preventing claims would change dispatch behaviour. |
| D5 | Should a REVIEW-classified product need an admin (not store staff) to make it available? | No. Any staff member with `MANAGE_PRODUCTS` can make it available; that is the manual review. |
| D6 | Store owner self-deletion | Refused (`BUSINESS_OWNER_DELETION_REQUIRES_ADMIN`). An admin must transfer the store. There is no transfer tool yet. |
| D7 | Admin deletion | Self-deletion is refused (`ADMIN_DELETION_REQUIRES_SECOND_ADMIN`). Another admin can **suspend** them today (existing `setUserActive`). Full anonymisation of an admin by a second admin is **not built**. |
| D8 | Demo-phone login back-off (M8) | No code change. Options are in `reviewer-access-guide.md` §4. |
| D9 | WebSocket disconnect on suspension or deletion (security S5) | Not changed (auth behaviour). It is recommended. |
| D10 | Map tiles provider (M3) and geocoding proxy (M4) | Not changed. The options are in `technical-analyses.md`. |
| D11 | Crash reporting (M2) | Not added: it needs a dependency and lockfile change plus your Sentry account. |
| D12 | Push pre-permission explainer (L4) | Not changed: the push permission is still requested after sign-in, as before. Low risk, so documented only. |

## D. Auth, authorization and permission changes made in this run (for your review)

All are **additions**; no existing guard, rate limit or permission was changed.

1. **`DELETE /api/v1/users/me`** (existing endpoint, same `JwtAuthGuard`, acts only on the caller's own id).
   - **Customer:** unchanged result (204, anonymised). The writes, their order and the audit action `CUSTOMER_ACCOUNT_DEACTIVATED` are the same, and it now succeeds in PostgreSQL thanks to the constraint migration.
   - **Driver:** **new.** 204 when nothing is outstanding, otherwise **202** `{status:"SCHEDULED", scheduledFor, blockers}`.
   - **Store staff (RESTAURANT, not owner):** **new.** 204, and `BusinessMember.isActive=false`.
   - **Store owner:** **new code** 409 `BUSINESS_OWNER_DELETION_REQUIRES_ADMIN`; previously 409 `ACCOUNT_DELETION_SUPPORT_REQUIRED`.
   - **Admin:** **new code** 409 `ADMIN_DELETION_REQUIRES_SECOND_ADMIN`; previously `ACCOUNT_DELETION_SUPPORT_REQUIRED`.
2. **`GET /api/v1/users/me/deletion`** (new, `JwtAuthGuard`, caller's own data only).
3. **`AccountDeletionSweepService`** (new background job, hourly).
   - It completes due driver deletions.
   - Off switch: `ACCOUNT_DELETION_WORKER_ENABLED=false`. Interval: `ACCOUNT_DELETION_SWEEP_INTERVAL_MS`.
4. **Database:** `User_phone_e164_check` now also accepts `deleted-<own id>` on inactive rows only. Live accounts still require +970/+972.
5. **Catalogue validation:** product and category create, update and import now refuse tobacco, nicotine, vaping and alcohol (422 `RESTRICTED_PRODUCT` / `RESTRICTED_CATEGORY`), and hide ambiguous items. It is input validation, not a permission change.
6. **Mobile:** Settings shows "Delete my account" for DRIVER and RESTAURANT as well as CUSTOMER; ADMIN sees an explanation instead.
   - Drivers and staff keep a Sign out button in Settings.
   - Restaurant browsing and restaurant registration screens were removed from the app. The API endpoints are unchanged, and registration stays closed by `PUBLIC_RESTAURANT_REGISTRATION_ENABLED`.

## E. Assumptions recorded (most conservative reading)

- "Store staff" means every `RESTAURANT`-role user who is not `Restaurant.ownerUserId`.
- Driver deletion blockers are:
  - any delivery in ASSIGNED, PICKED_UP or ON_THE_WAY;
  - any cash custody not SETTLED;
  - a non-zero `DRIVER:<id>` earnings balance, computed exactly as accounting computes it.
- A scheduled deletion shows the date *on or after which* it completes. If blockers remain on that date, it stays pending and the sweep logs a warning for operations.
- The public health `commit` field is hidden by default instead of deleted, so the trial deploy check can be kept with one environment variable.
- The legal pages are hosted at clean URLs under `https://jovops.com/`; the app links to those exact URLs (`apps/mobile/src/core/legal-links.ts`).

## F. Run 2 (`store-remediation-2`): auth, authorization and public-route changes for your review

1. **WebSocket disconnect (security S5, was D9).** After the database commit, the API now ends live Socket.IO connections:
   - admin suspension (`PATCH /admin/users/:id/active` with `isActive:false`) and platform-role change: all of that user's sockets;
   - self-service deletion (`DELETE /users/me` returning 204) and the scheduled-deletion sweep when it anonymises: all sockets;
   - password reset (`POST /auth/reset-password`): all sockets;
   - sign-out (`POST /auth/logout`): **only the sockets opened with that session** (other devices stay connected).
   No guard, token rule or rate limit changed; a disconnect failure is logged and never fails the HTTP request. Files: `apps/api/src/realtime/realtime.gateway.ts`, `admin/admin.service.ts`, `users/users.service.ts`, `auth/auth.service.ts`. Known gap: a socket that finishes its handshake in the few milliseconds between the commit and the disconnect call can stay open until its next reconnect; its HTTP calls are already refused.
2. **Guest browsing (H2, was D2).**
   - **New public route:** `GET /api/v1/supermarkets/:supermarketId/delivery-area` → `{ maximumDistanceMeters, addressLine }`. No token, covered by the existing global rate limiter (thresholds unchanged), approved supermarkets only (404 otherwise). It reads the same `DELIVERY_MAX_DISTANCE_METERS` setting the quote already enforces; no fee or formula is exposed or changed.
   - Already public before this run and unchanged: `GET /supermarkets`, `/supermarkets/:id/status`, `/supermarkets/:id/catalog`, `/supermarkets/:id/products/:pid`, `/restaurants/offers/active`.
   - Still protected (asserted 401 without a token in `guest-browsing.e2e.test.ts`): `/users/me` (GET, DELETE), `/users/me/addresses`, `/orders`, `/orders/quote`, `/orders/me`, `/notifications/me`, `/settings`, `/landmarks`.
   - Mobile: "Browse without an account" on the login screen opens the store as a guest (no token held). One navigation gate (`guardGuestNavigation`) turns checkout, orders, account, settings and notifications into the sign-in screen; checkout comes back to the kept cart after sign-in. Signed-in sessions and the cart are unchanged.
   - Not done: the app does not yet display the new delivery-area answer on the guest home (the API is ready; one UI line). Delivery-area text in the listing still needs P7/P8.
3. **Android push (H3) — repository is now ready; only your Firebase steps remain.** No credentials were created or committed.
   1. Firebase console → add an Android app with package `com.jovo.app` → download `google-services.json` (public client identifiers; still keep it out of chat logs).
   2. Store it as an EAS **file** variable for the profiles that need push:
      ```
      eas env:create --environment production --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --visibility secret
      ```
      Repeat with `--environment preview` for the closed-test build if that profile is used.
   3. Firebase → Project settings → Service accounts → Generate new private key; upload it with `eas credentials` → Android → production → Google Service Account → FCM V1. Never commit this key.
   4. Build. `eas-build-pre-install` now runs `scripts/install-google-services.cjs`, which validates the file is for `com.jovo.app` and copies it to `android/app/google-services.json` (git-ignored). Gradle applies `com.google.gms.google-services` 4.4.2 **only when that file exists**, so builds without the variable behave exactly as before.
   5. Run the device test plan in `technical-analyses.md#h3`. UNVERIFIED here: no Android SDK or Gradle build could run in the cloud container.
4. **Demo (app-review) accounts (B6, M7).**
   - **New admin route:** `PATCH /api/v1/admin/users/:userId/demo` `{isDemo, reason}`. Same guards as the other admin user routes (`JwtAuthGuard`, ADMIN role, `MANAGE_USERS`). Audited. Customers and drivers only.
   - **Behaviour change (review it):** demo orders alert only demo drivers; `GET /driver/me/deliveries/available` now filters by the caller's demo flag; `POST /driver/me/deliveries/:id/accept` answers 404 across the demo/real boundary; `PATCH /driver/me/deliveries/:id/status` refuses DELIVERED and FAILED for a demo order (`DEMO_ORDER_CANNOT_COMPLETE`). For non-demo accounts (every account today, since the column defaults to false) behaviour is identical.
   - **New migration:** `20261101090000_add_demo_account_flags` adds `User.isDemo` and `Order.isDemo` (BOOLEAN NOT NULL DEFAULT false). Additive; old code ignores the columns. **Deploy order:** the migration must run before the new code (the new code reads the columns).
   - Login and the rate limiter are unchanged (M8 still documented only; `reviewer-access-guide.md` §4).
   - Your steps: create the two accounts with numbers you control [[P19]], mark them with the route above, fill the guide's placeholders.
5. **Product policy (H6) — two paths closed.** Re-verified every write path: product create/update, category create/update and the CSV import were already screened. Two were not: `PATCH .../menu/items/:id/availability` (switch on) and `PATCH .../menu/categories/:id` with only `isActive:true`. Both now refuse a stored BLOCKED name with 422 (`RESTRICTED_PRODUCT` / `RESTRICTED_CATEGORY`); hiding is never blocked; REVIEW items/categories can still be switched on (decision D5). Not screened by design: `prisma/seed.ts` (dev data; the repo seed CSV reports 0 BLOCKED / 0 REVIEW) and stock-only updates. Existing products were not changed. Your step: run `restricted-catalogue-report.ts` on a live export (owner item B.7).
6. **Geocoding proxy (M4) and tile configuration (M3).** New authenticated route `GET /api/v1/geocode/reverse` (JwtAuthGuard, not public). Set `GEOCODER_USER_AGENT` on Railway (needs P21) or address lookup stays off. Choose a licensed tile source and set the three `EXPO_PUBLIC_MAP_*` EAS variables (`technical-analyses.md#m3-run2`). Delete `EXPO_PUBLIC_GEOCODER_URL` from EAS if present (no longer read).
7. **Crash reporting (M2, was D11).** The app now has a vendor-neutral reporter (`apps/mobile/src/core/error-reporting.ts`, `app-error-reporter.ts`) wired to the render ErrorBoundary and React Native's global JS error handler. **It does nothing until you set `EXPO_PUBLIC_ERROR_REPORT_URL`** (HTTPS) in the EAS environment. It POSTs a small JSON report (error name, masked message, short stack, app version, platform, screen context); never tokens, ids, phones, addresses or coordinates. No dependency, key or lockfile change. Your steps:
   1. Choose the receiver: the same service you use behind the API's `ERROR_TRACKING_WEBHOOK_URL` if it accepts a JSON POST, or a vendor ingest URL. (A vendor SDK such as Sentry would also catch native crashes; that needs a dependency + lockfile change you run yourself: `npx expo install @sentry/react-native` in `apps/mobile`, then replace `send` in `app-error-reporter.ts`.)
   2. `eas env:create --environment production --name EXPO_PUBLIC_ERROR_REPORT_URL --value <https url> --visibility plaintext`
   3. Fill P17 in the privacy policy and switch the Data safety "Crash logs" answer to "Collected, not shared" **before** the build that turns it on (`docs/store/data-safety-and-app-privacy.md`).
   Native (Java/Kotlin/Obj-C) crashes are not caught by this JS reporter.
8. **Store texts re-checked against run 2 code (task 10).** Updated: privacy policy (AR/EN, `.md` and `site/privacy.html`): guest browsing collects no personal data; Nominatim now receives the map point from the JOVO server, not the device; app error reports only if switched on. Data safety / App Privacy: crash answer is conditional on `EXPO_PUBLIC_ERROR_REPORT_URL`. Listing (AR/EN): "even before creating an account". Terms, delete-account and support pages needed no change. **Every placeholder still visible**: all `[[PLACEHOLDER: …]]` occurrences in `docs/store/*` and the reviewer guide map to P1–P21 in table A (support email ×15+4, town ×10+10+2, support phone ×7+6, privacy email ×6+6, governing law ×6+6, radius ×6+5+2, minimum age ×5+4, backup and accounting retention ×4+4 each, deletion delay ×4+4, publication date ×4+4, operator legal name ×4+4, server error-tracking provider ×2+2, web-deletion days ×2+2, refund policy ×2+2, support hours ×2+2, liability clause ×2+2, courts ×2+2, legal address ×2+2, geocoder contact email ×2, developer name ×1, demo address ×1, demo phone numbers ×1). The four HTML pages must be regenerated or hand-edited after you fill them.
9. **Push pre-prompt (L4, was D12).** Re-verified: the app never asks for notification permission right after sign-in on a fresh install (it re-registers only if notifications were enabled before). The system prompt is triggered by the Settings toggle and, for drivers, by going online. Every path now shows JOVO's role-specific explainer (Arabic/English) first when the OS has not asked yet; "Not now" leaves the OS question unasked. `apps/mobile/src/core/push-permission.rules.ts` (+2 tests), `push-notifications.ts`. Remaining L items: L1 lockfile (run `npm install` yourself), L5 manifest check on the first AAB (needs a build).

## G. Run 3 changes for your review

1. **Product review state (task 1).** New additive migration `20261102090000_add_menu_item_review_status`: enum `MenuItemReviewStatus` (`PENDING_REVIEW`, `APPROVED`), `MenuItem.reviewStatus` NOT NULL DEFAULT `APPROVED`, `reviewedAt`, `reviewedByUserId` (no FK), one index. Every existing product becomes APPROVED, so nothing customer-visible changes on deploy. Customer catalogue, search, product page, public offers, order quote/creation and substitution replacements now exclude PENDING_REVIEW. Staff and admin product views gain `reviewStatus`/`reviewedAt` (additive fields). `isAvailable` keeps its meaning (stock/visibility switch) and is not treated as approval. No auth change.
2. **Admin product review (task 2).** New admin routes, same guards as the existing admin product routes (`JwtAuthGuard`, ADMIN role, `MANAGE_BUSINESSES`): `GET /api/v1/admin/products?reviewStatus&search&restaurantId&page&pageSize` (list + `pendingReviewCount`; search by name, SKU, barcode exact/prefix) and `POST /api/v1/admin/products/approve {itemIds[1..200]}` (audited `PRODUCTS_APPROVED`; a product on the tobacco/nicotine/vape/alcohol deny-list is refused and reported, never approved). Store staff cannot approve (403, tested). Editing uses the existing `PATCH /admin/restaurants/:id/menu/items/:id` (its screening, price and image rules unchanged). Admin web: new page `/products/review` (nav "Product review"), Arabic and English.
3. **Catalogue importer (task 3).** New additive migration `20261102100000_add_menu_item_import_source` (`MenuItem.importSourceId`, `importChecksum`, unique `(restaurantId, importSourceId)`; NULLs never collide). CLI `apps/api/scripts/catalogue-import.ts`, guide `catalogue-import-guide.md`. No production run was made. Refuses non-localhost databases unless `--production --confirm <token>` (token bound to host, database, store and file hash). No auth or public-route change.

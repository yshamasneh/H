# JOVO — App Store & Google Play First-Submission Readiness Audit

- **Date:** 2026-10-31
- **Scope:** `apps/mobile` (Expo SDK 54, RN 0.81.5, bare Android project checked in), `apps/api` (NestJS), `apps/admin` (web, not submitted to stores), deployed API `https://api.jovops.com`.
- **Repo state audited:** branch `agent/phase-15-and-jovo-brand`, HEAD `23e9045`, one uncommitted change in `apps/mobile/src/features/driver/screens.tsx`. Production health reports commit `56dcff4` (3 commits behind HEAD).
- **Mode:** read-only. No files changed except this report. Secrets were never printed: only variable **names** and pattern **counts** were read from `.env*` files.
- **Local checks run:** `tsc --noEmit` passed (exit 0). Native-config sync check passed ("com.jovo.app, version 0.17.0 (17), 8 granted and 5 blocked Android permissions"). Unit tests: 263/263 passed. UI tests (jest): 34 suites, 194/194 passed. Resolved `expo config --type public` inspected.
- **Production calls made:** only `GET https://api.jovops.com/api/v1/health` (200, HTTPS valid; plain HTTP redirects 301 to HTTPS). Plain GETs to `https://jovops.com`, `https://www.jovops.com`, `/privacy` and `/delete-account` got no response (connection failed, code 000). `https://images.jovops.com/` returned 404 at the root, which is expected for a bucket.

**Labels used:** **CONFIRMED** means seen in code, config or a fetched page. **LIKELY** is a strong inference from code. **UNVERIFIED** means it could not be checked; the reason is given in section 6.

**All probabilities in this report are my judgment, not measured data.**

---

## 1) Verdict per store

### Google Play (personal account, closed test → production)

**Not ready today.** You cannot complete the Play Console declarations without three public URLs, and none of them exists yet: a privacy policy, an account-deletion web page and a support contact. The background-location declaration and its video are not done, and the store listing text still describes "TasawaQ", a restaurant app.

The core engineering is in good shape:
- targetSdk is 36, which meets the requirement in force from 2026-08-31.
- The prominent disclosure for background location exists in Arabic and English.
- The foreground-service location type is declared.
- Payments are cash on delivery for physical goods only.
- The app is HTTPS-only in release.
- Tobacco is absent from the repo seed.

| Moment | Estimated probability of rejection or a blocking policy issue on first submission | Confidence |
|---|---|---|
| As the project stands today | **85–95 %** | Medium-high |
| After all BLOCKER items are fixed | **35–50 %** (driven mainly by the background-location declaration review and the production-access application after the closed test) | Medium |
| After BLOCKER + HIGH are fixed | **15–25 %** (or **10–15 %** if v1 ships without `ACCESS_BACKGROUND_LOCATION`, see H4) | Medium-low |

### Apple App Store (enrollment pending, so iOS is fully blocked)

**Blocked at the account level.** Even after enrollment, the first iOS submission would very likely be rejected today for several reasons:
- There is no privacy policy, either as a URL or as a link inside the app.
- There is no support URL.
- There are no demo accounts.
- A login wall stops reviewers before they can browse the catalogue (5.1.1(v)).
- Only customers can delete their account.
- A "Development API" label is visible on the first screen.
- No iOS build has ever been produced (there is no `ios/` folder), so privacy-manifest and build issues have not been surfaced yet.

| Moment | Estimate (after enrollment is approved) | Confidence |
|---|---|---|
| Today | **90–97 %** | Medium-high |
| After BLOCKERs | **40–55 %** | Medium-low |
| After BLOCKER + HIGH | **15–30 %** | Low-medium (no iOS build has ever been produced, so there are unknowns) |

### Top 10 most likely rejection reasons (both stores combined, ranked)

| # | Reason | Store | Likelihood today | Why |
|---|---|---|---|---|
| 1 | No public privacy policy URL, and no privacy link inside the app (the existing draft is TasawaQ/restaurant text) | Both | ~95 % | Both are hard requirements (Apple 5.1.1(i); Play User Data policy and the Data safety form). You can't submit without the URL. |
| 2 | Reviewer cannot get in: no demo accounts, and signup needs a +970/+972 SMS OTP | Both | ~90 % | Apple 2.1 ("include demo account info"); Play App access. |
| 3 | Background location: declaration, video and listing mention missing, or the declaration is rejected | Google | 60–80 % today, 30–45 % after preparation | Google says delivery tracking is usually possible in the foreground. A driver-side background use gets a manual review, and the listing must mention it. |
| 4 | No web account-deletion URL (Google), and in-app deletion only for customers | Both | ~85 % (Google), ~50 % (Apple) | Play requires both the in-app path and a web link. Apple disallows "contact support" flows for non-regulated apps. |
| 5 | Login wall before browsing a shop | Apple | 40–60 % | 5.1.1(v): "If your app doesn't include significant account-based features, let people use it without a login." Grocery browsing is not account-based. |
| 6 | Store listing and metadata mismatch: TasawaQ, restaurants, meals | Both | ~80 % if the current `docs/store-listing.md` text is used | Apple 2.3 / Play Metadata policy. Also missing the background-location mention Play requires. |
| 7 | "Development API" label and raw API URL on the login screen | Apple (and Play human review) | 30–50 % | Looks like a non-final or debug build (2.1: "should be final versions"). |
| 8 | Driver/store/admin roles not documented, and a dormant server-gated restaurant feature | Apple | 25–40 % | 2.3.1 (describe all features in Review Notes) and 2.5.19 (no hidden or dormant features). |
| 9 | Crash or blank screen on first launch if the EAS production env var is wrong; 30 s OTA launch wait | Both | 10–30 % (UNVERIFIED) | `api.ts:407` throws at module load in release if `EXPO_PUBLIC_API_URL` is missing or not HTTPS. The local `.env.production` points at ngrok. |
| 10 | Driver/staff push notifications not working on Android (no Firebase config) | Both (functional) | 20–35 % | Reviewers who test the driver flow get no alerts. This is not a policy violation, but it's a "feature doesn't work" rejection risk. |

---

## 2) Risk table

Owners:
- **Mohammad**: decisions, legal text approval, store consoles.
- **Claude Code**: code and docs in the repo.
- **Codex**: second implementer or reviewer.
- **Khaldoun**: store operations, catalogue, demo-order handling.
- **store account**: Play Console or App Store Connect actions.

Effort is in hours of focused work.

### BLOCKER

| ID | Sev | Store | Finding & evidence | Policy URL (fetched) | Fix | Effort | Owner |
|---|---|---|---|---|---|---|---|
| B1 | BLOCKER | Both | **No public privacy policy, and the draft is wrong.** CONFIRMED: `docs/privacy-policy.md:1` title "سياسة خصوصية TasawaQ"; it describes restaurants (lines 5, 9, 10), calls itself a draft that "must not be published" (line 36), has no operator name or contact, and lists "error monitoring" that doesn't exist. It omits real processors: Railway (hosting/DB), Cloudflare R2 (images), Backblaze B2 (encrypted backups), TweetSMS (OTP), Expo Push / FCM / APNs, OpenStreetMap Nominatim (reverse geocoding, `apps/mobile/src/core/geocode.ts:22`), Esri ArcGIS tiles (`location-map.android.tsx:41-43`), Apple Maps (iOS map) and Google/Apple navigation hand-off. `https://jovops.com` and `/privacy` did not respond on 2026-10-31. | Apple 5.1.1(i) https://developer.apple.com/app-store/review/guidelines/ ("All apps must include a link to their privacy policy in the App Store Connect metadata field and within the app"); ASC "A privacy policy URL is required for all apps" https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/ ; Play background location page lists "Privacy policy missing, not linked, or not covering location data" as a common rejection https://support.google.com/googleplay/android-developer/answer/9799150 | Rewrite as a JOVO / JOVO MARKET policy (Arabic + English). Cover: data list per role; customer and driver location (foreground, plus background only during an active delivery); push token; named processors; retention after deletion (orders kept anonymised); contact email; operator legal name. Publish at a stable HTTPS URL, for example `https://jovops.com/privacy` (the root domain needs a site; the admin Vercel project or a static page works). | 5–6 | Mohammad (approve text, legal name), Claude Code (draft + static page) |
| B2 | BLOCKER | Both | **No privacy policy or terms link inside the app.** CONFIRMED: no `privacy`/`terms` link or `Linking.openURL` to a policy anywhere in `apps/mobile/src` or `App.tsx`. The only `openURL` calls are phone calls, maps and navigation. Signup has no consent text. | Same as B1 (Apple 5.1.1(i)); Play User Data policy https://support.google.com/googleplay/android-developer/answer/10144311 (UNVERIFIED fetch, see §6) | Add "Privacy policy" and "Terms" rows in Settings (all roles) and on the Login/Signup screens. Add an "I agree to the Terms and Privacy Policy" line under the signup button. | 1.5 | Claude Code |
| B3 | BLOCKER | Google (and Apple support URL) | **No web account-deletion URL, and no support URL or email.** CONFIRMED: `jovops.com` unreachable; `docs/store-listing.md:27` "Support URL and support email: supply operator-owned values". | Play account deletion https://support.google.com/googleplay/android-developer/answer/13327111 ("must also provide a web link where users can request account and data deletion… reference the app or developer name as it appears on the store listing") | Publish `https://jovops.com/delete-account`: the steps in the app, plus a request form or email for people who no longer have the app, with what is deleted and retained and the timeline. Add `https://jovops.com/support` and a support mailbox. | 2–3 | Claude Code (page), Mohammad (mailbox/domain) |
| B4 | BLOCKER | Both | **Store listing copy is for the old product.** CONFIRMED: `docs/store-listing.md:7-21` ("TasawaQ \| تسوق", "اطلب وجبتك", keywords "مطاعم,وجبات", "Browse restaurants…"). It does not mention driver background location, which Play requires in the description. No screenshots or feature graphic exist (only `assets/store/{app-icon-1024,adaptive-icon-foreground,splash-icon}.png`). | Play background location: disclosure "must also appear in the app description" https://support.google.com/googleplay/android-developer/answer/9799150 ; Apple 2.3 (accurate metadata) https://developer.apple.com/app-store/review/guidelines/ | Write the JOVO MARKET listing (AR primary + EN): supermarket only, cash on delivery, the named service town, a delivery-area statement, and a sentence on driver background location during active deliveries. Capture screenshots from a release build with demo data. | 4–6 | Claude Code (copy), Mohammad (screenshots) |
| B5 | BLOCKER (until verified) | Both | **Production API URL pipeline is unsafe.** CONFIRMED: `apps/mobile/.env.production` defines `EXPO_PUBLIC_API_URL` whose value contains `ngrok` (1 match) and not `api.jovops.com` (0 matches); the file is gitignored, so EAS cloud builds don't upload it. `apps/mobile/src/core/api.ts:407-409` throws at module load in release if the URL is missing or not `https://`, so the app crashes on launch. The EAS "production" environment variables could not be read (UNVERIFIED). A local `eas update` / `expo export` would read the stale ngrok value. | Apple 2.1 (crashes/bugs) https://developer.apple.com/app-store/review/guidelines/ | Set `EXPO_PUBLIC_API_URL=https://api.jovops.com` in the EAS `production` environment and confirm with `eas env:list` (names and values are fine to view yourself). Replace the local `.env.production` value. Add a CI/build-time assertion that the bundle's API host is `api.jovops.com`. | 1 | Mohammad (EAS), Claude Code (assertion) |
| B6 | BLOCKER | Both | **No reviewer access.** CONFIRMED: login is phone + password (`auth/screens.tsx:59-108`); signup only accepts `+970`/`+972` (`core/phone.ts:3`) and needs an SMS OTP. There is no demo or review bypass in the API (searched; none found, which is correct). No demo account exists in the docs (`docs/store-listing.md:30` is a TODO). | Apple 2.1 ("include demo account info (and turn on your back-end service!)"); Play App access https://support.google.com/googleplay/android-developer/answer/9859455 ("you must provide all required details to enable access") | Create dedicated production demo accounts (customer, driver, store staff) with known passwords. See section 3. **Do not add an OTP bypass**; it isn't needed because login is password-based. | 3 | Mohammad / Khaldoun (create via admin), Claude Code (review notes) |
| B7 | BLOCKER | Google | **Play declarations not done:** Location permissions (background), Foreground service (location), Data safety, Ads, Content rating, App access, Target audience. The text is prepared in `docs/play-store-background-location.md`, but the video is not recorded. Declarations are needed before **any** track release, including the closed test. | https://support.google.com/googleplay/android-developer/answer/9799150 ; FGS https://support.google.com/googleplay/android-developer/answer/13392821 ("you'll need to declare any foreground service types that you use… Video") | Record one Android video (≤30–60 s, script in §3). Complete all App content forms with §4 answers. Declare **one** background-location feature only ("We can only evaluate one feature at a time"). | 4 | Mohammad (store account) |
| B8 | BLOCKER (account) | Apple | Apple Developer enrollment pending, so no App Store Connect record, TestFlight or iOS build. No iOS build has ever been produced (`check-native-config.cjs:41` asserts no `ios/` folder). | — | Finish enrollment; then run `eas build -p ios --profile production` and TestFlight internal testing before review. | n/a | store account |

### HIGH

| ID | Sev | Store | Finding & evidence | Policy URL | Fix | Effort | Owner |
|---|---|---|---|---|---|---|---|
| H1 | HIGH | Both | **Account deletion only for customers.** CONFIRMED: `apps/api/src/users/users.service.ts:125-130` returns 409 `ACCOUNT_DELETION_SUPPORT_REQUIRED` for DRIVER/RESTAURANT/ADMIN. `App.tsx:757` passes `onDeleted` only for CUSTOMER, so other roles see no delete button (`settings-screen.tsx:196-215`). Driver and staff accounts are created inside the app by an admin (`features/admin/driver-account-screens.tsx`). The customer confirmation copy says "Your account will be deactivated and its data permanently hidden" (`en/customer.json:93`), which reads like deactivation even though the code anonymises name and phone, deletes addresses and push tokens, and revokes sessions (`users.service.ts:131-152`). | Apple account deletion https://developer.apple.com/support/offering-account-deletion-in-your-app/ ("only offering to temporarily deactivate… is insufficient"; non-regulated apps "should not require people to make a phone call, send an email…"); Play https://support.google.com/googleplay/android-developer/answer/13327111 | Allow drivers and store staff to request deletion in-app. Use immediate anonymisation when they have no active delivery or open cash custody; otherwise schedule it and show the expected date and what is retained. Keep admin deletion behind a second admin. Reword the copy to "Your account and personal data will be deleted. Order and cash records required by law are kept without your name or phone." Also clear driver `lastLatitude/lastLongitude` on deletion. | 6–8 | Claude Code, Codex (review) |
| H2 | HIGH | Apple | **Login wall.** CONFIRMED: `navigation.ts:92` `initialScreen = { name: "login" }`; there is no guest mode. Reviewers and users must create an account (with a local SMS number) before seeing a single product. | Apple 5.1.1(v) https://developer.apple.com/app-store/review/guidelines/ ("If your app doesn't include significant account-based features, let people use it without a login"; "Apps may not require users to enter personal information to function, except when directly relevant to the core functionality") | Add guest browsing of the JOVO MARKET catalogue, search, product detail and the delivery-area info. Require login only at checkout. Whether the catalogue endpoints need a token is UNVERIFIED; they may need a public read route. | 10–16 | Claude Code, Codex |
| H3 | HIGH | Google (functional) | **No Firebase config for Android push.** CONFIRMED: no `google-services.json` anywhere outside `node_modules`; no `android.googleServicesFile` in the resolved config; no `com.google.gms.google-services` plugin in the checked-in `android/` Gradle files. `core/push-notifications.ts:44` calls `getExpoPushTokenAsync`, which on Android needs FCM. LIKELY: drivers and store staff get no order or delivery alerts on Android. | Apple/Google "app must work as described" (Apple 2.1) | Create a Firebase project for `com.jovo.app`, add `google-services.json`, apply the Gradle plugin in the bare project, upload FCM v1 credentials to EAS. The file is not a secret by Google's design, but keep it out of logs per your rules. | 2–3 | Mohammad (Firebase), Claude Code (gradle) |
| H4 | HIGH | Google | **Background-location approval risk.** Implementation is good (CONFIRMED: disclosure before prompt `components/background-location-disclosure.tsx`, only during an active delivery `features/driver/location-tracking.ts:23-58`, foreground-service notification `core/background-location.ts:68-73`, consent stored). But Google's page says delivery tracking is typically achievable in the foreground, so a driver background declaration gets manual scrutiny and is the most common first-submission bounce. | https://support.google.com/googleplay/android-developer/answer/9799150 ("Delivery or service tracking for users… foreground access can usually handle"; "Approval covers the entire app") | **Decision for Mohammad.** (a) Keep it and submit with a high-quality video and listing text; or (b) ship v1 **without** `ACCESS_BACKGROUND_LOCATION`, relying on the location foreground service started while the delivery screen is open. Option (b) removes the background declaration; whether expo-location allows it without background permission is UNVERIFIED and needs testing. Option (b) cuts Google risk substantially. | (a) 3, (b) 6–8 | Mohammad (decide), Claude Code |
| H5 | HIGH | Both | **"Development API" label shown in release.** CONFIRMED: `features/auth/screens.tsx:104` renders `<DeveloperApiLabel />` unconditionally; lines 653-662 print "Development API" (`en/auth.json:33`) plus the raw API URL under the login form. | Apple 2.1 ("final versions") https://developer.apple.com/app-store/review/guidelines/ | Render only when `__DEV__`. | 0.25 | Claude Code |
| H6 | HIGH | Both | **Tobacco exclusion is only a data convention, not enforced.** CONFIRMED: the repo seed `products/products_seed.csv` has 130 rows in 13 categories and 0 tobacco/vape/alcohol/medicine keyword hits (3 hits were Pampers diapers, which are harmless). There is no code-level block: `apps/api/prisma/import-products.ts` creates any category (lines 398-416), and admins can create any product in-app. UNVERIFIED: the full ~1,820-product file being prepared elsewhere and the **production DB** (not queried, per the rules). | Play Restricted Content https://support.google.com/googleplay/android-developer/answer/9878810 ("We don't allow apps that facilitate the sale of tobacco or products containing nicotine"; limited grocery exception "with age-gating"); Apple 1.4.3 | Before submission, have Khaldoun export the live catalogue and check category names and keywords (دخان, سجائر, معسل, تبغ, فيب, نيكوتين, vape, cigarette, alcohol). Add an API-side deny-list on category and product create/import that rejects tobacco/nicotine/alcohol keywords. Mark the 112 tobacco items inactive or deleted in production. | 3 | Khaldoun (data), Claude Code (guard) |
| H7 | HIGH | Both | **Roles and features undocumented for review; dormant restaurant vertical.** CONFIRMED: one binary contains customer, driver, store-staff (RESTAURANT role) and admin screens (`App.tsx` imports, `features/admin/*`, `features/restaurant/*`). Restaurant browsing is turned on by the server flag `RESTAURANT_ORDERING_ENABLED` (`apps/api/src/config/environment.ts:228`; `features/customer/home-screen.tsx:107-165, 463-465`) without an app release. Restaurant registration code remains (`App.tsx:642`, `features/auth/role-registration-screens.tsx`) but is unreachable: `LoginScreen` ignores `onRestaurantSignup` (`auth/screens.tsx:56` vs 90-107), and the API answers 403 `RESTAURANT_REGISTRATION_CLOSED` by default on deployed hosts (commit `56dcff4`). | Apple 2.5.19 ("Don't include any hidden, dormant, or undocumented features") and 2.3.1 ("All new features… must be described with specificity in the Notes for Review") | Describe every role in the Review Notes and Play App access. Either remove the restaurant browsing entry and registration screens from the v1 binary, or keep the flag off and state in the notes that restaurants are not part of this version. Removing them is safer. | 2 (notes) / 4 (remove) | Claude Code |
| H8 | HIGH | Both | **Location purpose strings are inaccurate for drivers and English only.** CONFIRMED: `app.json` `locationWhenInUsePermission` says location is used "only when you choose it to calculate delivery availability and pricing". But the driver home screen sends a one-off foreground location to the server on load even with **no** active delivery (`features/driver/screens.tsx:120-126`, `updateDriverLocation`). No `locales` key in `app.json`, so iOS prompts appear in English only. | Apple 5.1.1(ii)/(iii) (purpose strings must clearly describe use) https://developer.apple.com/app-store/review/guidelines/ ; Play disclosure accuracy https://support.google.com/googleplay/android-developer/answer/9799150 | Rewrite the when-in-use string to cover both customer address pinning and driver dispatch position. Either stop sending driver location when there is no active delivery, or disclose it (the privacy draft line 9 already mentions it). Add `expo.locales` with `ar.json`/`en.json` InfoPlist strings. | 2 | Claude Code |

### MEDIUM

| ID | Sev | Store | Finding & evidence | Policy URL | Fix | Effort | Owner |
|---|---|---|---|---|---|---|---|
| M1 | MEDIUM | Both | **Launch can block up to 30 s on an OTA check.** CONFIRMED: `android/app/src/main/AndroidManifest.xml` sets `EXPO_UPDATES_CHECK_ON_LAUNCH=ALWAYS` and `EXPO_UPDATES_LAUNCH_WAIT_MS=30000`; `app.json` `updates.fallbackToCacheTimeout: 30000`. On a slow network the reviewer sees the splash screen for up to 30 s. | Apple 2.1 (hangs) | Set `fallbackToCacheTimeout: 0` (and 0 in the manifest) so updates apply on the next launch. | 0.5 | Claude Code |
| M2 | MEDIUM | Both | **No crash reporting.** CONFIRMED: no Sentry, Bugsnag or Crashlytics in mobile or API; `components/error-boundary.tsx:34-37` only logs to the console. You couldn't diagnose a reviewer's crash. | Apple 2.1 | Add Sentry (or Crashlytics with H3's Firebase). Then declare "Crash data / Diagnostics" in §4 and the privacy policy. | 3 | Claude Code |
| M3 | MEDIUM | Both | **Esri World Imagery tiles used without a licence.** CONFIRMED: `components/location-map.android.tsx:41-48` (`server.arcgisonline.com …/World_Imagery`). Esri staff (Dec 2024) state the service needs an ArcGIS licence and "is not available for commercial use" (community answer; Esri ToS itself not fetched, so treat as LIKELY). | Apple 5.2.1 ("Don't use protected third-party material… without permission") https://developer.apple.com/app-store/review/guidelines/ ; Esri community https://community.esri.com/t5/arcgis-location-platform-developers-ques/inquiry-about-world-imagery/m-p/1569266 | Switch to a licensed tile source, for example MapTiler or Stadia (paid tier), Esri Location Platform with a key, or OSM-based vector tiles from a provider that allows commercial use, with attribution. | 3 | Claude Code, Mohammad (account) |
| M4 | MEDIUM | Both (functional) | **Nominatim used from the app without an app-identifying User-Agent.** CONFIRMED: `core/geocode.ts:22` default `https://nominatim.openstreetmap.org/reverse`; headers only `Accept` (`geocode.ts:95`). The OSMF policy says "stock User-Agents… will not do", "periodic requests from apps are… strongly discouraged", and "Apps must… switch the service at our request". If blocked, the address shows blank. It is also an unlisted third-party processor receiving coordinates. | https://operations.osmfoundation.org/policies/nominatim/ | Proxy reverse geocoding through the API (cache, identify JOVO) or use a commercial geocoder. Name it in the privacy policy. | 3 | Claude Code |
| M5 | MEDIUM | Both | **Product image provenance unknown.** CONFIRMED: 4,236 `.webp` packshots in `products/product_images` with generic names. `products_image_mapping.csv` has no source or licence column. Samples show manufacturer packaging (for example, an Italian-market Loacker pack, product-1000), with no visible watermark in the samples. UNVERIFIED: where the images came from. | Apple 5.2 ("only includes content that you created or that you have a license to use"); Play IP policy (not fetched) | Record the source per image. Prefer supplier or manufacturer media kits, or your own photos. Remove any image taken from another retailer's site or carrying another retailer's watermark. Add an IP contact to the listing. | 4–8 (review) | Khaldoun |
| M6 | MEDIUM | Apple | **Privacy manifest not configured.** CONFIRMED: no `ios.privacyManifests` in the resolved config; no iOS build yet. LIKELY covered by Expo's prebuild template and the SDK 54 module manifests, but React Native static pods may need app-level reasons (UserDefaults CA92.1, FileTimestamp C617.1, SystemBootTime 35F9.1, DiskSpace E174.1). Apple's documentation page did not render (see §6). | https://developer.apple.com/documentation/bundleresources/privacy-manifest-files (UNVERIFIED fetch); Expo guide https://docs.expo.dev/guides/apple-privacy/ | Add `ios.privacyManifests` with those reasons. After the first TestFlight upload, check for ITMS-91053 emails. | 1 | Claude Code |
| M7 | MEDIUM | Both | **Reviewer orders hit the real store.** LIKELY: the demo customer places a real cash order to JOVO MARKET, and a driver may be dispatched. | Apple 2.1 / Play App access | Ask reviewers in the notes not to place real orders, or set up a "review" handling process: Khaldoun cancels test orders tagged with the demo phone number. Optionally add a server rule that demo-account orders never notify real drivers. | 2 | Khaldoun, Claude Code |
| M8 | MEDIUM | Both | **Unexplained login back-off could lock a reviewer out.** CONFIRMED: 5 free failures, then a doubling back-off up to 15 min per phone+IP (commit `56dcff4`, `apps/api/src/auth/login-attempt-limiter.ts`). Apple reviewers sometimes share one IP and retry. | Apple 2.1 | Give the exact credentials with the country code spelled out ("+970, number 059…"). Consider an allow-list or a higher threshold for the demo phones. | 0.5 | Claude Code |

### LOW

| ID | Sev | Store | Finding & evidence | Fix | Effort | Owner |
|---|---|---|---|---|---|---|
| L1 | LOW | Both | Unused `expo-camera` dependency (`apps/mobile/package.json`; no import in `src`). The `CAMERA` permission itself comes from `expo-image-picker` (staff/admin product photos, `core/image-upload.ts:35-41`), which is justified. | Remove `expo-camera`. In the Data safety form, declare photos as collected from staff only (§4). | 0.25 | Claude Code |
| L2 | LOW | — | The health endpoint shows the old brand and the commit: `{"service":"tasawaq-api",…,"commit":"56dcff4…"}`. Not user-visible in the app. | Rename the service and drop the commit hash from the public response. | 0.25 | Claude Code |
| L3 | LOW | — | Internal storage keys still use old brands (`core/session.ts:7-9` `wasel_*`, `core/push-notifications.ts:47-49` `tasawaq.*`; i18n key `tasawaqWideOffer` whose value is "JOVO-wide offer"). Not user-visible, but renaming the keys would log users out. | Leave them. | 0 | — |
| L4 | LOW | Both | The push permission is requested right after login (`App.tsx:292` → `getPushToken`), without a pre-prompt explaining why. | Add a one-line explanation screen before asking, or ask at the first order. | 1 | Claude Code |
| L5 | LOW | Google | The merged-manifest permission set wasn't verifiable (no build output present). The resolved config adds `MODIFY_AUDIO_SETTINGS` (expo-audio), and libraries likely add `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED` and `WAKE_LOCK`. | After the first AAB, run `bundletool dump manifest` and check for no surprise permissions. | 0.5 | Claude Code |
| L6 | LOW | — | Stale comment in `navigation.ts:154-160` mentions a "coming soon" card. No such string exists in the locales (searched `comingSoon`, "coming soon", قريبا). The earlier finding is resolved. | Fix the comment when you're next in that file. | 0 | — |
| L7 | LOW | — | The `products/missingProducts.jpg` placeholder ("Oops, image missing", with a mirrored "OVOL" on the cap) is not referenced by the mobile code. | Make sure no live product uses it as its image. | 0.25 | Khaldoun |
| L8 | LOW | Google | `android/app/debug.keystore` is committed. That is normal (standard debug key). Release signing is not configured locally (`build.gradle` release has no `signingConfig`), so EAS-managed credentials and Play App Signing are expected. | Confirm the EAS Android credentials and enrol in Play App Signing on the first upload. | 0.5 | Mohammad |

### Re-verification of the earlier audit's findings

| Earlier claim | Status today | Evidence |
|---|---|---|
| Privacy policy and terms mention TasawaQ and restaurants | **Still true** | `docs/privacy-policy.md:1,5,9`; `docs/terms-of-service.md:1,5` |
| Account deletion only for customers | **Still true** | `users.service.ts:127-130`, `App.tsx:757` |
| Restaurant signup visible | **Fixed in the UI** (dead code remains; API closed by default) | `auth/screens.tsx:90-107` does not render it |
| iOS strings English only | **Still true** | `app.json` plugin strings; no `locales` |
| Stale ngrok URL in mobile `.env.production` | **Still true** | Pattern count 1 (value not printed) |
| Missing `google-services.json` | **Still true** | No file; no config key |
| Background location declaration needed | **Still true** (code side done; console side not) | `docs/play-store-background-location.md` |
| Privacy manifest missing | **Still true** (likely covered by the template; verify on the first iOS build) | No `ios.privacyManifests` |
| Tobacco (~112) excluded | **Partly true**: absent from the repo seed, no code guard, production unverified | §H6 |
| No crash reporting | **Still true** | §M2 |

### Items checked that PASS

- **Target API:** RN 0.81 `libs.versions.toml` sets `targetSdk = "36"`, `compileSdk = "36"`, `minSdk = "24"`. No override in `android/`. Play requires API 36 for new apps from 2026-08-31 (https://support.google.com/googleplay/android-developer/answer/11926878, fetched).
- **64-bit:** `reactNativeArchitectures` includes `arm64-v8a` and `x86_64`. EAS production builds produce an AAB by default.
- **Package consistency:** `com.jovo.app` matches across `app.json`, `build.gradle`, the namespace and Kotlin packages (the native-config check passed). iOS bundle id is `com.jovo.app`.
- **Export compliance:** `ITSAppUsesNonExemptEncryption: false` is correct. The app uses only HTTPS/TLS; `core/uuid.ts` crypto is random-ID generation, not encryption.
- **Payments:** cash on delivery for physical goods. There is no card form or payment SDK, so Apple 3.1.3(e) and Play Payments §3 exempt it from IAP and Play Billing (https://support.google.com/googleplay/android-developer/answer/9858738, fetched: "for the purchase or rental of physical goods").
- **Sign in with Apple:** not applicable. There is no third-party or social login (Apple 4.8, fetched).
- **App Tracking Transparency:** not applicable. There are no ad or analytics SDKs and no IDFA.
- **HTTPS:** release builds refuse non-HTTPS (`api.ts:407`). Cleartext is only allowed in `debug`/`debugOptimized` manifests. The production API redirects HTTP to HTTPS.
- **OTP safety:** production refuses console OTP (`apps/api/src/config/environment.ts:81`). The OTP dev hint and phone prefill are `__DEV__`-only (`auth/screens.tsx:63,340`).
- **Swagger:** forced off in production (`environment.ts:102-104`).
- **Delivery-area handling:** `DELIVERY_OUT_OF_RANGE` is handled with a clear message (`orders.service.ts:1063`, `en/errors.json:70`).
- **Fee transparency:** the delivery fee banner is shown at checkout (`cart-screens.tsx:756`), and a server quote guards against price changes.
- **Icon:** `app-icon-1024.png` is 1024×1024 with alpha fully opaque (min/max 255), so ITMS-90717 is not a concern. Orientation is portrait. Tablet support is off on iOS.
- **Background-location implementation:** disclosure before the system prompt, a decline option, a foreground-service notification, the iOS blue-bar indicator, and it stops when the delivery ends. This matches Google's "prominent disclosure" checklist.
- **Typecheck and all tests green.**

---

## 3) Reviewer kit gaps

### 3.1 Demo accounts (none exist yet)

Create these in **production**, through the admin app. Never use seed or dev credentials.

| Account | Role | Setup | Purpose |
|---|---|---|---|
| `review-customer` | CUSTOMER | Phone `+970 05x…` (a number you control, but reviewers never need the SMS). Password ≥12 chars. **Pre-saved delivery address inside the zone**, with a pin, so the reviewer can reach checkout without being in the West Bank. | Browse, cart, checkout (cash), order tracking, notifications, settings, account deletion (ask reviewers to use a second throwaway account, or re-create this one after review). |
| `review-driver` | DRIVER (approved) | Created by an admin. Keep one order prepared by staff and **assigned and ready for pickup** for this driver during the review window. | Driver home, active delivery, map, navigation hand-off, background-location disclosure and prompt. |
| `review-store` | RESTAURANT (store staff of JOVO MARKET) | Limited staff permissions. | Order board, accept and prepare orders, substitutions. |
| Admin | — | **Don't share a production admin login.** State in the notes that the admin area is an internal operations tool for JOVO employees, reachable only with accounts JOVO creates. Offer a restricted demo admin on request. | Apple 2.3.1 requires describing it; sharing it is optional but lowers risk. |

Also:
- Raise or bypass the login back-off for these phone numbers (M8).
- Tag their orders so Khaldoun can cancel them (M7).

### 3.2 Review notes (App Store "Notes" / Play "App access → Any other instructions")

Outline (English; add an Arabic copy):

1. **What JOVO is.** A single supermarket (JOVO MARKET) in [town], West Bank. Cash on delivery only, no digital goods, no in-app payments. Delivery is only within ~[N] km of the store. Outside it, checkout shows "This address is outside the delivery range"; that is expected.
2. **Login.** Phone + password. Choose country code **+970**, enter the number exactly as given, and the password. No SMS code is needed to log in. SMS codes are only used for new sign-ups and password resets, which need a Palestinian or Israeli number.
3. **Customer account.** A saved address inside the zone is pre-selected. Please don't place more than one test order; we cancel test orders.
4. **Driver account.** An order is already assigned. Open it, and on "Start delivery" you will see our location disclosure, then the system prompt. Location is shared only while a delivery is active, including in the background so dispatch can see the driver while they use a navigation app. It stops when the delivery is completed.
5. **Store-staff account.** Order board and preparation.
6. **Admin area.** Internal JOVO staff tool (users, drivers, offers, cash settlement). Not available to the public. Credentials on request.
7. **Account deletion.** Settings → Delete account (all roles after H1). Web: `https://jovops.com/delete-account`.
8. **Privacy policy.** `https://jovops.com/privacy`, also in Settings → Privacy.
9. **Contact.** [support email] / [phone].

### 3.3 Background-location video (Android, Play Console) — script outline, ≤30–60 s, one continuous take

1. Open JOVO (release build, Arabic or English). Log in as `review-driver`.
2. Driver home shows the assigned order. Tap it, then **Start delivery / Picked up**.
3. **The prominent disclosure screen** appears: title, the what/when/why/who/stop points. Pause on it for 3 s. Tap **Continue**.
4. The system foreground prompt, then "Allow all the time" (Android 11+ opens Settings; show the selection and return).
5. Press Home and open Google Maps navigation. Show the persistent **JOVO foreground-service notification** in the shade.
6. Cut to the admin web (or a second phone as admin) showing the driver's pin moving or updating while JOVO is in the background.
7. Return to JOVO and tap **Delivered**. Show that the notification disappears (tracking stopped).

Use the same video for the Foreground-service (Location) declaration. Pick the use case "Navigation / ride or delivery tracking" (UNVERIFIED exact label; choose the closest).

---

## 4) Drafted Data safety and Apple privacy label answers

These answers are derived from the code as it stands, plus M2 (crash reporting) if you add it. Apply them only after the privacy policy (B1) says the same things.

### 4.1 Google Play — Data safety

- **Does your app collect or share any of the required user data types?** Yes.
- **Is all user data encrypted in transit?** Yes (HTTPS only; `api.ts:407`).
- **Do you provide a way for users to request that their data is deleted?** Yes: in-app (Settings → Delete account) and the web URL (B3).
- **Ads:** "No, my app does not contain ads."
- **Shared with third parties:** **None.** Railway, Cloudflare, Backblaze, TweetSMS, Expo/FCM/APNs, Nominatim/OSM and the map tile provider are service providers acting for JOVO, which is exempt per https://support.google.com/googleplay/android-developer/answer/10787469. Showing the customer's address to the assigned driver and the store is part of JOVO's own service, not sharing.

| Category → type | Collected | Required/optional | Purposes | Notes / evidence |
|---|---|---|---|---|
| Location → **Precise location** | Yes | Optional for customers (address pin), required for drivers | App functionality | `core/location.ts:49-65` (customer pin); driver foreground and background during an active delivery (`background-location.ts`, `driver/screens.tsx:120-126`); `Order.deliveryLatitude/Longitude`, `DriverProfile.lastLatitude/Longitude` |
| Location → **Approximate location** | Yes (the `ACCESS_COARSE_LOCATION` permission is requested) | Optional | App functionality | Declare it to match the permission |
| Personal info → **Name** | Yes | Required | App functionality, Account management | `User.fullName` |
| Personal info → **Phone number** | Yes | Required | App functionality, Account management, Fraud prevention/security (OTP) | `User.phone`, TweetSMS |
| Personal info → **Address** | Yes | Required to order | App functionality | `Address`, `Order.deliveryAddressLine` |
| Personal info → **User IDs** | Yes | Required | App functionality, Account management | Account UUID |
| Personal info → Email | No | — | — | The schema has `email`, but the app never collects it |
| Financial info → **Purchase history** | Yes | Required | App functionality | Orders, items, totals, cash collected |
| Photos and videos → **Photos** | Yes (**store staff/admin only**) | Optional | App functionality | Product images (`core/image-upload.ts`) |
| App activity → **Other user-generated content** | Yes | Optional | App functionality | Order notes (`Order.customerNote`) |
| App activity → **Other actions** | Yes (drivers) | Required for drivers | App functionality | Driver app open/background state for dispatch (`DriverProfile.appState`) |
| App info and performance → **Crash logs / Diagnostics** | **Only if M2 is done** | — | Analytics (app stability) | None today |
| Device or other IDs | Yes | Optional (push can be turned off) | App functionality | Expo push token (`PushToken.token`) |
| Contacts, Messages (SMS/email), Health, Audio, Files, Calendar, Web history, Financial payment info | No | — | — | — |

Other Play App content answers:
- **Target audience:** 18+. Not designed for children.
- **Content rating (IARC):** shopping/utility, no violence, sexuality, gambling or UGC sharing with other users. **Answer "No" to tobacco/alcohol only once H6 is verified.** Expected rating: PEGI 3 / Everyone, or "Rated for 3+".
- **News app:** No. **Government app:** No. **Financial features:** None.
- **Health app:** No.

### 4.2 Apple — App Privacy ("nutrition label")

**Tracking:** **No** (no data used to track across apps or websites; no ATT prompt).

**Data Linked to You** (all purposes: **App Functionality**; phone also **Account management** is not an Apple purpose, so use "App Functionality" only):

| Apple category | Type | Notes |
|---|---|---|
| Contact Info | **Name**, **Phone Number**, **Physical Address** | Address = delivery address |
| Location | **Precise Location**, **Coarse Location** | Customer pin; driver location |
| User Content | **Photos or Videos** (staff only), **Other User Content** (order notes) | |
| Identifiers | **User ID**, **Device ID** (push token) | |
| Purchases | **Purchase History** | Cash orders |
| Usage Data | **Product Interaction** | Optional; include it if the driver app-state is considered usage |
| Diagnostics | **Crash Data**, **Performance Data** | **Only if M2 is added**, usually "Not linked" with Sentry if no user id is attached |

**Not collected:** Health & Fitness, Financial Info (payment card), Sensitive Info, Contacts, Browsing/Search History, Emails or Text Messages, Audio, Gameplay, Customer Support, Other Data.

**Other App Store Connect answers:**
- **Age rating:** answer "None" to all content questions. Tobacco/alcohol references: **None**, only once H6 is verified. User-generated content / social feed: **No**. Unrestricted web access: **No**. Purchases/gambling: **No**. Expected rating **4+**. The July 2026 social-media questions also apply; answer "No feed of UGC" (source: Apple developer news, via search).
- **Export compliance:** already answered by `ITSAppUsesNonExemptEncryption=false`.
- **Minimum iOS:** Expo SDK 54 default (15.1). iPhone only (`supportsTablet: false`), so iPad screenshots aren't needed.
- **Screenshots:** 6.9" iPhone set required (UNVERIFIED current sizes; check App Store Connect).

---

## 5) Prioritized fix plan — one week

Order chosen so that store-account work (which has waiting time) starts early and code work lands in one Android release (versionCode 18) for the closed test.

### Day 1 — decisions and accounts (Mohammad)

1. **Decide H4:** keep background location (prepare the video) or ship v1 foreground-only. My recommendation for a fastest first approval: foreground-only v1 if testing confirms expo-location works that way; otherwise keep it with a strong video.
2. Get domain hosting for `jovops.com` and a support mailbox (B1/B3). Confirm the operator legal name for the policy.
3. Set `EXPO_PUBLIC_API_URL` in the EAS production environment; fix the local `.env.production` (B5).
4. Create the Firebase project for `com.jovo.app` (H3).
5. Khaldoun: export the live catalogue and remove or deactivate tobacco/vape/alcohol (H6). Start the image provenance list (M5).

### Day 2 — legal pages and in-app links (Claude Code + Mohammad approval)

6. New JOVO privacy policy and terms, in Arabic and English (B1). Publish `/privacy`, `/terms`, `/delete-account`, `/support` (B3).
7. In-app links in Settings, Login and Signup, plus the signup consent line (B2).
8. Hide `DeveloperApiLabel` outside `__DEV__` (H5). Set OTA `fallbackToCacheTimeout: 0` (M1). Remove `expo-camera` (L1).

### Day 3 — deletion and roles (Claude Code, Codex review)

9. Deletion for driver and store staff, plus wording that doesn't say "deactivate", plus clearing driver location (H1).
10. Remove the restaurant browsing entry and registration screens from the v1 binary, or document them (H7).
11. API deny-list for tobacco/alcohol categories and products (H6).

### Day 4 — permissions, strings, push (Claude Code)

12. Accurate location purpose strings and iOS `locales` (ar/en); stop or disclose driver location when there is no delivery (H8).
13. Firebase / `google-services.json` plus the Gradle plugin; verify push on a real Android device for a driver and store staff (H3).
14. `ios.privacyManifests` reasons (M6). Crash reporting (M2), then update §4 answers.
15. If H4 is foreground-only: remove `ACCESS_BACKGROUND_LOCATION` and test.

### Day 5 — reviewer kit and listing (Mohammad, Khaldoun, Claude Code)

16. Create the demo accounts and the assigned demo delivery; relax the back-off for demo phones (B6, M8). Set up the test-order handling process (M7).
17. New store listing in Arabic and English, with the background-location sentence (B4). Screenshots from a release build with demo data.
18. Record the background-location video if you kept it (B7).

### Day 6 — build and Play Console (Mohammad)

19. `eas build -p android --profile production` (AAB). Install it from the internal testing track and run a smoke test: first launch, guest flow or login, order, driver flow, push, deletion. Check the merged manifest (L5).
20. Fill in Play App content: privacy URL, App access (§3.2), Ads = No, Content rating, Target audience, Data safety (§4.1), Location and Foreground-service declarations plus video, News/Health = No.
21. Start the **closed test with ≥12 testers opted in** (aim for 15–20 to buffer opt-outs). The **14 consecutive days** start now; plan tester engagement and collect feedback for the "Apply for production" form (https://support.google.com/googleplay/android-developer/answer/14151465, fetched).

### Day 7 — iOS preparation (blocked by enrollment) and buffer

22. Guest browsing (H2) is the largest remaining code item. Start it now so it's in the iOS v1 and the Play production release.
23. When Apple enrollment clears: `eas build -p ios`, TestFlight internal, App Privacy (§4.2), age rating, review notes (§3.2), screenshots, support URL, then submit.

### After the week

- Day ~20: apply for Play production (closed test complete).
- Fix any declaration feedback.
- Ship the iOS build once enrollment is approved.

---

## 6) What could not be verified, and why

| Item | Why not verified | How to verify |
|---|---|---|
| EAS `production` environment variables (`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_GEOCODER_URL`) | Rule: don't touch EAS; values are secrets/config held in the cloud | `eas env:list --environment production` (you, locally) |
| Production catalogue content (tobacco/alcohol/medicine, image use) and the full ~1,820-product file | Rule: no production calls except health; the product file is prepared elsewhere | Admin export / Khaldoun's file |
| Product image provenance and licensing | No source metadata in the repo | Supplier records |
| Final merged Android manifest permissions | No build output present; building would write files | `bundletool dump manifest` on the first AAB |
| iOS build, privacy manifest aggregation, Info.plist, launch screen | No `ios/` folder; Apple enrollment pending | First EAS iOS build plus TestFlight |
| Apple privacy-manifest documentation page | WebFetch returned only the page title (JavaScript-rendered) | Read in a browser: https://developer.apple.com/documentation/bundleresources/privacy-manifest-files |
| Google Play User Data policy page (answer/10144311) and IP/Metadata policy pages | Not fetched in this session (time budget); the related findings rely on the fetched background-location, Data safety, account deletion and Restricted Content pages | https://support.google.com/googleplay/android-developer/answer/10144311 |
| Apple age-rating questionnaire wording (2026) | Only third-party summaries and Apple news found via search; App Store Connect not accessible | App Store Connect when enrolled |
| Esri World Imagery licence terms | Only an Esri community answer was found; the official ToS was not fetched | arcgis.com item page Terms of Use |
| Whether expo-location background task updates work with only foreground permission plus a foreground service (H4 option b) | Needs a device test | Prototype on Android 14+ |
| Whether catalogue endpoints allow unauthenticated reads (guest browsing effort, H2) | Not traced in detail | Check the guards on the catalogue controllers |
| Firebase/FCM credentials in EAS | Cloud account | EAS credentials page |
| Account-level items (Google identity verification, payment-profile name match, developer account ownership, Apple ID/enrollment documents) | Account-level, outside the repo | Store consoles (D-U-N-S is **not** needed for individual accounts) |
| Exact App Store screenshot sizes and Play feature-graphic specs today | Not fetched | Console help pages |

**Assumptions made (I ran autonomously):**
- (a) A GET to the public marketing domain `jovops.com` was treated as allowed. It is not the production API, and it only checked existence.
- (b) "Store staff" = the `RESTAURANT` role scoped to JOVO MARKET.
- (c) Drivers and staff count as "accounts created in the app" for deletion purposes, because an admin creates them inside the same app. That is the conservative reading.
- (d) Probabilities assume the closed test itself passes review; "rejection" includes a declaration rejection.

**Account-level blockers (listed, not solved):**
- Google identity verification complete?
- Payment-profile legal name matches the developer name?
- Developer email and phone verified?
- Personal-account closed test 12 testers × 14 days.
- Apple enrollment approval with a valid government ID.
- Developer/seller name shown on the store must match the policy's operator name.
- Support email and website required by both stores.
- D-U-N-S not required for individual accounts.

**Policy sources fetched in this session:**
- Apple App Review Guidelines (Last Updated October 16, 2026): https://developer.apple.com/app-store/review/guidelines/
- Apple account deletion: https://developer.apple.com/support/offering-account-deletion-in-your-app/
- App Store Connect app privacy: https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/
- Play background location: https://support.google.com/googleplay/android-developer/answer/9799150
- Play account deletion: https://support.google.com/googleplay/android-developer/answer/13327111
- Play target API: https://support.google.com/googleplay/android-developer/answer/11926878
- Play testing requirements for personal accounts: https://support.google.com/googleplay/android-developer/answer/14151465
- Play foreground service: https://support.google.com/googleplay/android-developer/answer/13392821
- Play Restricted Content: https://support.google.com/googleplay/android-developer/answer/9878810
- Play Data safety: https://support.google.com/googleplay/android-developer/answer/10787469
- Play App access: https://support.google.com/googleplay/android-developer/answer/9859455
- Play Permissions: https://support.google.com/googleplay/android-developer/answer/9888170
- Play Payments: https://support.google.com/googleplay/android-developer/answer/9858738
- OSMF Nominatim policy: https://operations.osmfoundation.org/policies/nominatim/
- Expo Apple privacy guide (via search): https://docs.expo.dev/guides/apple-privacy/

---

## ملخص عربي

### الحكم لكل متجر
- **Google Play:** غير جاهز اليوم. احتمال الرفض أو التعطّل عند أول تقديم بين 85 و95٪. بعد إصلاح البنود الحرجة (BLOCKER) يصبح 35–50٪، وبعد إصلاح الحرجة والعالية معًا 15–25٪.
- **App Store:** محجوب حتى تتم الموافقة على حساب المطوّر. بعدها يكون الاحتمال اليوم 90–97٪، وبعد إصلاح البنود الحرجة 40–55٪، وبعد إصلاح الحرجة والعالية 15–30٪.
- هذه تقديرات شخصية مبنية على مراجعة الكود والسياسات، وليست بيانات مقاسة.

### أهم الموانع
1. لا يوجد رابط عام لسياسة الخصوصية، والمسودة الحالية تذكر TasawaQ والمطاعم. ولا يوجد رابط للسياسة داخل التطبيق.
2. لا توجد صفحة ويب لحذف الحساب، ولا رابط دعم أو بريد دعم.
3. لا توجد حسابات تجريبية للمراجعين، والتسجيل يتطلب رقمًا فلسطينيًا أو إسرائيليًا ورمز SMS.
4. وصف المتجر ما زال لتطبيق مطاعم باسم TasawaQ.
5. تصريحات الموقع في الخلفية والفيديو لم تُنجز بعد في Play Console.
6. رابط الـAPI في ملف ‎.env.production‎ المحلي يشير إلى ngrok، ومتغيرات EAS لم يتم التحقق منها. التطبيق يتوقف عند الإقلاع إذا كان الرابط خاطئًا.

### أهم البنود العالية
- حذف الحساب متاح للزبائن فقط، ونص التأكيد يوحي بأنه "تعطيل" لا حذف.
- لا يمكن تصفح المتجر بدون تسجيل دخول (مخاطرة مع Apple وفق البند 5.1.1).
- لا يوجد ملف Firebase، فإشعارات السائقين والموظفين على أندرويد لا تعمل غالبًا.
- عبارة "Development API" تظهر على شاشة الدخول في نسخة الإنتاج.
- لا يوجد حاجز برمجي يمنع منتجات التبغ، وكتالوج الإنتاج لم يُفحص.
- أدوار السائق والموظف والإدارة، وميزة المطاعم المخفية بمفتاح من الخادم، غير موثّقة للمراجعين.
- نصوص أذونات الموقع غير دقيقة بالنسبة للسائق، وهي بالإنجليزية فقط.

### خطة الأسبوع باختصار
- **اليوم الأول:** القرارات والحسابات: الموقع في الخلفية، الدومين، متغيرات EAS، مشروع Firebase، تنظيف الكتالوج من التبغ.
- **اليوم الثاني:** سياسة الخصوصية والشروط وصفحة الحذف وروابطها داخل التطبيق.
- **اليوم الثالث:** حذف الحساب لكل الأدوار، وإزالة بقايا المطاعم، وحاجز التبغ في الخادم.
- **اليوم الرابع:** نصوص الأذونات بالعربية والإنجليزية، والإشعارات، وملف الخصوصية لـiOS، وتقارير الأعطال.
- **اليوم الخامس:** الحسابات التجريبية، وملاحظات المراجعة، ووصف المتجر، والصور، والفيديو.
- **اليوم السادس:** بناء AAB، وتعبئة نماذج Play، وبدء الاختبار المغلق مع 12 مختبِرًا على الأقل لمدة 14 يومًا متتالية.
- **اليوم السابع:** البدء بالتصفح بدون تسجيل، والتحضير لنسخة iOS بعد الموافقة على الحساب.

### ما لم يمكن التحقق منه
- متغيرات بيئة EAS.
- محتوى كتالوج الإنتاج ومصدر الصور.
- ملف أذونات أندرويد النهائي بعد البناء.
- بناء iOS.
- صفحة Apple الخاصة بملف الخصوصية.
- بعض صفحات سياسات Google.
- شروط ترخيص Esri.

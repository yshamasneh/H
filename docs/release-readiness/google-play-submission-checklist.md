# Google Play submission checklist — JOVO (`com.jovo.app`)

Legend: ✅ done in the repo on `store-remediation-1` · ⬜ owner action · ⚠ open risk.

**Policy pages behind these items (fetched 2026-10-31)**

- Target API: https://support.google.com/googleplay/android-developer/answer/11926878
- Testing for new personal accounts: https://support.google.com/googleplay/android-developer/answer/14151465
- Background location: https://support.google.com/googleplay/android-developer/answer/9799150
- Foreground service types: https://support.google.com/googleplay/android-developer/answer/13392821
- Account deletion: https://support.google.com/googleplay/android-developer/answer/13327111
- Data safety: https://support.google.com/googleplay/android-developer/answer/10787469
- Restricted content: https://support.google.com/googleplay/android-developer/answer/9878810
- Payments: https://support.google.com/googleplay/android-developer/answer/9858738
- App access: https://support.google.com/googleplay/android-developer/answer/9859455

## Account

- ⬜ Identity verification complete; the payment-profile legal name matches the developer name shown on the listing.
- ⬜ Developer email and phone verified.
- ⬜ A personal account created after 13 Nov 2023 must run a **closed test with ≥ 12 testers opted in for 14 consecutive days**, then **Apply for production**. Recruit 15–20 testers to buffer opt-outs.

## Build

- ✅ targetSdk 36 / compileSdk 36 / minSdk 24 (RN 0.81 defaults; none are overridden). Play requires API 36 for new apps from 31 Aug 2026.
- ✅ `arm64-v8a` and `x86_64` are included.
- ✅ The package `com.jovo.app` is consistent across `app.json`, Gradle and Kotlin (native-config check passes).
- ✅ Release builds can only target `https://api.jovops.com`:
  - the startup guard in `apps/mobile/src/core/api-url.ts`;
  - the `eas-build-pre-install` guard in `apps/mobile/scripts/check-release-env.cjs`.
- ⬜ Set `EXPO_PUBLIC_API_URL=https://api.jovops.com` in the EAS **production** environment. Otherwise the build now fails on purpose.
- ⬜ Run `npm install` once in the repo root, after `expo-camera` was removed from `apps/mobile/package.json`, and commit the lockfile.
- ⬜ Run `eas build -p android --profile production` (AAB) and enrol in **Play App Signing** on the first upload.
- ⚠ Not run in this session: a local release build. The local NDK `27.1.12297006` folder is empty. To repair it: Android Studio → SDK Manager → NDK 27.1.12297006 → reinstall.

## Policy

- ✅ Privacy policy, terms, delete-account and support pages are written (`docs/store/`, `docs/store/site/`).
  - ⬜ Fill every `[[PLACEHOLDER]]`, get a legal review, and host the pages at `https://jovops.com/{privacy,terms,delete-account,support}`. The pages are `*.html`, so configure clean URLs or redirects.
- ✅ The app links the privacy policy and terms from Login, Signup (with consent) and Settings for all roles.
- ✅ In-app account deletion for customers, drivers and store staff.
  - ✅ The database constraint bug that broke every deletion is fixed by a new migration.
  - ⬜ Deploy the API, and run both new migrations.
- ✅ The background-location disclosure matches the real behaviour (disclosure version 2).
- ⬜ Record the declaration video (script in `docs/store/play-console-declarations.md`).
- ✅ ACCESS_BACKGROUND_LOCATION is kept. ⚠ It gets a manual review: see the H4 alternative.
- ✅ Tobacco, nicotine, vape and alcohol are blocked at product and category creation and at import.
  - ⬜ Khaldoun runs `npx tsx scripts/restricted-catalogue-report.ts --file <live export>.csv` and deactivates every BLOCKED row in production.
- ✅ Payments: cash on delivery, physical goods, so Play Billing is not required.
- ✅ No restaurant features or copy remain in the v1 app, and there is no "coming soon".

## Play Console → App content

- ⬜ Privacy policy URL.
- ⬜ App access: demo accounts and notes from `reviewer-access-guide.md`.
- ⬜ Ads: No.
- ⬜ Content rating (IARC): answer as in `play-console-declarations.md` §4.
- ⬜ Target audience: 18+.
- ⬜ Data safety: from `docs/store/data-safety-and-app-privacy.md`, with deletion URL `https://jovops.com/delete-account`.
- ⬜ Location permissions declaration and foreground service (location) declaration, both with the video.
- ⬜ News, health, financial features and government: No.

## Store listing

- ✅ Text: `docs/store/store-listing.md`, Arabic default and English.
- ⬜ Screenshots from a release build signed in with the demo accounts.
- ⬜ 1024×500 feature graphic.
- ⬜ App icon 512×512 (export it from `apps/mobile/assets/store/app-icon-1024.png`).

## Functional

- ⚠ Android push needs Firebase / FCM (`technical-analyses.md` H3). Without it, drivers and store staff get no push alerts.
- ⬜ Smoke-test the internal track: first launch, sign-in, browse, order, driver flow with background tracking, push, account deletion for each role, and the privacy and terms links.

# Apple App Store submission checklist — JOVO (`com.jovo.app`)

Legend: ✅ done in the repo on `store-remediation-1` · ⬜ owner action · ⚠ open risk · ⛔ blocked.

**Status: ⛔ BLOCKED.** Apple Developer enrollment is not yet approved, and the repo has no `ios/` folder. No iOS build has ever been produced or tested.

**Policy pages behind these items (fetched 2026-10-31)**

- App Review Guidelines (last updated 16 Oct 2026): https://developer.apple.com/app-store/review/guidelines/
- Account deletion: https://developer.apple.com/support/offering-account-deletion-in-your-app/
- App privacy details: https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/
- Privacy manifests: the Apple documentation page did not render (UNVERIFIED). The Expo guide was used instead: https://docs.expo.dev/guides/apple-privacy/

## Account

- ⛔ Enrollment approved, using a valid government ID. The seller name must match the operator name in the privacy policy.
- ⬜ Create the App Store Connect record: bundle id `com.jovo.app`, primary language Arabic.

## Build

- ✅ `ITSAppUsesNonExemptEncryption: false` (HTTPS only).
- ✅ `ios.privacyManifests`: UserDefaults (CA92.1, 1C8F.1), FileTimestamp (C617.1, 0A2A.1, 3B52.1), SystemBootTime (35F9.1) and DiskSpace (E174.1, 85F4.1). These were aggregated from every dependency `PrivacyInfo.xcprivacy` in `node_modules`. `NSPrivacyTracking` is false.
- ✅ Arabic and English permission prompts via `app.json` `locales` (`apps/mobile/native-locales/{ar,en}.json`).
- ✅ The location strings describe the customer pin and the driver's dispatch use accurately.
- ✅ Release builds can only target `https://api.jovops.com`.
- ⬜ Run `eas build -p ios --profile production`, then TestFlight internal testing. Watch for ITMS-91053 (missing required-reason) emails and add any reasons they list.
- ⬜ iPhone only (`supportsTablet: false`); the minimum iOS version is the Expo SDK 54 default.

## Guidelines

- ✅ 5.1.1(i): privacy policy link inside the app (Login, Signup, Settings). ⬜ Host the page and enter the URL in App Store Connect.
- ✅ 5.1.1(v): in-app deletion for every self-service role. It is real anonymisation, not deactivation, and the copy no longer says "deactivate".
  - Administrators are closed by a second administrator; the store owner is closed by an administrator.
- ⚠ 5.1.1(v): **login is required before browsing.** Guest browsing is analysed (`technical-analyses.md` H2, about 1.5–2 days, no API change), but **not implemented**. This is the most likely Apple-specific rejection.
- ✅ 2.5.19 / 2.3.1: restaurant browsing, restaurant registration and the server-flag-driven restaurant entry are removed from the app.
  - ⬜ Describe the driver, store-staff and admin areas in the Review Notes (text in `reviewer-access-guide.md`).
- ✅ 2.1: the "Development API" label is gone from release builds, and the OTA launch wait is 0.
  - ⬜ Provide demo accounts.
- ✅ 1.4.3: tobacco and alcohol are blocked at creation and import. ⬜ Clean the live catalogue.
- ✅ 3.1.3(e): cash on delivery for physical goods, so no in-app purchase is required.
- ✅ 4.8: no third-party login, so Sign in with Apple is not applicable.
- ✅ App Tracking Transparency: not applicable (no tracking).
- ⚠ 5.2: map tiles (Esri) and product-image provenance (M3, M5) are open.
- ⚠ 2.5.4: background location for drivers is declared via the `UIBackgroundModes` location mode (expo-location plugin). The review notes explain the driver flow. Expect the reviewer to test it with the demo driver account.

## App Store Connect

- ⬜ App Privacy: from `docs/store/data-safety-and-app-privacy.md`.
- ⬜ Age rating questionnaire, including the September 2026 social-media questions: everything "None" or "No", expected 4+.
- ⬜ Support URL `https://jovops.com/support`, marketing URL (optional), and the privacy policy URL.
- ⬜ Screenshots: the 6.9-inch iPhone set in Arabic and English (UNVERIFIED exact sizes).
- ⬜ Review Notes and demo accounts from `reviewer-access-guide.md`.

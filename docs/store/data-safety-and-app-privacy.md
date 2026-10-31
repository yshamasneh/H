# Google Play Data safety and Apple App Privacy answers

These answers are derived from the code on branch `store-remediation-2` (re-checked in run 2); see `docs/release-readiness/privacy-data-inventory.md` for the evidence behind each line.

**Changes from audit §4**

- Email is added as optional (customers can add it in Account, `features/customer/account-screen.tsx:146`).
- Crash and diagnostics data is **not collected as shipped**: run 2 added a vendor-neutral reporter that stays off unless `EXPO_PUBLIC_ERROR_REPORT_URL` is set at build time. **The build that sets it must ship with these answers changed** (Google: App info and performance → Crash logs = collected, not shared, processed ephemerally: no, collection required (users cannot turn it off), purpose App functionality. Apple: Diagnostics → Crash Data, not linked to the user, not used for tracking).
- Run 2: guests can browse without an account (no data collected for them). Reverse geocoding now goes through the JOVO API: the chosen map point (already declared as precise location) reaches Nominatim from the server, not the device. No answer changes.
- Payment info is confirmed as not collected.

**Policy sources (fetched 2026-10-31)**

- Data safety: https://support.google.com/googleplay/android-developer/answer/10787469. Collection means data transmitted off the device, including by SDKs. Transfers to service providers are not "sharing". Data handled only ephemerally may be excluded.
- Apple App Privacy: https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/. The answers must include third-party partners' practices, and a privacy policy URL is required.

> **If you change the app, change these answers too.** In particular, adding crash reporting (M2) adds "Crash logs / Diagnostics" (Google) and "Crash Data / Performance Data" (Apple).

## Google Play: Data safety form

**Overview questions**

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | Yes |
| Is all of the user data collected by your app encrypted in transit? | Yes (HTTPS only; release builds refuse anything else, `apps/mobile/src/core/api-url.ts`) |
| Which ways can users request their data be deleted? | In-app deletion, plus the web link https://jovops.com/delete-account |
| Shared with third parties? | **No** for every type. Railway, Cloudflare, Backblaze, TweetSMS, Expo/FCM/APNs, Nominatim, map tiles and Vercel are service providers. Showing the address to the assigned driver is part of JOVO's own service. |

**Data types collected**

| Category → data type | Collected | Required? | Purposes | Ephemeral? |
|---|---|---|---|---|
| Location → Precise location | Yes | Optional (customers can type an address without locating; drivers can decline background) | App functionality | No |
| Location → Approximate location | Yes (the coarse permission is requested alongside fine) | Optional | App functionality | No |
| Personal info → Name | Yes | Required | App functionality, Account management | No |
| Personal info → Email address | Yes | Optional | Account management | No |
| Personal info → User IDs | Yes | Required | App functionality, Account management | No |
| Personal info → Address | Yes | Required to place an order | App functionality | No |
| Personal info → Phone number | Yes | Required | App functionality, Account management, Fraud prevention, security and compliance | No |
| Financial info → Purchase history | Yes | Required to order | App functionality | No |
| Financial info → payment info, credit score, other | No | — | — | — |
| Photos and videos → Photos | Yes (store staff and administrators only, product photos) | Optional | App functionality | No |
| App activity → Other user-generated content | Yes (order notes) | Optional | App functionality | No |
| App activity → Other actions | Yes (driver shift and app open/background state) | Required for drivers | App functionality | No |
| App activity → App interactions, in-app search history | No (searches are sent to the API to return results but are not stored; the request log keeps the path only) | — | — | Yes |
| Device or other IDs | Yes (push-notification token) | Optional | App functionality | No |
| App info and performance → Crash logs, Diagnostics | **No** while `EXPO_PUBLIC_ERROR_REPORT_URL` is unset (run 2 reporter is off by default); **Yes, not shared** once it is set | — | — | — |
| Messages, Contacts, Calendar, Health, Fitness, Audio, Files and docs, Web browsing | No | — | — | — |

## Apple: App Privacy ("nutrition label")

**Tracking:** No (`NSPrivacyTracking` is false in `app.json`; there is no IDFA and no ad or analytics SDK). No App Tracking Transparency prompt is needed.

**Data Linked to You** (purpose for every row: **App Functionality**)

| Apple category | Data type | Notes |
|---|---|---|
| Contact Info | Name | |
| Contact Info | Email Address | Optional |
| Contact Info | Phone Number | |
| Contact Info | Physical Address | Delivery addresses |
| Location | Precise Location | Customer pin; driver delivery tracking |
| Location | Coarse Location | |
| User Content | Photos or Videos | Staff product photos |
| User Content | Other User Content | Order notes |
| Identifiers | User ID | |
| Identifiers | Device ID | Push token |
| Purchases | Purchase History | Cash orders |
| Usage Data | Product Interaction | Driver shift and app state; declare to be safe |

**Not collected:** Health & Fitness, Financial Info, Sensitive Info, Contacts, Browsing History, Search History, Emails or Text Messages, Audio Data, Gameplay Content, Customer Support, Diagnostics (until M2), Other Data.

**Other App Store Connect answers**

- **Privacy policy URL:** https://jovops.com/privacy (B1).
- **Privacy choices URL (optional):** https://jovops.com/delete-account.
- **Age rating:**
  - "None" for every content category, including tobacco, alcohol and drug references. Answer that only after the live catalogue check (H6) is clean.
  - Unrestricted web access: No.
  - User-generated content or social feed (the September 2026 questions): No.
  - Gambling: No.
  - Expected rating: 4+. UNVERIFIED: the questionnaire wording was not fetched from App Store Connect.
- **Export compliance:** `ITSAppUsesNonExemptEncryption = false` (HTTPS only).
- **Sign in with Apple:** not applicable. Login is phone and password, with no third-party sign-in (Guideline 4.8).

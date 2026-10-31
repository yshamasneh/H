# Technical analyses — store remediation run 1 (analysed, not implemented)

<a id="h2"></a>
## H2 — Guest browsing (Apple 5.1.1(v))

**Policy.** https://developer.apple.com/app-store/review/guidelines/, fetched 2026-10-31: "If your app doesn't include significant account-based features, let people use it without a login." A grocery catalogue is not account-based, so a login wall is a likely Apple rejection. It is not a Google Play policy issue.

**Current state (CONFIRMED)**

- The app starts on login: `apps/mobile/src/navigation/navigation.ts:92`, `initialScreen = { name: "login" }`.
- Every customer screen type carries `user: PublicUser`.

**Which catalogue endpoints need a token**

| Endpoint | Used by | Token? | Evidence |
|---|---|---|---|
| `GET /supermarkets` | `resolveMarketStore` | No | `apps/api/src/restaurants/supermarkets.controller.ts:11-15` |
| `GET /supermarkets/:id/status` | store open or closed | No | `supermarkets.controller.ts:17-21` |
| `GET /supermarkets/:id/catalog` | home, catalogue, search | No | `supermarkets.controller.ts:23-30` |
| `GET /supermarkets/:id/products/:pid` | product page | No | `supermarkets.controller.ts:32-39` |
| `GET /restaurants/offers/active` | home offers | No | `restaurants.controller.ts:29` |
| `GET /settings` (substitution option) | checkout | **Yes** | `settings.controller.ts:14` |
| `GET /landmarks` | address map | **Yes** | `landmarks.controller.ts:14` |
| Notifications, orders, addresses, quote and checkout | account features | **Yes** (and they should stay so) | — |

So **no API change is needed** for browsing. The work is in the app.

**Smallest safe design**

1. Add a guest home route: `{ name: "home"; user: PublicUser | null }`. A simpler alternative is a separate `guest-home` route that renders `CustomerHomeScreen` with `user = null`.
2. Make `CustomerHomeScreen`, the catalogue and the product page tolerate `user == null`. The calls that need a token (unread count, buy-again, recently viewed) are already wrapped and skipped when `getAccessToken()` is null (`home-screen.tsx` `accountRequests`).
3. Let the cart work locally for guests (`cart-storage` is device-local). **Checkout, orders, notifications, account and the address book require login:** tapping them opens the login screen with a "sign in to order" notice, then returns to the cart.
4. Add a "Browse without an account" link on the login screen, plus "Sign in" in the guest tab bar.
5. Keep the delivery-area message visible to guests: a static line with [[PLACEHOLDER: town / radius]] on the home screen.

**Effort:** about 1.5–2 developer days in the app, 0 in the API. UI tests and the review are included.

**Tests needed**

- UI: the login screen offers guest browsing; guest home renders the catalogue with no token calls.
- UI: guest product page add-to-cart works; checkout redirects to login and comes back to the cart after login.
- Unit: navigation guards map every authenticated route to login when `user` is null.
- Regression: the home-screen tests still pass for a signed-in customer.

<a id="h3"></a>
## H3 — Firebase / FCM for Android push

**Evidence (CONFIRMED)**

- There is no `google-services.json` anywhere outside `node_modules`.
- There is no `android.googleServicesFile` in the resolved Expo config.
- The checked-in Gradle files have no `com.google.gms.google-services` plugin.
- `core/push-notifications.ts:44` calls `Notifications.getExpoPushTokenAsync`, which on Android depends on FCM.

**Source:** Expo FCM V1 guide, https://docs.expo.dev/push-notifications/fcm-credentials/, fetched 2026-10-31.

**Owner steps**

These involve credentials, so the owner does them; Claude must not.

1. In the Firebase console, create (or reuse) a project, add an Android app with the package **`com.jovo.app`**, and download `google-services.json`.
2. Firebase → Project settings → Service accounts → **Generate new private key**. Keep this JSON private and never commit it.
3. Upload the key to EAS: run `eas credentials`, then choose Android → production → Google Service Account → FCM V1 → upload. Alternatively use expo.dev → Credentials → FCM V1 service account key.
4. If the API key in `google-services.json` is restricted in Google Cloud, allow the *FCM Registration API* and *Firebase Installations API*. For an application restriction, use the **Play App Signing key SHA-1** (Play Console → App integrity), not the upload key.

**Repository changes (a small follow-up run, after step 1)**

- Put `google-services.json` at `apps/mobile/google-services.json` and set `"android": { "googleServicesFile": "./google-services.json" }` in `app.json`.
  - Expo's guide says the file *can* be committed: it holds public client identifiers, not the service-account key.
  - Your rules say not to print its private fields, so commit it without displaying it, or keep it in EAS as a file secret (`eas env:create --type file`).
- Because `android/` is hand-maintained (not prebuilt), also:
  - `android/build.gradle` → `classpath('com.google.gms:google-services:4.4.2')`. UNVERIFIED: pin the current version from the Firebase docs at that time.
  - `android/app/build.gradle` → `apply plugin: 'com.google.gms.google-services'`.
  - Copy `google-services.json` to `android/app/google-services.json`.
- Extend `scripts/check-native-config.cjs` to assert all three.

**Test plan**

1. Install the internal-track build on a real Android 13+ device and sign in as a driver.
2. Settings → notifications toggle → the system `POST_NOTIFICATIONS` prompt appears → allow it.
3. Check the API has the token: `PushToken` row, `platform=android`, `appVersion` set.
4. Create a delivery from the store demo account: the driver phone gets "delivery available" with the delivery alert sound on its channel. Repeat with the app killed.
5. Store staff: new order produces a push with the store order sound.
6. Customer: an order status change produces a push.
7. Token rotation: reinstall the app and confirm the old token row is replaced (`users.service.ts` upsert).

<a id="h4"></a>
## H4 — Foreground-service-only driver tracking (no `ACCESS_BACKGROUND_LOCATION`)

**Question.** Can driver tracking keep working while the driver uses an external navigation app, using only a location foreground service and no background location permission?

**Official sources (fetched 2026-10-31)**

- Android, foreground service types → location (https://developer.android.com/develop/background-work/services/fgs/service-types). Runtime prerequisites are location services on plus `ACCESS_COARSE_LOCATION` **or** `ACCESS_FINE_LOCATION`. "You cannot create a `location` foreground service while your app is in the background, unless you've been granted the `ACCESS_BACKGROUND_LOCATION` runtime permission."
- Android, background start restrictions (https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start). With a while-in-use permission, "you must call `Context.startForegroundService()` … while your app has a visible activity". On Android 14+ a background-created location foreground service throws `SecurityException`.
- Expo Location docs (https://docs.expo.dev/versions/latest/sdk/location/). The foreground service is for "access location while the app is open but backgrounded"; `ACCESS_BACKGROUND_LOCATION` is "to be able to access location while the app is backgrounded or closed".
- **Installed expo-location 19.0.8 source** (`node_modules/expo-location/android/src/main/java/expo/modules/location/LocationModule.kt:246-264`):
  > "2. As a user-initiated foreground service with notification, this does NOT require the background location permission."

  It throws only if the app is not in the foreground when the service is started (`ForegroundServiceStartNotAllowedException`).

**Conclusion (LIKELY, needs the device test below).** Yes, if the service is started while JOVO is visible, it keeps running when the driver switches to Google Maps, and Android does not need `ACCESS_BACKGROUND_LOCATION`. JOVO's trigger already fits, because tracking starts from the delivery screen when a delivery becomes active.

**Limits**

1. If Android kills the JOVO process while the driver is in another app, the service cannot be re-created from the background (Android 14+). Tracking resumes only when the driver reopens JOVO.
2. If a delivery becomes active *while JOVO is in the background* (for example a push-triggered assignment), the service cannot start until the driver opens JOVO.

**Required code change (a later run, not done):**

- `apps/mobile/src/core/background-location.ts:58-60` refuses to start unless *background* permission is granted. It must accept foreground permission when using `foregroundService`.
- `use-background-location.tsx` must request only foreground permission, with the disclosure reworded.
- `app.json` would set `isAndroidBackgroundLocationEnabled: false` and remove `ACCESS_BACKGROUND_LOCATION`; the Android manifest and the native-config check change to match.
- The Play location-permission declaration would no longer be needed, but the foreground-service (location) declaration and video still would be.

**Device test that must pass before switching**

Use a real Android 14 or 15 device and a build with only foreground location.

1. Sign in as the demo driver with location permission set to "While using the app".
2. Open an assigned delivery and start it. The JOVO foreground notification appears.
3. Open Google Maps navigation and drive or walk for 10 minutes with the screen on, then 5 minutes with the screen off.
4. **Pass if** admin sees driver position updates at least every 30 s throughout, and logcat never shows "Foreground service started from background can not have location … access".
5. Force-stop JOVO from recents while navigating. Expected: updates stop. Reopen JOVO and confirm they resume within 30 s.
6. Repeat on an Android 11 or 12 device.

<a id="m2"></a>
## M2 — Crash reporting

**Current state.** None in the app. The `ErrorBoundary` only logs to the console (`components/error-boundary.tsx:34-37`). The server already requires `ERROR_TRACKING_WEBHOOK_URL` in production (`environment.ts:119-132`).

**Options**

1. **Sentry for React Native** (`@sentry/react-native` plus its Expo config plugin), source maps uploaded during EAS build.
2. **Firebase Crashlytics** (`@react-native-firebase/crashlytics`). It pairs with H3's Firebase project, but adds native setup to the bare Android project.

**Recommendation: Sentry.** It is lighter to wire in Expo, and covers iOS and web.

**Steps**

1. The owner creates a Sentry project and stores the DSN and auth token as EAS secrets.
2. Install the package. This changes the lockfile, so the owner runs `npm install --workspace @wasel/mobile @sentry/react-native` (an UNVERIFIED version pin; pick the one Expo SDK 54 documents).
3. Initialise it in `index.ts` with `sendDefaultPii: false`; send no user name or phone, only the user id hash.
4. Report from `ErrorBoundary.componentDidCatch`.

**Privacy impact.** Declare "Crash logs" and "Diagnostics" (Google), and "Crash Data" and "Performance Data", not linked (Apple). Add Sentry to the privacy-policy processor list.

**Effort:** about 0.5 day plus the source-map pipeline.

<a id="m3"></a>
## M3 — Map tile licensing

**Current state.**

- Android and web use Esri ArcGIS World Imagery and Reference tiles directly from `server.arcgisonline.com` (`components/location-map.android.tsx:41-43`, `location-map.web.tsx:137-141`).
- iOS uses Apple Maps through `react-native-maps` (`location-map.ios.tsx`).

**Risk.** An Esri staff answer (Dec 2024, https://community.esri.com/t5/arcgis-location-platform-developers-ques/inquiry-about-world-imagery/m-p/1569266) says World Imagery needs an ArcGIS licence and is "not available for commercial use". Esri's own Terms of Use page was not fetched, so this is UNVERIFIED.

**Options**

1. **ArcGIS Location Platform** account and API key: keeps the same imagery, paid by usage.
2. **A commercial provider with a free tier and explicit commercial terms**, such as MapTiler or Stadia: vector or satellite tiles plus attribution, key stored as an EAS environment variable.
3. **Self-hosted OSM vector tiles** (for example Protomaps PMTiles on Cloudflare R2): no per-request cost and no imagery, with OSM attribution.

**Recommendation.** Option 2 or 3 for street maps, which help drivers more than satellite imagery does. Keep the attribution visible. Update the privacy-policy processor list.

**Code change.** Swap the tile URLs in the Android and web map components behind one constant. Add an attribution string. Satellite imagery is optional.

<a id="m4"></a>
## M4 — Nominatim usage and a server-side geocoding proxy

**Current state.** The app calls `https://nominatim.openstreetmap.org/reverse` directly from each device, with only an `Accept` header (`core/geocode.ts:22,95`). The native geocoder is tried first and Nominatim is the fallback.

**Policy.** https://operations.osmfoundation.org/policies/nominatim/, fetched 2026-10-31. It requires an application-identifying User-Agent or Referer ("stock User-Agents … will not do"), allows at most 1 request per second per application, says periodic app requests are "strongly discouraged", and asks apps to use a caching proxy.

**Proxy design**

- `GET /api/v1/geocode/reverse?lat=&lng=&lang=` behind `JwtAuthGuard`. Guests are not needed for the address pin.
- Round coordinates to 5 decimals (about 1 m, matching `geocodeCacheKey`).
- Look up an LRU or PostgreSQL cache table `GeocodeCache(key, language, line, createdAt)` with a 30-day TTL.
- On a miss, call Nominatim server-side with `User-Agent: JOVO/<version> (+https://jovops.com/support; [[PLACEHOLDER: contact email]])` and `Referer: https://jovops.com`.
- Use a global token bucket of 1 request per second, and return 429 with retry-after when exhausted. The app already falls back to showing the raw pin.
- Throttle per user at 30 per minute.
- Do not log coordinates (the logger already omits query strings: `request.middleware.ts:20`).
- Make the endpoint configurable (`GEOCODER_URL`) so a self-hosted Nominatim can replace the public one later.
- In the app, point `EXPO_PUBLIC_GEOCODER_URL` (already supported, `geocode.ts:24`) at the proxy and send the access token.

**Privacy.** Coordinates then reach OSM from JOVO's server, not from the user's device and IP. Update the processor wording.

**Effort:** about 1 day API plus 0.5 day app, with tests.

<a id="m5"></a>
## M5 — Product image provenance

This run does not touch `products/`. The licence-audit template is `docs/release-readiness/image-licence-audit-template.csv`, one row per image file.

**How to fill it**

1. Khaldoun fills `source_type` with one of:
   - `own_photo`
   - `supplier_media_kit`
   - `manufacturer_site`
   - `retailer_site`
   - `stock_library`
   - `ai_generated`
   - `unknown`
2. Fill `source_url_or_supplier`, `licence_or_permission` and `evidence_location` (an email, contract or folder).
3. The owner reviews every `retailer_site` and `unknown` row and decides to replace or keep it. Apple 5.2 requires content "you created or that you have a license to use".
4. `has_watermark_or_third_party_logo`: yes or no, for any watermark or a retailer's own logo. A manufacturer's brand printed on the product pack is normal.

<a id="h8-run2"></a>
## H4 / H8 — run 2 verification (location behaviour vs disclosure)

`ACCESS_BACKGROUND_LOCATION` is kept (owner instruction). Re-checked against the current code on `store-remediation-2`:

| Path | When it sends a position | Evidence |
|---|---|---|
| Background task (`expo-location` updates, OS task `deliveryTrackingTask`) | Only while the driver has an active delivery (ASSIGNED, PICKED_UP, ON_THE_WAY). The server answers each report with `hasActiveDelivery`; the reporter stops the task when it is false. | `apps/mobile/src/core/background-location.ts:42-80`, `src/core/tracking/tracking-reporter.ts`, `src/features/driver/screens.tsx:175` (`useDriverLocationTracking(hasActiveDelivery, …)`), `apps/api/src/drivers/drivers.service.ts` `updateOwnLocation` (returns `hasActiveDelivery`) |
| Foreground one-shot (`refreshLocation`) | Once when the driver home opens, on pull-to-refresh and when going online, **even with no delivery and even while offline**, only while the app is on screen. | `apps/mobile/src/features/driver/screens.tsx:117-126, 162-165, 187-190, 205-207` |
| Customer | Never in the background; only when the customer taps "locate me" on the address map. | privacy policy §2 |

**Verdict: the disclosure matches the behaviour.** The driver disclosure (`driver.json` → `tracking.disclosure.when`, disclosure version 2, Arabic and English), the privacy policy (Arabic line 35, English line 152) and the Play declaration text all describe the foreground one-shot report. No background collection happens without an active delivery. The code was not changed in this run: `driver/screens.tsx` may still hold the owner's local uncommitted change (run 1 note), and narrowing the one-shot report would change dispatch (who is "nearby"). Option kept for the owner (D3): guard `refreshLocation()` with `isOnline || hasActiveDelivery` and shorten the disclosure accordingly (bump `disclosureVersion` to 3).

**Device test that must pass before the Play submission (NOT run here: needs a real Android 13+ phone and a release-signed build)**

1. Install the closed-test build; sign in as an approved driver; go online; accept a delivery (use the demo driver and a demo order, see `reviewer-access-guide.md`).
2. Confirm the order: JOVO's prominent disclosure first, then the system foreground prompt, then "Allow all the time" (background) in system settings.
3. Start the delivery, then open Google Maps (or Waze) navigation and lock the screen for 5 minutes.
4. Expected: the persistent "JOVO is sharing your location for this delivery" notification stays visible; in the admin live map (or `DriverProfile.lastLocationAt`) the position updates about every 10 s while JOVO is not on screen.
5. Move the delivery out of the active states (an admin cancels the demo order). Expected: within one report the notification disappears and `lastLocationAt` stops changing.
6. With no delivery, put JOVO in the background for 5 minutes: `lastLocationAt` must not change.
7. Revoke background permission in system settings during a delivery: tracking continues only while JOVO is on screen, and the app explains how to re-enable it.
8. Record the screen for steps 2–4 (≤ 30 s) for the Play background-location video.

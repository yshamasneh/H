# Google Play Console declarations: background location and foreground service

`ACCESS_BACKGROUND_LOCATION` stays in v1 (owner decision for this run). This file holds the text to paste and the video plan. The technical alternative, foreground-service-only tracking, is analysed in `docs/release-readiness/technical-analyses.md#h4`.

**Sources (fetched 2026-10-31)**

- Background location: https://support.google.com/googleplay/android-developer/answer/9799150. It says to declare one feature only; the disclosure must come before the runtime prompt, must use the word "location", and must say it is used when the app is closed or not in use; the description must mention it; the video should be 30 seconds or less.
- Foreground service types: https://support.google.com/googleplay/android-developer/answer/13392821. For each type you give a functionality description, the user impact if it is deferred or interrupted, a video, and a use case.

## 1. App content → Sensitive app permissions → Location permissions

**Which feature needs background location?** (declare only this one feature)

> Live delivery tracking for JOVO drivers. While a driver has an active delivery (from accepting it until it is delivered, cancelled or failed), JOVO sends the driver's GPS position to JOVO dispatch about every 10 seconds, including when the driver switches to a navigation app or the screen is off. Dispatch uses it to see where each delivery is and to help if something goes wrong. It is never collected in the background when the driver has no active delivery, and it is never collected for customers.

**Why does it need background access rather than foreground only?**

> Drivers navigate with Google Maps during the trip, so JOVO is not on screen for most of the delivery. Without background access the position would stop updating the moment the driver opens navigation, which is exactly when dispatch needs it.

**In-app prominent disclosure** (shipped; `apps/mobile/src/components/background-location-disclosure.tsx`, copy in `src/i18n/locales/{en,ar}/driver.json` → `tracking.disclosure`)

- It is shown when a driver starts an active delivery, before the system prompt, with Continue / Not now.
- It states: what is collected (precise location about every 10 seconds); when (in the background only during an active delivery, plus a one-off position while the app is open on the driver home); why; who sees it; and how to stop it.
- Declining keeps the delivery working without background sharing.
- `disclosureVersion` is 2, so drivers who accepted version 1 see the corrected wording again.

**Store listing mention**: done in `docs/store/store-listing.md` (the "Location for drivers" paragraph, Arabic and English).

**Privacy policy**: `docs/store/privacy-policy.md` → "Drivers".

## 2. App content → Foreground service permissions

- **Type:** Location (`FOREGROUND_SERVICE_LOCATION`).
- **Use case:** the closest listed option to "navigation / ride or delivery tracking". UNVERIFIED: choose the exact label shown in the console.
- **Functionality description:**

  > During an active delivery, JOVO runs a location foreground service with a persistent "JOVO delivery in progress — Sharing your location with JOVO dispatch until this delivery is finished." notification, so the driver's position keeps reaching JOVO dispatch while they navigate with another app. It starts when the driver starts a delivery, and stops when the delivery is completed or cancelled, or the driver signs out.

- **Impact if deferred or interrupted:**

  > Dispatch would lose the driver's live position mid-delivery and could not see late or stuck deliveries or help the driver. The delivery itself can still be completed in the app; the position resumes when the driver reopens JOVO.

- **Video:** the same video as section 1 (step 5 shows the persistent notification).

## 3. Video script (record on a real Android device, release build, ≤ 30–45 s, one take)

1. 0–4 s: open JOVO and show the login. Sign in as the demo driver.
2. 4–8 s: the driver home shows the assigned demo delivery. Open it and tap the start or picked-up action.
3. 8–15 s: the **prominent disclosure** appears. Hold it on screen for at least 3 seconds so the "location", "background" and "only during an active delivery" lines are readable. Tap **Continue**.
4. 15–22 s: the system location prompt appears. Choose "While using the app". Android 11+ then opens Settings: choose **Allow all the time** and return to JOVO.
5. 22–30 s: press Home and open Google Maps navigation. Pull down the notification shade and show the persistent JOVO location notification.
6. 30–38 s: switch to the admin console (web or a second phone) and show the driver's pin updating while JOVO is in the background.
7. 38–45 s: return to JOVO, mark the delivery delivered, and show that the notification is gone (tracking has stopped).

Upload it unlisted (for example on YouTube) and paste the link in both declarations.

## 4. Other App content answers

| Form | Answer |
|---|---|
| Ads | No ads |
| App access | All or some functionality is restricted → add the instructions from `docs/release-readiness/reviewer-access-guide.md` |
| Content rating (IARC) | Shopping. No violence, sexuality, gambling or user-to-user communication. Tobacco/alcohol: none (only after the H6 catalogue check is clean). |
| Target audience | 18+ ([[PLACEHOLDER: minimum age]]). Not designed for children. |
| News app | No |
| Health app | No |
| Financial features | None |
| Government app | No |
| Data safety | `docs/store/data-safety-and-app-privacy.md` |
| Data deletion | Yes: in-app plus https://jovops.com/delete-account |

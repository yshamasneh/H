# Background location: store declarations and review notes

JOVO drivers share their location with JOVO dispatch **only while a delivery is active**, including while
the driver has handed the trip to a navigation app and JOVO is in the background. This is a sensitive
permission on both stores, so most of what review needs is written text, screenshots and a video that you
supply **in the store consoles**. This page lists exactly what is in the code, and exactly what you have
to fill in yourself.

## What is code, and what is console work

| Item | Where | Done in this repository? |
| --- | --- | --- |
| Android `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION` permissions | `app.json`, `android/.../AndroidManifest.xml` | Yes |
| Android foreground service that keeps location running, with a visible notification | `expo-location` service + `core/background-location.ts` | Yes |
| iOS `UIBackgroundModes: location` and the "Always" usage descriptions | `app.json` (`expo-location` plugin) | Yes (generated at `eas build`) |
| Prominent in-app disclosure **before** the system permission prompt, with Continue / Not now | `components/background-location-disclosure.tsx`, `features/driver/use-background-location.tsx` | Yes (English + Arabic) |
| Tracking only during an active delivery; stops on completion, cancellation, logout | `core/tracking/*` (tested) | Yes |
| Privacy policy wording | `docs/privacy-policy.md` | Draft updated; **you must publish it** at a public HTTPS URL |
| Play Console: Data safety form | Play Console | **You** (answers below) |
| Play Console: Location permissions declaration + video | Play Console | **You** (text below, video you record) |
| Play Console: Foreground service permissions declaration + video | Play Console | **You** |
| Play Console: App access (reviewer test account) | Play Console | **You** |
| App Store Connect: App Privacy answers, review notes | App Store Connect | **You** (answers below) |

Nothing in the console can be changed from code. A new native build (version `0.15.0`) is required before
any of this can be tested or submitted.

## What the app does, in review-friendly terms

- **What:** precise location (GPS), about every 10 seconds or 30 metres.
- **When:** only while the signed-in driver has an active delivery (accepted, picked up, or on the way).
  It is not collected when the driver has no delivery, and nothing is collected for customers, store
  owners or admins in the background.
- **Why:** so JOVO dispatch can see where a delivery is, help if something goes wrong, and keep customers'
  orders on track. Core to the delivery service.
- **Who sees it:** JOVO staff in the admin console. Not shown to customers, not sold, not shared for
  advertising.
- **How it stops:** the moment the delivery is completed or cancelled (the server tells the phone there is
  no active delivery, and the phone stops its own background task), on logout, and whenever the driver
  turns location off in system settings.
- **Visible while running:** on Android a persistent notification ("JOVO delivery in progress"); on iOS the
  system's blue location indicator.
- **Consent:** a full-screen disclosure appears first and the driver must choose **Continue** or
  **Not now**; the system permission prompt appears only after Continue. Declining is respected: the driver
  can still deliver, the in-app map still works while JOVO is open, and they are not asked again on every
  delivery. Wording changes bump a version so an old "accepted" is not carried across a material change.

## Google Play Console

### 1. App content → Data safety

Answer **Yes** to "Does your app collect or share any of the required user data types?", then:

| Data type | Collected | Shared | Optional? | Purpose |
| --- | --- | --- | --- | --- |
| Location → **Precise location** | Yes | **No** (only to JOVO's own servers, as a processor of its own service) | Users can choose whether it is collected (customers choose when to use it; drivers can decline background sharing) | App functionality |
| Personal info → Name, Phone number, Address | Yes | No | Required for an account and orders | App functionality, Account management |
| Financial info → Purchase history (orders) | Yes | No | Required | App functionality |
| App info and performance → Crash logs, Diagnostics | Yes | No | Required | Analytics / App functionality |
| Device or other IDs → Push notification token | Yes | No | Optional (notifications can be off) | App functionality |
| Photos (product/logo images uploaded by store owners) | Yes | No | Optional | App functionality |

Also answer: **Data is encrypted in transit: Yes.** **Users can request that data is deleted: Yes** (in-app
account deletion, and the privacy contact). Do **not** declare advertising IDs, contacts, microphone or
payment cards: none are collected. Precise location is **not** "ephemeral": it is stored as the driver's
last position.

### 2. App content → Sensitive app permissions → Location permissions (background)

Choose the location permission declaration and use this text (edit the app name if the store name differs):

> **Feature that requires background location:** Live delivery tracking for drivers. When a JOVO driver
> has an active delivery and switches to a navigation app to drive to the store or the customer, JOVO
> continues to share the driver's location with JOVO dispatch so the delivery stays visible and problems
> can be resolved.
>
> **Why foreground location is not enough:** drivers hand the trip to their navigation app for turn-by-turn
> directions, which sends JOVO to the background. Foreground-only access would stop reporting exactly when
> the driver is on the road.
>
> **Scope and safeguards:** location is collected only while a delivery is active and stops when it is
> completed or cancelled, or when the driver signs out. A prominent in-app disclosure is shown before the
> system permission prompt and the driver can decline and still deliver. A persistent notification is
> shown while location is collected. Data is visible only to JOVO staff and is not shared or sold.

**Video (required).** Record on a real device, ~30–60 seconds, showing in order: (1) signing in as a
driver and accepting a delivery, (2) the **full-screen disclosure** ("Share your location during
deliveries"), (3) tapping **Continue** and the system prompt / settings screen where "Allow all the time"
is chosen, (4) the delivery map, (5) pressing **Navigate** to open the navigation app while the "JOVO
delivery in progress" notification is visible, (6) completing the delivery and the notification
disappearing. Upload as an unlisted YouTube link.

### 3. App content → Foreground service permissions

Declare `FOREGROUND_SERVICE_LOCATION`: **Foreground service type: Location.** Use the same feature
description as above, and point to the same video (the persistent notification is visible in step 5).

### 4. App content → App access

Reviewers must be able to reach a driver delivery. Provide a **non-production** demo driver account (never a
development seed credential), and write step-by-step instructions, for example: "Sign in with the driver
phone and password below. Go online. A demo order is already ready for pickup: tap Accept, then read the
disclosure, tap Continue and allow location. Tap Navigate." Keep an order in the ready-for-pickup state on
the review server for the duration of review, and make sure the demo store has map coordinates.

### 5. Privacy policy

`docs/privacy-policy.md` (Arabic draft) now describes driver location. Play requires the policy to be
reachable at a public URL, to mention this collection, and to be linked in the store listing. Consider an
English version for reviewers. It still needs the operator identity and contact before publication.

## Apple App Store Connect

- **App Privacy → Data collected → Location → Precise Location:** collected, **linked to the user**, purpose
  **App Functionality**, **not** used for tracking. (Delivery tracking of one's own staff is not "tracking"
  in Apple's sense: it is not combined with other companies' data or used for advertising.)
- **Review notes:** explain that background location is used only during an active delivery, describe the
  disclosure and the blue location indicator, provide the same demo driver account, and state that location
  is not used when there is no active delivery.
- **Info.plist:** the "Always" usage description text and the `location` background mode are generated from
  `app.json` at build time. iOS shows its own "Always" upgrade prompt a little later; the disclosure tells
  the driver to choose "Always".

## Before you submit

1. Build `0.15.0` (Android + iOS) and test on a real phone (see the device checklist in
   `apps/mobile/NATIVE_CONFIGURATION.md`).
2. Publish the privacy policy and put its URL in both consoles.
3. Fill in the Data safety form and the two Play declarations with the text above; record and upload the video.
4. Provide the demo driver account and instructions; keep a ready order available while under review.
5. Expect a manual review of the location declaration; a first rejection asking for a clearer video or
   disclosure is common and is fixed in the console and the copy, not the code.

# Privacy data inventory (evidence for the policy and the store forms)

This inventory is derived from the code on `store-remediation-1`. Paths are relative to `apps/`.

- **Feeds:** `docs/store/privacy-policy.md` and `docs/store/data-safety-and-app-privacy.md`.
- **Rule:** if a row here changes, update both documents.

## Data stored by the API (PostgreSQL on Railway)

| Data | Who | Where (schema / code) | Purpose | Retention / deletion |
|---|---|---|---|---|
| Full name, phone (E.164), password hash, optional email | all roles | `User` (`api/prisma/schema.prisma`); email set in `mobile/src/features/customer/account-screen.tsx:146` | account, login | Anonymised on deletion (`users.service.ts` `anonymise`) |
| Role, platform role, business memberships | all roles | `User.role`, `Role`, `BusinessMember` | authorization | Memberships deactivated on staff deletion |
| Refresh sessions (token hash, expiry; no IP or device) | all roles | `RefreshSession` | sign-in | Revoked on deletion; expire |
| OTP challenges (code hash, attempts) and pending registrations | signup and reset | `PhoneVerificationChallenge`, `PendingCustomerRegistration` | phone verification | Short-lived |
| Password reset tokens | all | `PasswordResetToken` | reset | Short-lived |
| Saved addresses: label, line, lat/lng | customer | `Address` | delivery | Deleted on deletion |
| Orders: items, prices, fee, discounts, note, address line and lat/lng, distance, status history | customer, store, driver | `Order`, `OrderItem`, `OrderStatusHistory`, `FulfillmentAdjustment` | fulfilment, accounting | **Kept** (Restrict FK); linked to the anonymised user; [[PLACEHOLDER: retention period]] |
| Deliveries: driver, timestamps, failure reason | driver | `Delivery` | dispatch, accounting | Kept |
| Driver last position (lat/lng/time), online state, app state and lease | driver | `DriverProfile`; written by `drivers.service.ts:316` | dispatch | Cleared on driver deletion; only the last value is stored, no history |
| Cash custody, settlements, earnings, payouts | driver, admin | `DriverCashCustody`, `CashSettlement*`, `PartnerEarning`, `PartnerSettlement*` | cash accounting | Kept; blocks driver erasure until settled |
| Push tokens, platform, app version | all | `PushToken`; `PushDelivery` | notifications | Deleted on deletion; deactivated on opt-out |
| In-app notifications | all | `Notification` | inbox | Kept with the user id |
| Audit log of actions | all | `AuditLog` | security, accounting | Kept |
| Account deletion requests (status, dates, blocker codes) | driver | `AccountDeletionRequest` (new) | scheduled deletion | Completed rows kept |
| Product catalogue and images | store staff, admin | `MenuItem`, `MenuCategory`; images in Cloudflare R2 | catalogue | Business data |
| Login attempt counters (phone + IP) | all | in memory, `auth/login-attempt-limiter.ts` | brute-force protection | Lost on restart |

## Data sent from the device to third parties directly

| Data | Recipient | Code | When |
|---|---|---|---|
| Chosen map point (lat/lng) and language | OpenStreetMap Nominatim | `mobile/src/core/geocode.ts:22` | Customer or driver resolves an address, when the native geocoder fails |
| IP address and the visible map area (tile requests) | Esri ArcGIS (Android, web) and Apple Maps (iOS) | `components/location-map.*.tsx` | Any map display |
| Delivery point | Google Maps (Android) or Apple Maps (iOS) app | `features/driver/navigation-target.ts:151-152` | Driver taps "navigate" |
| Push token registration | Expo, FCM, APNs | `core/push-notifications.ts:44` | The user enables notifications |

## Data sent from the server to processors

| Processor | Data | Evidence |
|---|---|---|
| Railway (hosting and PostgreSQL, Amsterdam) | everything above | `docs/railway-setup.md` |
| Backblaze B2 | encrypted database dumps | `deploy/railway/backup/` (read only) |
| Cloudflare R2 (`images.jovops.com`) | product images | `api/src/uploads/s3-image-storage.service.ts` |
| TweetSMS | phone number, OTP text | `api/src/auth/tweetsms.contract.ts:15` |
| Expo Push (`exp.host`) to FCM and APNs | push token, title, body, order id | `api/src/realtime/push-sender.service.ts:8-9` |
| [[PLACEHOLDER: error-tracking provider]] via `ERROR_TRACKING_WEBHOOK_URL` | server error reports (redacted) | `api/src/config/environment.ts:119-132` |
| Vercel | web app and admin console hosting | `.github/workflows/deploy-vercel.yml` |

## Device permissions (Android manifest and iOS strings)

| Permission | Who | Why | Evidence |
|---|---|---|---|
| ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION | customer (address pin), driver | delivery area and fee; dispatch | `android/app/src/main/AndroidManifest.xml`; `app.json` expo-location strings; `native-locales/*.json` |
| ACCESS_BACKGROUND_LOCATION, FOREGROUND_SERVICE, FOREGROUND_SERVICE_LOCATION | driver | tracking during an active delivery | `core/background-location.ts` |
| CAMERA, photos | store staff and admin | product photos | `core/image-upload.ts:35-41` |
| POST_NOTIFICATIONS (library-merged) | all | order notifications | `core/push-notifications.ts:35-37` |
| INTERNET, VIBRATE | all | — | manifest |
| Blocked: storage read/write, SYSTEM_ALERT_WINDOW, RECORD_AUDIO, FOREGROUND_SERVICE_MEDIA_PLAYBACK | — | not needed | `app.json` `blockedPermissions` |

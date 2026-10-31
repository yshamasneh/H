# Security audit — store remediation run 1 (report-only)

- **Scope:** authentication, authorization, tenant isolation, IDOR, admin, driver and store permissions, sessions, uploads, logging of sensitive data, and exposure of customer addresses and driver location.
- **Method:** reading the code on `store-remediation-1`, plus the API unit suite (736 tests) and the PostgreSQL e2e suite (82 tests) run against a throwaway local database. No production system was called except `GET /api/v1/health`.
- **Rule for this run:** authentication and authorization behaviour was not changed. The only fixes made are the ones listed under "Fixed in this run".

**Severity scale**

- **HIGH:** exploitable now, or a store-review failure.
- **MEDIUM:** real weakness with limited reach.
- **LOW:** hardening.
- **INFO:** verified as correct.

## Fixed in this run

| ID | Severity | Finding | Evidence | Fix |
|---|---|---|---|---|
| S1 | **HIGH** (store) | Self-service account deletion always failed with HTTP 500. Anonymisation writes `phone = 'deleted-<id>'`, which the `User_phone_e164_check` constraint rejects. This applies to the **existing customer path** too, so a reviewer testing deletion in production would see an error. CONFIRMED on a migrated local database. Production was not exercised, so this is LIKELY there. | `apps/api/prisma/migrations/20260804190000_customer_phone_auth/migration.sql:22`; `users.service.ts` anonymise | New migration `20261031130000_allow_anonymised_user_phone`. It keeps the +970/+972 rule for every live account, and allows `deleted-<own id>` only when `isActive = false`. Covered by `account-deletion.e2e.test.ts`. |
| S2 | LOW | The public health response exposed the exact build commit and the old service name. | `health.controller.ts` | Service renamed to `jovo-api`; the commit is only included with `HEALTH_EXPOSE_COMMIT=true`. |
| S3 | LOW | The release login screen showed "Development API" and the API URL. | `features/auth/screens.tsx` | Rendered only in `__DEV__`; UI test added. |
| S4 | LOW | A release build could be produced or started against ngrok, localhost or plain HTTP. | `.env.production` (pattern count only) | `api-url.ts` startup guard, plus the `eas-build-pre-install` guard. |

## Open findings (not fixed: they would change auth behaviour or need a decision)

| ID | Severity | Finding | Evidence | Proposed fix | Tests to add |
|---|---|---|---|---|---|
| S5 | MEDIUM | **WebSocket sessions are authenticated only at connect.** After an administrator suspends a user, or a user deletes their account, an already-open Socket.IO connection keeps its rooms (`user:<id>`, `drivers`, `restaurant:<businessId>`, `admins`) until it disconnects. HTTP is protected per request (`jwt-auth.guard.ts` re-checks the session, `tokenVersion` and `isActive`); the socket is not. Exposure: realtime payloads to the revoked device: order and delivery status events, and for `admins`, admin events. | `apps/api/src/realtime/realtime.gateway.ts:42-64` (rooms joined once), `:118-140` (auth only in `handleConnection`) | On suspension or deletion, call `server.in("user:<id>").disconnectSockets(true)`. Optionally re-validate the session on a timer, or on every `order.subscribe`. | An e2e test that connects a socket, suspends the user, and asserts the next emitted event is not received. |
| S6 | LOW | **Unassigned deliveries show the customer's address line and coordinates to every driver account that can call the available-deliveries endpoint** before anyone accepts. I did not trace whether an approval or online check applies to listing; the accept action requires online. The phone is correctly withheld until `driverMayCallCustomer`. | `drivers.service.ts:635-642` (`listAvailableDeliveries`), `:1147` (`deliveryAddressLine`), `:1153` (phone gated) | Before acceptance, show only the distance and a coarse area (neighbourhood or landmark). Reveal the exact line and coordinates on acceptance. A product decision, because drivers use it to choose jobs. | Unit test on `toDeliveryView` for the pre-accept shape. |
| S7 | LOW | **Login back-off is held in process memory** (`Map`s). With more than one API replica, each replica counts separately and a restart resets the counters. | `apps/api/src/auth/login-attempt-limiter.ts:34-35` | Back it with PostgreSQL or Redis if the API is ever scaled beyond one instance. | — |
| S8 | LOW | **Order snapshots keep the delivery address, coordinates and the customer's note indefinitely after account deletion.** This is by design for accounting, and the new privacy policy now discloses it, but there is no purge or coarsening job after the retention period. | `schema.prisma` `Order.deliveryAddressLine/deliveryLatitude/deliveryLongitude/customerNote` | After the owner-set retention period, null the coordinates and note and truncate the address line for orders whose customer is deleted. | A unit test for the purge query, and a dry-run report. |
| S9 | LOW | **Device-side reverse geocoding sends the chosen coordinates straight to OpenStreetMap Nominatim** with no app-identifying User-Agent. This is a privacy and terms-of-use issue (see M4). | `apps/mobile/src/core/geocode.ts:22,95` | Proxy through the API (design in `technical-analyses.md` M4). | — |
| S10 | LOW | **Worker kill-switches read env strings as booleans.** `config.get<boolean>("OFFER_ACTIVATION_WORKER_ENABLED", true)` treats the string `"false"` as truthy, so the variable cannot disable the worker. The new deletion sweep parses the string explicitly. | `apps/api/src/offers/offer-activation.service.ts:34` | Parse it with `readBoolean` in `environment.ts`, like `PUSH_WORKER_ENABLED`. | Config unit test. |

## Verified correct (INFO)

| Area | Evidence |
|---|---|
| Every request re-validates the session row, its expiry, revocation, `tokenVersion`, `isActive` and the verified phone. | `apps/api/src/auth/jwt-auth.guard.ts` |
| Every admin, store and driver controller carries `JwtAuthGuard` and the permissions guard. Unguarded controllers are only health, metrics (token-guarded, constant-time compare), the read-only supermarket catalogue, and `restaurants` (registration returns 403 by default on deployed hosts). | Controller inventory (grep of `UseGuards` and `RequirePermissions`); `metrics.controller.ts` |
| IDOR: customer order reads and cancels check `order.customerId`; driver delivery actions check `delivery.driverId`; the socket `order.subscribe` applies the same tenancy rules. | `orders.service.ts:241,563,798`; `drivers.service.ts:613,745`; `realtime.gateway.ts:72-93` |
| Uploads: content types allow-listed (JPEG, PNG, WebP), size-capped, magic-byte signature verified, and the staging path is bound to the uploader. | `apps/api/src/uploads/uploads.service.ts:31-79` |
| Logging: sensitive keys (password, token, OTP, code, secret, authorization, cookie) are redacted; request logs hold method, path, status and duration only, with no IP or body. | `observability/structured-logger.ts:12,49-73`; `request.middleware.ts:20-34` |
| Rate limits: global throttler (default 400 per minute per IP), 5–20 per minute on auth routes, and per-phone/IP login back-off. | `app.module.ts:33-38`; `auth.controller.ts:22-67` |
| CORS: `*` only outside production; production requires explicit HTTPS origins. | `config/environment.ts:71,396` |
| Swagger refused in production; public restaurant registration off on deployed hosts; OTP console provider refused in production. | `config/environment.ts:81,97-104` |
| Driver location: only the last position is stored; only admins see it (`toLocationView`); never on customer views. | `drivers.service.ts:316,916,936`; `schema.prisma` `DriverProfile` |
| Mobile release builds refuse non-HTTPS APIs; cleartext is allowed only in debug manifests. | `apps/mobile/src/core/api-url.ts`; `android/app/src/debug/AndroidManifest.xml` |

## New code in this run: security notes

- **Account deletion** (`users.service.ts`). It acts only on `request.user.id` from the JWT guard and has no id parameter, so there is no IDOR. The admin role is refused, and the store owner is refused. The driver obligation check and the erasure run in one serializable transaction. Erasure bumps `tokenVersion` and revokes refresh sessions (the open-socket caveat is S5).
- **`GET /users/me/deletion`** returns only the caller's own request.
- **Restricted-product screening** is input validation only. It does not alter permissions: staff with `MANAGE_PRODUCTS` remain the only ones who can create products.

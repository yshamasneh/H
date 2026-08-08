# Progress

## 2026-08-04

Completed:

- Replaced Express in-memory authentication with a validated NestJS API.
- Added Docker Compose PostgreSQL with health check and persistent named volume.
- Added Prisma schema, migration, generated client workflow, and idempotent customer seed.
- Implemented `+970`/`+972` normalization, Argon2id passwords, HMAC OTPs, rate limiting, OTP cooldown/expiry/attempt limits, and purpose isolation.
- Implemented verified customer signup, duplicate protection, login, refresh rotation, logout, current user, forgot password, one-time reset tokens, and refresh-session invalidation.
- Added Login, Customer Sign Up, Forgot Password, reusable OTP, New Password, and Customer Home screens with loading and error states.
- Preserved the TasawaQ logo, three-second splash, Expo development build, native Android project, and VS Code tasks.
- Replaced React Native's deprecated built-in safe-area view with Expo's compatible safe-area module.
- Added backend behavior tests and mobile navigation tests.
- Updated setup, database, development OTP, seed, native Android, and production-provider documentation.

Verified:

- PostgreSQL became healthy and accepted the checked-in migration.
- Running the seed twice left exactly one local test customer.
- The API connected to PostgreSQL and the seeded login worked.
- A live signup printed an OTP in the backend log and created no `User` before verification.
- OTP verification created exactly one active verified `CUSTOMER`.
- Repeating signup returned `PHONE_ALREADY_REGISTERED`, created no duplicate, and printed no new OTP.
- Existing-account password reset worked; reset-token reuse, old password, and old refresh token were rejected.
- Unknown-account forgot password returned `ACCOUNT_NOT_FOUND` without creating a user.
- Data remained after restarting both PostgreSQL and the API.
- Backend and mobile tests, lint, type checking, API build, Prisma generation, and Prisma validation passed.
- Expo Doctor passed 17/17 checks, Metro exported both native bundles, and Android `assembleDebug` completed successfully.
- The rebuilt development client was installed on an emulator; the splash, login, seeded PostgreSQL login, Customer Home, and Metro connection were visually verified without Expo Go.

Remaining production integration:

- Replace the development terminal OTP provider with an approved WhatsApp Business or SMS provider and production delivery/anti-enumeration policies.
- Plan a tested Expo SDK upgrade before production; the current repository audit reports transitive Expo SDK 54 CLI/config advisories whose npm-proposed fix is a breaking Expo 57 upgrade. The API production dependency audit is clean.

## 2026-08-04: Phase 3 — Restaurants & Menus

Completed:

- Added `Restaurant`, `MenuCategory`, and `MenuItem` to the Prisma schema plus migration `20260804200000_restaurants_and_menus`, with `RestaurantStatus` (`PENDING | APPROVED | REJECTED`), an independent `isOpen` toggle, and `priceMinor` stored as a Postgres integer.
- Added restaurant-owner onboarding: `POST /api/v1/restaurants/register` creates a `RESTAURANT`-role `User` and a `PENDING` `Restaurant` together, in a transaction, without a new OTP flow. The owner then logs in through the existing, unmodified `POST /api/v1/auth/login`.
- Added a `RolesGuard` and `@Roles()` decorator (`common/guards`, `common/decorators`) on top of the existing `JwtAuthGuard` to gate the new `RESTAURANT`- and `ADMIN`-only routes.
- Added the restaurant portal: profile read/update, open-status toggle, and full menu category/item CRUD under `/api/v1/restaurant/me/...`, all scoped to the caller's own restaurant — the restaurant id is never taken from the client, and mismatched category/item ids return a generic `404`.
- Added the public catalog: paginated restaurant listing (approved + open only), single-restaurant profile, and menu (active categories, available items only) under `/api/v1/restaurants/...`, no authentication required.
- Added a minimal admin approval flow: `POST /api/v1/admin/restaurants/:id/approve` and `.../reject`, both restricted to a restaurant currently `PENDING`.
- Extended the idempotent seed script with a local `ADMIN` account (`+970590000001` / `Test@12345`) so the approval flow is testable without a real admin panel.
- Added a mobile restaurant browse screen and a restaurant detail/menu screen (no cart — that is Phase 4), reachable from Customer Home via a new "Browse Restaurants" button shown only to `CUSTOMER` accounts.
- Added 14 new backend tests (`restaurants.service.test.ts`, `menu.service.test.ts`) covering registration, approved+open public filtering, active/available menu filtering, and — the security-critical case — that one restaurant cannot read or write another restaurant's category or item. Added 3 new mobile navigation tests for the browse/menu/home transitions.

Verified:

- `npm run typecheck`, `npm run lint`, and `npm test` pass across both workspaces (47 tests total: 37 API, 10 mobile).
- `npm run build --workspace @wasel/api` and `npm run prisma:validate` succeed.
- `npx expo export --platform android` bundles the mobile app cleanly (700 modules) with the new screens wired in.
- The auth module (`apps/api/src/auth/**`) was not modified; restaurant login reuses it as-is.

Remaining before Phase 4 (cart/checkout/orders) can start:

- No mobile UI exists yet for restaurant owners to register, manage their profile, or edit their menu — Phase 3 only required the backend endpoints plus customer-facing browse/menu screens, so owner-side testing currently goes through Swagger (`/api/docs`) rather than the app.
- No admin UI exists yet either; approval also currently goes through Swagger. A real admin panel remains out of scope until its own phase.
- `Restaurant.status` has no `SUSPENDED` state and no endpoint changes an already-approved restaurant's status; that decision is deferred (see `docs/decisions.md`).
- The public menu and detail endpoints are unauthenticated by design (matches the spec), but there is still no rate limiting tuned specifically for catalog browsing beyond the global throttler defaults.
- Phase 4 will need `Order`, `OrderItem`, and a local cart; menu items and categories created in this phase are ready to be referenced by `menuItemId` with server-side price snapshots.

## 2026-08-06: Phase 4 — Cart, Checkout & Orders

Completed:

- Added `Order` and `OrderItem` to the Prisma schema plus migration `20260806000000_orders_cart_checkout`, with `OrderStatus` (`PLACED | CANCELLED`, only `PLACED` reachable this phase) and `OrderPaymentMethod` (`CASH` only, modeled as an enum for future extension). `OrderItem` stores an immutable `nameSnapshot`/`priceMinorSnapshot` taken at order-creation time; order totals and item prices are never recalculated from live `MenuItem` data afterward. Added indexes on `(customerId, createdAt)` and `(restaurantId, createdAt)` for the two "my orders, most recent first" query patterns, plus DB-level `CHECK` constraints on every money/quantity column, matching Phase 3's migration style.
- Added `POST /api/v1/orders`: validates the restaurant is `APPROVED` and `isOpen`, validates every `menuItemId` belongs to that restaurant and is `isAvailable`, rejects the whole order (no partial creation) if any line fails either check, re-reads current `priceMinor` from the database for every line (the DTO does not even accept a client-supplied price field), and creates the `Order` plus all `OrderItem` rows atomically inside a single Prisma transaction. Delivery fee and service fee are computed by an isolated `calculateOrderFees()` function (`apps/api/src/orders/pricing.ts`) using a flat-rate placeholder, documented as the single point to swap in real pricing logic later.
- Added `GET /api/v1/orders/me` (paginated, most recent first, includes items and restaurant summary) and `GET /api/v1/orders/:id` (customer's own order only, generic `ORDER_NOT_FOUND` on mismatch) for customers.
- Added `GET /api/v1/restaurant/me/orders` and `GET /api/v1/restaurant/me/orders/:id` for restaurant owners, with ownership resolved from `Restaurant.ownerUserId = request.user.id` exactly as Phase 3's menu endpoints do it — never from a client-supplied restaurant id.
- Added a mobile cart (`src/cart.ts`, pure functions, no new state library — a `useState<Cart | null>` lifted into `App.tsx`), scoped to a single restaurant; adding an item from a different restaurant while the cart is non-empty prompts a native confirm dialog to clear it first.
- Added mobile Cart, Checkout, Order Confirmation, Order History, and Order Detail screens (`src/cart-screens.tsx`), and extended `RestaurantMenuScreen` with per-item "Add" buttons and a floating "View Cart" bar. Checkout collects a delivery address label/line and a payment method (cash only, rendered from an array so future methods appear automatically), calls `POST /orders`, and only displays the server-returned authoritative totals — the cart screen's running subtotal is explicitly labeled as an estimate throughout.
- Extracted SecureStore token access from `App.tsx` into `src/session.ts` so the new checkout/order screens can read the access token without prop-drilling it through unrelated screens; login/logout/restore-session behavior is unchanged.
- Added 9 new backend tests (`orders.service.test.ts`) covering: server ignores a client-supplied price and uses the real database price; rejection when the restaurant is unapproved or closed; rejection (with no partial order) when a requested item is unavailable or belongs to a different restaurant; server-computed totals; customer A cannot read customer B's order; restaurant A cannot read restaurant B's incoming orders or list; and order item snapshots stay correct after the underlying menu item's price and name change post-order. Added 7 new mobile tests (`cart.test.ts`) covering the pure cart logic (add/increment, remove-at-zero, restaurant scoping, subtotal/count).

Verified:

- `npm run lint`, `npm run typecheck`, and `npm test` pass across both workspaces (63 tests total: 46 API — 37 prior + 9 new — and 17 mobile — 10 prior + 7 new).
- `npm run build --workspace @wasel/api` (includes `prisma generate`) and `npm run prisma:validate` succeed.
- `npx expo export --platform all` bundles both the Android and iOS mobile bundles cleanly (703/705 modules) with the new cart/checkout/order screens wired in.
- The auth module (`apps/api/src/auth/**`) and Phase 3's restaurant/menu module internals were not modified; `OrdersService` reads `Restaurant` and `MenuItem` rows directly through the shared Prisma client rather than importing `RestaurantsService`.

Known gap — not run in this environment:

- This development environment has no Docker daemon and no local PostgreSQL install, so the `20260806000000_orders_cart_checkout` migration was hand-authored (following Phase 3's existing migration SQL style exactly) rather than generated and applied via `prisma migrate dev` against a live database. `prisma generate` and `prisma validate` both succeed and the full test suite runs against in-memory fakes, but the migration itself has not been executed against Postgres. Run `npm run prisma:migrate` (or `prisma migrate deploy` in a deployed environment) once a database is reachable, before relying on this schema in a running instance.

Remaining before Phase 5 (restaurant order operations) can start:

- Orders stay at `PLACED` forever in this phase by design — there is no accept/reject/preparing/ready transition, no `OrderStatusHistory`, and no customer-facing cancel endpoint yet. All of that is Phase 5's transition-map work.
- No real payment gateway; `CASH` is the only payment method, matching the spec's own MVP scope.
- Delivery fee/service fee are a flat-rate placeholder (`apps/api/src/orders/pricing.ts`); no real pricing rules engine exists yet.
- There is still no saved-address book (`Address` model/CRUD) — delivery address is entered fresh at checkout each time as plain fields on `Order`. Latitude/longitude columns exist on `Order` but have no input UI yet (no map/location picker in the app).
- No WebSocket/real-time order updates and no push/in-app notifications yet — those are Phase 7.

## 2026-08-06: Phase 5 — Restaurant Order Handling, and Phase 6 — Driver & Delivery Flow

This session ran with a live Docker Postgres available for the first time (`tasawaq-postgres`, already running). Before starting new work, the Phase 4 "known gap" above was closed: `npm run prisma:migrate` applied cleanly to the live database (see `docs/decisions.md`), and the demo seed script (extended this session to also create an `APPROVED`/open demo restaurant with 2 categories and 5 menu items, so the app has something to browse out of the box) was run successfully. `npm install` also had to repair a missing `@nestjs/cli` dependency before `nest start --watch` would run.

### Phase 5 — Completed

- `OrderStatus` extended from `PLACED | CANCELLED` to `PLACED | ACCEPTED | PREPARING | READY_FOR_PICKUP | DELIVERED | REJECTED | CANCELLED`, with an explicit `allowedOrderTransitions` map in `OrdersService` — no endpoint can write an arbitrary status.
- New `OrderStatusHistory` model (`orderId`, nullable `fromStatus`, `toStatus`, `changedByUserId`, optional `note`, `createdAt`), written on every transition including order creation itself (`null -> PLACED`).
- `PATCH /api/v1/restaurant/me/orders/:id/status` (`RESTAURANT` role): accepts `ACCEPTED | PREPARING | READY_FOR_PICKUP | REJECTED` plus an optional `note`; ownership resolved from the JWT exactly like Phase 3/4; invalid transitions return `409 ORDER_INVALID_TRANSITION`; the status write itself is a conditional `updateMany` + count check (not a plain `update`), the same race-guard pattern already used for refresh-token rotation.
- `GET /orders/:id` (customer) and `GET /restaurant/me/orders/:id` both now return the full `statusHistory` array, ordered oldest-first.
- 7 new backend tests in `orders.service.test.ts` covering: fresh-order history, the full accept -> preparing -> ready-for-pickup happy path with a note, rejection from `PLACED`, out-of-order transitions (`PLACED -> READY_FOR_PICKUP` directly), terminal-status immutability, cross-restaurant ownership isolation, and the customer-visible history.

### Phase 6 — Completed

- New Prisma models: `DriverProfile` (keyed directly by `userId`, `isOnline`, optional last lat/lng) and `Delivery` (1:1 with `Order`, `DeliveryStatus` enum `PENDING_ASSIGNMENT | ASSIGNED | PICKED_UP | ON_THE_WAY | DELIVERED | CANCELLED`, per-transition timestamps). Both models and the `OrderStatusHistory` model from Phase 5 were added in one migration, `20260805235831_order_status_and_delivery`, generated and applied via `prisma migrate dev` against the live database (not hand-authored, unlike Phase 4's migration).
- New `drivers` Nest module: `POST /api/v1/drivers/register` (public, mirrors restaurant self-registration — no OTP, no admin approval), `PATCH /driver/me/status` (online/offline toggle), `GET /driver/me/deliveries/available` (unclaimed deliveries, any online driver), `GET /driver/me/deliveries` (the caller's own), `POST /driver/me/deliveries/:id/accept` (atomic claim), `PATCH /driver/me/deliveries/:id/status` (pickup -> on-the-way -> delivered).
- Delivery auto-creation: `OrdersService`'s `READY_FOR_PICKUP` transition now also creates the `Delivery` row (`PENDING_ASSIGNMENT`) in the same transaction — the one place Phase 6 touches Phase 5's code, as the task explicitly allowed.
- Atomic accept: `delivery.updateMany({ where: { id, status: PENDING_ASSIGNMENT, driverId: null }, ... })` + `count === 1` check inside a transaction. Two drivers accepting the same delivery simultaneously: exactly one succeeds, verified by a dedicated `Promise.allSettled` concurrency test mirroring the existing "concurrent signup verification" test's style.
- Completing a delivery (`DELIVERED`) also updates the parent `Order.status` to `DELIVERED` and appends an `OrderStatusHistory` row, closing the loop back to the customer's order view.
- `GET /orders/:id` now also returns a `delivery` summary (status + timestamps) whenever one exists.
- 12 new backend tests in `drivers.service.test.ts` covering: registration, duplicate-phone rejection, online/offline toggle, offline-driver rejection, successful accept, already-claimed rejection, the two-simultaneous-accepts race (exactly one wins), the full pickup -> on-the-way -> delivered progression (including the `Order`/`OrderStatusHistory` side effects), out-of-order delivery transitions, cross-driver ownership isolation, and available/own-deliveries list scoping.

### Mobile — Completed

- Restaurant: new `RestaurantOrdersScreen` (incoming orders list) and `RestaurantOrderDetailScreen` (status timeline + Accept/Reject/Start Preparing/Ready-for-Pickup buttons, each only shown when valid for the order's current status).
- Driver: new `DriverHomeScreen` (online/offline switch, active-deliveries list, available-deliveries list with Accept) and `DeliveryDetailScreen` (pickup address, delivery address, order total, single "next action" button that advances through pickup/on-the-way/delivered).
- Customer: `OrderDetailScreen` now renders a `DeliveryProgressCard` (when a delivery exists) and a full status-history timeline; the shared `StatusBadge` now colors all 7 order statuses instead of just PLACED/CANCELLED.
- `HomeScreen` gained two new role-gated entry points: "Manage Incoming Orders" (`RESTAURANT`) and "Delivery Dashboard" (`DRIVER`), following the same `user.role === "..."` pattern the existing customer-only buttons already use.
- No new state-management library, no new navigation library — same lifted-`useState` + typed-union `AppScreen` pattern as every prior phase.
- No driver-registration screen was added, matching the precedent that restaurant registration also has no mobile UI (Swagger only) — see `docs/decisions.md`.

### Verified (this session, against the live database — not just in-memory fakes)

- `npm run lint`, `npm run typecheck`, and `npm test` all pass clean across both workspaces from the repo root: **65 API tests** (46 prior + 7 new Phase 5 tests + 12 new Phase 6 tests) and **17 mobile tests** (unchanged from Phase 4, none broken) — **82 tests total, 0 failures**.
- `npm run build` succeeds for both workspaces (`prisma generate` + `tsc` for the API, `expo export --platform all` for mobile — 704/707 modules, both Android and iOS bundles).
- `npx prisma validate` passes.
- `npx prisma migrate deploy` / `migrate dev` applied the new migration to the live `tasawaq-postgres` container — confirmed via `psql \dt` showing `OrderStatusHistory`, `DriverProfile`, and `Delivery` tables, and via `SELECT` on `_prisma_migrations`.
- A full manual end-to-end happy-path smoke test ran against the live API and database (not mocked): customer login -> browse seeded restaurant -> place order -> restaurant accepts/prepares/marks ready (delivery auto-created) -> fresh driver registers, goes online, sees the available delivery, accepts it, advances pickup -> on-the-way -> delivered -> customer's `GET /orders/:id` shows `DELIVERED` with the complete 5-entry status history and the delivery's own `DELIVERED` status. This also exercised Phase 4's `POST /orders` end-to-end for the first time ever against a real database, which is how the seed-data UUID-format bug (see `docs/decisions.md`) was caught and fixed.

Remaining before Phase 7 (Admin, Realtime, and Notifications) — all addressed this session, see below:

- No customer-facing cancel endpoint yet (see `docs/decisions.md` — deliberately out of this phase's scope).
- No admin dashboard/screens, no `AuditLog`, no admin override of stuck orders or deliveries.
- No WebSocket layer — order/delivery status changes require polling (pull-to-refresh) in the mobile app; REST remains the only source of truth, matching the spec's own guidance to build this after the core order/delivery cycle is stable.
- No push notifications and no in-app `Notification` model/inbox yet.
- Driver location (`DriverProfile.lastLatitude`/`lastLongitude`) has columns but no write path yet — no endpoint updates it and the mobile app never requests location permission. Real-time driver-location tracking on a map is out of scope until a maps provider is chosen.
- No distance/matching algorithm for delivery assignment — any online driver can see and accept any pending delivery, per this phase's explicit scope boundary.
- No driver-registration screen in the mobile app (Swagger only), matching the existing restaurant-registration precedent.

## 2026-08-06: Phase 7 — Admin Dashboard, Realtime, and Notifications

Before starting, a real migration-ordering bug from the Phase 5/6 session was found and fixed: `20260805235831_order_status_and_delivery`'s auto-generated timestamp sorted *before* the earlier phase's hand-placed `20260806000000_orders_cart_checkout`, even though it depends on that migration's `OrderStatus` enum — this would have broken a fresh `prisma migrate deploy` for anyone, including a teammate cloning the repo. Renamed to `20260806010000_order_status_and_delivery`, fixed the tracking row in the live `_prisma_migrations` table, and re-verified the full migration history replays cleanly. Full details in `docs/decisions.md`.

### Part A — Admin Dashboard: Completed

- New `apps/admin` workspace: React 19 + Vite + TypeScript + `react-router-dom`, hand-written CSS design system (no UI framework). Chosen over Next.js since this is a pure client-side SPA behind a login wall with no SSR/SEO need.
- `RestaurantStatus` gained `SUSPENDED`; `POST /admin/restaurants/:id/{suspend,reactivate}` added alongside the existing approve/reject, each writing an `AuditLog` entry and a notification.
- `DriverApprovalStatus` (`PENDING | APPROVED | REJECTED | SUSPENDED`) added to `DriverProfile`, defaulting `PENDING`; the online toggle now refuses `DRIVER_NOT_APPROVED` until an admin approves. `POST /admin/drivers/:id/{approve,reject,suspend,reactivate}` added.
- Order cancellation, two paths: `POST /orders/:id/cancel` (customer, `PLACED` only) and `POST /admin/orders/:id/cancel` (admin override, any non-terminal status, mandatory reason, bypasses the normal transition map by design).
- New cross-cutting `admin` module: `GET /admin/dashboard` (orders today, revenue today, active deliveries, pending restaurant approvals, online driver count, new signups today, 20-entry recent-activity feed), `GET /admin/users` (searchable by name/phone, filterable by role, never returns password hashes), `GET /admin/audit-log` (filterable by actor/action/date range).
- `GET /admin/restaurants/:id` (profile + total-orders/revenue stats), `.../menu` (full menu including inactive/unavailable), `.../orders` (order history) added for the restaurant detail page.
- Admin UI pages: Dashboard (live stat cards + activity feed), Restaurants (filter, approve/reject, suspend/reactivate via a reason modal, detail page), Orders (filter by status/date, detail page with full status timeline and a cancel action), Drivers (approve/reject/suspend/reactivate), Users (search/filter), Audit Log (filter by action).
- **Manually verified end-to-end in a real browser against the live API and database**: logged in as the seeded admin, approved and then suspended a freshly-registered pending restaurant (confirmed both actions appeared correctly on the Audit Log page with the exact reason text entered), approved a pending driver, browsed the orders list into a full order-detail page with status timeline and delivery info, and confirmed the users list. Screenshots were taken at each step during the session.

### Part B — Realtime layer: Completed

- New `RealtimeGateway` (Socket.IO via `@nestjs/websockets` + `@nestjs/platform-socket.io`), provided by a `@Global()` `RealtimeModule` so domain services can inject it directly (the one deliberate exception to the "no cross-module services" rule — justified in `docs/decisions.md`).
- JWT-authenticated handshake: same checks as `JwtAuthGuard` (signature, session validity, active/verified user, token version), rejecting and disconnecting on any failure.
- Rooms: `user:{id}`, `admins` (ADMIN role), `restaurant:{restaurantId}` (RESTAURANT owner), and `order:{orderId}` (granted only after the gateway verifies the requesting socket's user actually owns/administrates that order).
- Events emitted: `order.created`, `order.status.changed`, `delivery.status.changed`, `restaurant.pending.created`, `notification.created`.
- REST remains the only source of truth — every client treats a socket event purely as a "go re-fetch" signal, documented explicitly in `docs/architecture.md`. Wired into: the admin dashboard's live metrics/activity feed, the admin orders list, the mobile customer order-detail screen, and the mobile restaurant incoming-orders screen.
- 5 new backend tests in `realtime.gateway.test.ts` covering: no token, invalid/expired token, valid token with no matching session, valid token with an active session (room joined), and a revoked session — all constructing `RealtimeGateway` directly with fake `JwtService`/`ConfigService`/`PrismaService` and a mock socket, matching this codebase's existing unit-test style (no real socket server spun up).

### Part C — Notifications: Completed

- New `Notification` model (`userId`, `type`, `title`, `body`, `relatedEntityId`, `isRead`, `createdAt`) and a shared `createNotification()` helper that writes the row and emits `notification.created` in one call — used inline by orders/restaurants/drivers services, the same "plain function, not a service" pattern as `writeAuditLog()`.
- Notifications created on: order placed (restaurant owner), order accepted/preparing/ready/rejected/cancelled (customer), delivery assigned/picked-up/on-the-way/delivered (customer), restaurant approved/rejected/suspended/reactivated (owner), driver approved/rejected/suspended/reactivated (driver).
- `GET /notifications/me` (paginated, includes `unreadCount`) and `PATCH /notifications/:id/read` (ownership from JWT) — new `notifications` module.
- Mobile: new `NotificationInboxScreen` (pull-to-refresh, tap-to-mark-read, live-updating via `notification.created`) plus an unread-count badge on the `HomeScreen`'s new "Notifications" button, visible to every role.
- Device push notifications (Expo push, APNs/FCM) are explicitly out of scope this phase — in-app only, per the task's boundary.
- 3 new backend tests in `notifications.service.test.ts` covering: a user only sees their own notifications with a correct unread count, marking read only works for the owning user (`NOTIFICATION_NOT_FOUND` otherwise), and the unread count decreases after marking read.

### Verified (this session, against the live database — not just in-memory fakes)

- `npm run lint`, `npm run typecheck`, and `npm test` all pass clean across all three workspaces from the repo root: **97 API tests** (65 prior + 32 new: 7 driver-approval/admin, 8 order-cancel/admin, 5 restaurant-suspend/admin, 5 admin-dashboard, 5 realtime-auth, 3 notifications rounding out — see exact per-file counts in `docs/decisions.md` and the test files themselves) and **17 mobile tests** (unchanged, none broken).
- `npm run build` succeeds for all three workspaces: API (`prisma generate` + `tsc`), admin (`tsc` + `vite build`), mobile (`expo export --platform all`, 734/738 modules across Android and iOS with `socket.io-client` now bundled).
- `npx prisma validate` passes; `npx prisma migrate status` confirms all 5 migrations applied and the schema up to date on the live `tasawaq-postgres` database.
- A dedicated Phase 7 smoke-test script ran against the live API and database end-to-end: customer self-cancels a `PLACED` order (succeeds), customer is blocked from cancelling an order the restaurant already accepted (`ORDER_NOT_CANCELLABLE`), admin overrides and cancels that same accepted order with a reason (succeeds, `OrderStatus.CANCELLED`), the restaurant owner and customer both received the expected notifications, an unread notification was marked read, the admin dashboard returned live counts and a 20-entry activity feed, the audit log showed the `ORDER_CANCELLED_BY_ADMIN` entry with the exact reason text, and a non-admin token was correctly rejected (403) from `/admin/dashboard`. Confirmed directly in Postgres via `psql` that real `AuditLog` and `Notification` rows exist with the expected content.

Remaining before Phase 8 (production hardening):

- No production OTP provider — still the development terminal-print provider; a real WhatsApp Business/SMS provider is Phase 8's job per the original spec.
- No real payment gateway — still cash on delivery.
- Driver location tracking (`DriverProfile.lastLatitude`/`lastLongitude`) still has no write path or map UI — unchanged from Phase 6, still blocked on choosing a maps provider.
- No distance/matching algorithm for delivery assignment — unchanged from Phase 6, explicitly deferred.
- No automated test suite for the `apps/admin` frontend — verified manually end-to-end in a real browser this session instead; a candidate for a later phase if the admin app's surface grows (see `docs/decisions.md`).
- No push notifications (device-level) — in-app only, as documented; Expo push integration would be a self-contained follow-up task.
- Production configuration, HTTPS, structured logging/monitoring, database backups, and store-listing prep are all still open, matching the spec's own Phase 8 scope.

## 2026-08-06: Phase 8 — Production Hardening and Launch Preparation

### Repository implementation: Completed

- Production environment validation now rejects wildcard/non-HTTPS CORS, placeholder/reused secrets, terminal OTP, unsafe webhook URLs, and missing monitoring/error-tracking credentials. REST and Socket.IO use one explicit origin allowlist; application routes require HTTPS behind one trusted proxy hop.
- Added `WebhookOtpProvider`, an authenticated vendor-neutral HTTPS adapter that never logs OTPs, plus production-only provider validation and unit coverage. The development terminal provider remains available locally and impossible in production.
- Added one-line JSON logging with recursive credential redaction, validated/generated request IDs, request timing, sanitized 5xx error delivery, separate `/health/live` and `/health/ready`, and token-protected Prometheus `/metrics` output.
- Added a hardened production topology: multi-stage non-root/read-only/capability-free API image, static Expo web image, Nginx TLS/HSTS/CSP edge with REST and WebSocket proxying, one-shot Prisma migration service, and external PostgreSQL ownership. `docker compose ... config --quiet` validates successfully; this machine has no running Docker daemon, so image construction/startup is also enforced in CI rather than claimed as locally executed.
- Added `pg_dump` custom-archive backups with SHA-256 sidecars and retention, non-destructive archive verification, and a guarded restore flow that uses a separate `RESTORE_DATABASE_URL` and explicit target-database confirmation. Added deploy/monitoring/incident/rollback/restore-drill procedures.
- Hardened mobile release configuration: version `0.8.0`/build 8, explicit scheme, HTTPS-only production API, Android cleartext/backup disabled, broad storage/overlay permissions removed, minification/resource shrinking enabled, and debug signing removed from release. Added EAS preview/production profiles.
- Added a new 1024×1024 store icon derived from the established TasawaQ Android launcher identity, bilingual store metadata, Arabic privacy/terms drafts, security review, store declarations, and an explicit closed-test/go-no-go checklist.
- Added GitHub CI for migration replay, lint, typecheck, tests, builds, API production audit, and both container builds; CodeQL JavaScript/TypeScript scanning; Dependabot for npm, Actions, and Docker; and a private vulnerability-reporting policy.
- Added eight Phase 8 API tests (production config 4, OTP webhook 2, log redaction 2). The full suite passes: **105 API + 18 mobile = 123 tests, 0 failures**. `npm run lint`, `npm run typecheck`, production-targeted `npm run build`, `npm run prisma:validate`, offline cached API production audit, release structure/environment validation, and production Compose config all pass.

### External launch gates: Not representable as code

- Supply operator-owned DNS/TLS, production database, OTP/error-tracking endpoints and tokens, legal entity/contact/jurisdiction details, store accounts, and production signing credentials.
- Publish the approved privacy/terms/support pages, capture screenshots from staging, complete Google Play closed testing and iOS TestFlight, run an isolated database restore drill, and record the four-role plus go/no-go sign-offs in `docs/launch-checklist.md`.
- Online payments, continuous driver location/maps and distance matching, and device push notifications remain separate provider/product phases exactly as the original Phase 8 scope specifies; enabling any of them requires new privacy/security review.

## 2026-08-08: Phase 9 — Integration Completion and Real E2E Coverage

### Repository implementation: Completed

- Added restaurant and driver application screens directly from Login, using the existing role-specific registration endpoints and returning successful applicants to a prefilled Login screen with clear approval-state guidance.
- Added the in-app Restaurant Workspace: owners can load/update their profile, open or close an approved restaurant, create and activate/hide categories, create/edit menu items, and pause/resume item availability. This closes the prior API-only profile/menu gap without duplicating server business rules in the client.
- Added typed mobile API contracts for role registration and every existing restaurant-owner profile/menu endpoint.
- Fixed order-detail realtime integration. Customer and restaurant detail screens now emit `order.subscribe`, receive only authorized order-room events, re-fetch REST state, and remove their listeners on cleanup. Added a focused mobile unit test for room subscription, filtering, delivery refresh, and cleanup.
- Added an opt-in PostgreSQL-backed HTTP E2E test covering the full four-role lifecycle: restaurant application/menu, admin approval, customer cash order, restaurant preparation, driver application/approval/delivery, final customer order state, and notifications. CI enables it after applying all real migrations; local unit runs skip it unless `RUN_DATABASE_E2E=true` or `npm run test:e2e` is used.
- Verified locally: lint, typecheck, all production builds, 105 API unit tests, 21 mobile tests, and the real PostgreSQL E2E journey pass. The E2E runner refuses `NODE_ENV=production` and refuses a non-local database unless its name explicitly contains `test`.

### Agreed product direction after Phase 9

- Cash on delivery remains the only payment method; electronic payments are removed from the roadmap.
- The next product work is location-based delivery pricing with a configured minimum fee, followed by generalized supermarket/catalog pages and a real promotion engine for product and delivery offers.

## 2026-08-08: Phase 10 — Location Pricing and Admin Offers

### Repository implementation: Completed

- Replaced the flat delivery placeholder with a server-authoritative Haversine distance calculation. Defaults are configurable through environment variables: 5.00 ILS minimum including 3 km, 1.50 ILS per additional started kilometer, 25 km maximum range, and 2.00 ILS service fee.
- Added restaurant delivery-origin coordinates and foreground location selection in the Restaurant Workspace. An approved restaurant cannot open until both coordinates are configured.
- Checkout now requests foreground location only after the customer taps the location button, calls `POST /orders/quote`, and displays distance, delivery/service fees, applied offers, and the exact cash-due total before placement. `POST /orders` recalculates everything and never trusts the quote or client prices.
- Added four admin-owned offer types: product percentage, whole-order percentage, delivery percentage, and free delivery. Admin routes support create/list/replace/activate/pause, validate schedule/scope/item ownership, and write audit logs. No restaurant-facing offer mutation exists.
- Added deterministic stacking: the best merchandise result (best item offers in aggregate versus the best whole-order offer) combines with at most one best delivery offer. Minimum subtotal and maximum-discount caps are enforced by the server, and applied offer snapshots are retained on the order.
- Public offer cards support restaurant and platform-wide campaigns. Product offers decorate menu items with an effective price and badge; the local cart uses that value only as an estimate.
- Applied migration `20260808090000_phase10_location_and_admin_offers` successfully to local PostgreSQL. The real HTTP E2E now proves customer denial from admin offer creation, admin offer creation, discounted public menu, quote/order pricing, promotion stacking, and the existing four-role delivery lifecycle.
- Updated Expo release metadata to `0.10.0`/build 10, added the foreground location permission declaration, and updated privacy/security/store documentation. Continuous/background driver tracking and third-party map providers remain disabled.

### Deferred after Phase 10

- Supermarket/catalog-specific departments, product detail/search/filter pages, inventory/weight substitutions, and store basket behavior remain the next separate product domain.
- Delivery distance currently uses straight-line coordinates and configurable pricing; road-routing ETA/distance requires a selected maps provider and a separate reliability/privacy review.

## 2026-08-08: Phase 11 — Online Supermarket Catalog

### Repository implementation: Completed

- Added a `BusinessType` boundary so approved/open restaurants and supermarkets share operational infrastructure but remain separate public browsing domains. Existing stores migrate safely as `RESTAURANT`.
- Added public supermarket endpoints for store listing, paginated catalog browsing, department filtering, featured filtering, and case-insensitive product/brand/SKU search, plus a dedicated product-detail endpoint. Hidden departments, unavailable products, and zero-stock products are not public.
- Expanded catalog products with optional SKU and brand, a required selling-unit label, optional tracked stock, and a featured flag. Store owners can manage all of these fields in the existing role-aware workspace.
- Added dedicated customer supermarket list, catalog, and product-detail screens. The home screen previews supermarkets and routes supermarket-scoped admin offers to the correct catalog.
- Added a per-order-line substitution preference. It is stored as an immutable order snapshot and shown to the store; Phase 11 does not automatically replace or reprice products.
- Order creation now aggregates requested quantities and atomically reserves tracked inventory. Insufficient stock rejects the complete order; customer/admin cancellation or store rejection restores tracked quantities. Null stock remains an explicit untracked/unlimited mode.
- Kept cash on delivery as the only payment method and reused Phase 10's location quote, minimum delivery fee, offer engine, and server-authoritative totals for supermarket orders.
- Added migration `20260808110000_phase11_supermarket_catalog`, idempotent supermarket demo data (`+970590000004`), Expo release `0.11.0`/build 11, unit coverage, and a real PostgreSQL E2E journey that proves catalog search, stock reservation, snapshot persistence, and cancellation restock.

### Deferred after Phase 11

- Automatic substitution selection/approval, variable-weight final-price adjustment, barcode scanning, supplier purchasing, multi-warehouse inventory, and road-routing/ETA integrations require separate product and operational rules.

## 2026-08-08: Phase 12 — Reviewed Grocery Fulfillment

### Repository implementation: Completed

- Added one fulfillment proposal per grocery order line with pending/approved/rejected states, immutable replacement name/unit/price snapshots, precise quantity in thousandths, customer note, decision time, and proposing owner.
- Supermarket owners can propose a replacement only when the customer allowed substitutions, or enter the packed quantity for a variable-weight original/replacement. Quantities are bounded to 50%-150% of the requested amount.
- Customers receive an in-app notification and realtime refresh, then approve or reject from Order Details. A store cannot accept an order while any proposal is pending.
- Approval recalculates the authoritative subtotal and cash-due total. Rejection, revised proposals, customer/admin cancellation, and store rejection reconcile original/replacement inventory safely; variable quantities reserve whole tracked units conservatively with exact pricing retained in thousandths.
- Added mobile fulfillment controls for store and customer, typed API contracts, a new realtime event, migration `20260808120000_phase12_grocery_fulfillment`, and focused replacement/consent/variable-quantity tests.

## 2026-08-08: Phase 13 — Inventory and Procurement

### Repository implementation: Completed

- Added product barcodes and reorder thresholds, searchable inventory with low/out-of-stock summaries, barcode lookup for typed or hardware-scanner input, and reason-required manual adjustments.
- Added an immutable inventory movement ledger covering order reserve/restore, fulfillment reserve/release, manual adjustments, and purchase receipts. Owner mutations also create audit records.
- Added supermarket-scoped suppliers and draft/received/cancelled purchase orders with validated store-owned lines and transactional receiving into stock.
- Added a dedicated Inventory workspace for stock search, low-stock filtering, barcode lookup, adjustments, supplier creation, purchase creation/receiving/cancellation, and recent movement history.
- Added migrations `20260808130000_phase13_inventory_procurement` and `20260808131000_phase13_owner_reference_cascades`, seeded barcodes/reorder levels/variable produce plus a demo supplier and purchase, and updated the release to `0.13.0`/build 13.
- The PostgreSQL HTTP E2E now proves replacement approval, the pending-review acceptance gate, inventory restoration, barcode/low-stock queries, manual adjustment, supplier/purchase receiving, movement coverage, and the existing cash delivery lifecycle.

### Still deferred

- Multi-warehouse/bin inventory, supplier invoicing/accounting, camera-based barcode recognition, external road routing/ETA, and continuous driver maps remain separate provider/operations phases.

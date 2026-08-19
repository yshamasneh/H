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

## 2026-08-08: Phase 14 — Customer Experience (address book and device push registration)

This phase's migration and code existed in the pushed branch but were never written up here; this entry closes that documentation gap as part of the 2026-08-09 branch integration below.

### Repository implementation: Completed

- Added a per-user saved-address book (`Address`: label, address line, latitude/longitude, one default) with full CRUD under a new `users` module (`GET/POST /users/me/addresses`, `PATCH/DELETE /users/me/addresses/:id`), plus `GET/PATCH /users/me` and `DELETE /users/me`.
- Added `PushToken` (device token, platform, active flag, last-registered time) with `POST/DELETE /users/me/push-tokens`, so a device can register/unregister for push delivery. No push provider is wired to send anything yet — this is registration/storage only, matching the standing "device push is out of scope" boundary from Phase 7; sending pushes remains a separate future integration.
- Added `Order.customerNote` (free-text note from the customer at checkout) and `DriverProfile.lastLocationAt` (timestamp of the driver's most recent location update).
- Added a mobile `account-screen.tsx` (manage saved addresses, set default, delete account) and `core/push-notifications.ts` (device token registration flow).
- Migration `20260808140000_phase14_customer_experience` is additive only (two new tables, two nullable columns) — no destructive changes to existing data.

## 2026-08-09: Integrating a teammate's branches (Phases 8 through 14) into the default branch

Three remote branches (`agent/phase-8-production-release`, `agent/phase-14-15-completion`, `agent/mobile-navigation-and-portal`) were fetched, read commit-by-commit (diffs, not just messages), and integrated. Full reasoning, the branch-relationship findings, the phase-numbering reconciliation, and the scope-expansion note are in `docs/decisions.md` — this entry covers what changed mechanically.

### Completed

- Confirmed all three branches form a single straight line with zero divergence from this repository's prior tip (`c0d0be2`, end of Phase 7): `phase-8-production-release` → `phase-14-15-completion` (one more commit on top) → `mobile-navigation-and-portal` (literally the same commit as `phase-14-15-completion`, confirmed by an empty `git diff` in both directions). Integrated via a plain fast-forward merge (`git merge --ff-only`) — no conflicts, because there was nothing to reconcile.
- Verified the incoming branch independently, in an isolated `git worktree`, before touching the working directory. Found and fixed one real bug: `apps/mobile/tsconfig.json` was missing `"moduleSuffixes": [".native", ".web", ""]`, so plain `tsc` failed to resolve the new platform-split `location-map` component (2 `TS2307` + 2 downstream `TS7006` errors). This is the standard TypeScript ≥4.7 fix for React Native's `.native`/`.web` file-splitting convention.
- Also fixed a small pre-existing issue from this project's own Phase 7: two unrelated DTOs were both named `AdminActionReasonDto` (in `drivers.dto.ts` and `restaurants.dto.ts`), which NestJS/Swagger warns about at boot. Renamed the restaurant one to `RestaurantAdminActionReasonDto`.
- Fixed `.github/workflows/ci.yml`'s push trigger, which only listed `main` — a branch that has never existed in this repository — to also include `agent/customer-phone-auth`, the actual default/HEAD branch, so CI will run on a normal push here.
- Applied all 7 pending Prisma migrations (`public_offers` through `phase14_customer_experience`) to the live local PostgreSQL database via `prisma migrate deploy`; confirmed via `prisma migrate status` ("Database schema is up to date!") and directly via `psql \dt`, which now lists 24 tables including `Offer`, `Address`, `PushToken`, `Supplier`, `PurchaseOrder`, `PurchaseOrderItem`, `InventoryMovement`, and `FulfillmentAdjustment`. Re-ran the idempotent seed script afterward, which added an approved demo supermarket (`+970590000004`, 3 departments, 5 products, a supplier, and a draft purchase order) and an approved demo driver (`+970590000003`) without duplicating or disturbing any existing seeded/test data.

### Verified (after the merge, in the real working directory — not just the throwaway worktree)

- `npm run lint`, `npm run typecheck`: pass clean across all three workspaces (API, admin, mobile).
- `npm test`: **121/121 API tests pass** (1 additional test skipped by design — the opt-in database E2E test, gated behind `RUN_DATABASE_E2E=true`) and **23/23 mobile tests pass**.
- `npm run build`: all three workspaces build successfully — API (`prisma generate` + `tsc`), `apps/admin` (`vite build`), and mobile (`expo export --platform all`, which now also produces a **web** bundle in addition to Android/iOS — the mobile app can run in a browser, a capability introduced by this branch).
- `npx prisma validate`: passes. `npx prisma migrate status` against the live database: "Database schema is up to date!"
- `npm run test:e2e` (the opt-in, real-Postgres HTTP E2E test): **passes**, run against the live local database after migrations were applied. It exercises the complete four-role order lifecycle plus grocery fulfillment/substitution review, inventory reservation and restock, and supplier purchase-order receiving together in one real session, and its cleanup left all pre-existing data untouched (confirmed by row counts before/after).
- Manually confirmed the running API correctly serves the new endpoints against the live database: `GET /api/v1/restaurants` and `GET /api/v1/supermarkets` now correctly return separate lists (the demo restaurant only appears under restaurants, the demo supermarket only under supermarkets), matching the new `BusinessType` boundary.
- Searched the full merged codebase for a "cost price vs. sale price / margin / 3-way profit-split" feature that was asked about during this integration. It does not exist in any of the three branches. The only related concept is Phase 13's supplier-procurement cost tracking (`PurchaseOrderItem.unitCostMinor`), which is unrelated to a customer-facing margin or platform/restaurant/driver profit split.

### Corrected phase status

Phases 0 through 14 are implemented, tested, and documented (Phase 14's write-up was backfilled by this entry, above). There is no Phase 15 anywhere in the codebase, its migrations, or its documentation, despite the `phase-14-15-completion` branch name — see `docs/decisions.md` for the full reconciliation.

### Remaining before further work

- Everything listed as "Still deferred" / "Deferred after Phase N" in each phase section above remains genuinely open (multi-warehouse inventory, road-routing/ETA, camera barcode scanning, automatic substitution selection, external OTP/error-tracking/monitoring vendor selection, and the external, non-code launch gates in Phase 8's own section).
- The transitive `js-yaml` high-severity advisory via `@nestjs/swagger@11.4.5` (pre-existing since Phase 3, unrelated to this merge) is still open; `npm audit fix --force` would resolve it by bumping `@nestjs/swagger` to `11.4.6`, not yet applied.
- No production OTP/error-tracking/monitoring vendor has been selected; Phase 8's webhook adapters are ready but unconfigured.
- The "cost price vs. sale price / margin / 3-way profit-split" feature discussed during this integration has not been implemented anywhere and would need its own design (which party's cost, how the split is computed, where it is displayed) before implementation.

## 2026-08-09: Admin dashboard — Arabic-default RTL i18n

`apps/admin` had zero i18n infrastructure before this entry (confirmed by grep — no hits for `i18n`, `useTranslation`, `dir=`, etc.). It now defaults to Arabic with a full RTL layout, with English as a switchable option persisted in `localStorage`. Full reasoning, including the corrected finding that `apps/mobile` has **no** i18n either (contrary to the premise that admin should "match" it), is in `docs/decisions.md`.

### Completed

- Added `i18next` + `react-i18next`; created `apps/admin/src/i18n/` with `ar.json`/`en.json` translation resources (namespaced per page: `common`, `status`, `role`, `layout`, `login`, `dashboard`, `restaurants`, `restaurantDetail`, `orders`, `orderDetail`, `drivers`, `users`, `auditLog`, `reasonModal`).
- All 9 pages (`LoginPage`, `DashboardPage`, `RestaurantsPage`, `RestaurantDetailPage`, `OrdersPage`, `OrderDetailPage`, `DriversPage`, `UsersPage`, `AuditLogPage`), all 3 shared components (`Layout`, `ReasonModal`, `StatusBadge`), `auth.tsx`'s error messages, and `App.tsx`'s loading state now use `t()` — every static UI string is translated to natural Arabic, with English as the alternate.
- `document.documentElement.dir`/`lang` are set synchronously before React renders (no LTR flash on load), default to `ar`/`rtl`, and update live when the sidebar language switcher is used. Choice persists in `localStorage` across reloads.
- Fixed the only 3 physical-direction CSS declarations in `styles.css` (`text-align: left`, `border-left`/`margin-left`/`left` on the audit-log timeline) to logical properties (`text-align: start`, `border-inline-start`, `margin-inline-start`, `inset-inline-start`) so RTL mirrors without duplicate override rules.

### Verified

- `tsc --noEmit` (typecheck) passes clean.
- Started the real dev server and visually verified in Chrome, logged in as the seeded admin account: login screen, dashboard, restaurants/orders/drivers/users/audit-log tables, and the suspend-restaurant reason modal all render correctly mirrored in Arabic (sidebar and sign-out on the right, table columns re-ordered, modal button order swapped to RTL convention). Toggled to English and confirmed the layout re-mirrors to LTR instantly; reloaded and confirmed the language choice persisted.

### Remaining before further work

- **`apps/mobile` has no i18n at all** — no library, no translation files, no `I18nManager`/RTL usage, no language switcher. Every mobile screen (customer, admin, restaurant, supermarket, driver) is hardcoded English. This was assumed already done; it is not, and needs the same treatment as this admin work (plus the added complexity that React Native's `I18nManager.forceRTL` requires an app reload to take effect on native builds, unlike the instant `dir` attribute flip available on the web).
- Backend-originated strings (API error messages surfaced verbatim via `ApiError.message`, e.g. validation errors) are not translated — they are a separate concern in `apps/api`, out of scope for a frontend i18n pass.

## 2026-08-10: Phase 15.0 — Order acceptance attribution, backup script, and the delivery minimum fee

Foundations for the admin/order-management phase, plus two owner decisions on business values. Everything here is additive: no endpoint changed meaning and no existing functionality was removed.

### Completed

- **Backup and restore scripts now work on a machine without the PostgreSQL client tools.** `npm run db:backup` previously failed twice over: it never loaded `.env` (so `DATABASE_URL` was undefined) and it shelled out to a host `pg_dump` that is not installed — the database runs in the docker-compose `db` service. `scripts/database-command.mjs` now loads the repository `.env` (real environment variables still take precedence) and resolves the client tools in three steps: an explicit `PG_DOCKER_CONTAINER`/`--container=`, then a local install, then a single running postgres container. The container path transfers the dump with `docker cp` and connects on the container's internal port rather than the published one. Restore shares the resolver and keeps its checksum verification, separate `RESTORE_DATABASE_URL`, and `--confirm-restore` guards.
- **`Order.acceptedByUserId` and `Order.acceptedAt`**, written inside the existing compare-and-swap so the winner of a contended acceptance is recorded by the same atomic write that decides it. Backfilled from `OrderStatusHistory`, which already recorded who moved an order into `ACCEPTED`. Surfaced in the admin order list and detail; business and admin views include the actor's name, customer-facing views deliberately do not.
- **Three indexes** for the queries the new-orders queue and cross-business monitor will run: `Order(restaurantId, status, createdAt)`, `Order(status, createdAt)`, `OrderStatusHistory(changedByUserId, createdAt)`.
- **`DeferredEmitter`** buffers realtime emits and flushes them only after the surrounding transaction commits. Emitting from inside `$transaction` meant a rollback could leave clients re-fetching a row that never existed. Applied across the orders, drivers, and restaurants services; the drivers service had the same problem with `emitToOrder`.
- **`DELIVERY_MIN_FEE_MINOR` raised from 500 to 1000 (5.00 → 10.00 ILS).** This supersedes the 5.00 default recorded in the Phase 10 entry above. The owner's revenue model is a 10.00 fee with the driver keeping 7.00 — exactly a 70% share — and the remaining 3.00 splitting one shekel each between the delivery-operations partner and the two platform owners. The 5.00 default was inherited, not chosen: at 70% it paid a driver 3.50 for a 15–20 minute round trip (~12 ILS/hour before fuel), which would not retain drivers. At 10.00 it is ~21 ILS/hour. Only the minimum changed; the per-kilometre rate, included distance, maximum range, and service fee are untouched.

### Verified

- `npm run typecheck` clean across all three workspaces; API 133 tests (132 pass, 1 skipped, 0 fail), mobile 23 pass; `npm run build` succeeds. `npm run test:e2e` also passes against the local database, which is what actually verifies the fee change end to end — `FREE_DELIVERY` scales with the fee, so the Phase 11 lifecycle's `discountMinor` moves from 1500 to 2000 while `totalMinor` stays 4200.
- The atomicity guarantee was checked against real PostgreSQL, not only the in-memory fake: 8 concurrent acceptance attempts on one order produced exactly one `UPDATE 1` and seven `UPDATE 0`. The test order was restored to its original state afterwards.
- `npm run db:backup` verified on the default path, with an explicit `--container=` override, and with a clear failure on a bad container name; `npm run db:restore -- --verify-only` validates checksum and archive on a real dump.

### Notes for the next phase

- The new indexes cannot be shown in use yet — with six orders PostgreSQL sequential-scans regardless of index, so an `EXPLAIN` here would be misleading.
- The compare-and-swap failure path still raises `ORDER_INVALID_TRANSITION` rather than a distinct already-handled code. That distinction lands with the multi-staff live-orders work, where a lost race first becomes reachable and the UI needs to tell the two cases apart.
- `status.PREPARING_SUPERMARKET` ("قيد التجهيز" / "Picking") was added to the admin locales but is not wired up yet; it is consumed when per-vertical order labelling lands. The restaurant label was already the correct "قيد التحضير".

## 2026-08-10: Phase 15.1 — Roles and permissions core

The permission model, its backend enforcement, and the membership table that finally allows a business to have more than one person. No UI, and no change to what anyone could already do.

### Completed

- **`Role`, `BusinessMember`, and `User.platformRoleId`.** Permissions are a `String[]` on the role rather than a join table: at this scale a join buys nothing and costs a query on every request, while still supporting arbitrary permission sets. `Restaurant.ownerUserId` is retained as the legal/billing owner; access now flows through membership rows.
- **Permission catalogue in code** (`common/authorization/permissions.ts`) — 11 platform, 10 business, 1 shared — so every `@RequirePermission` call site is compile-time checked while the database stays free-form.
- **Three seeded system roles**: `SUPER_ADMIN`, `BUSINESS_ADMIN`, `BUSINESS_STAFF`. `SUPER_ADMIN` holds every permission *implicitly* rather than by enumeration, so a permission added to the catalogue later can never accidentally exclude the platform owner.
- **`PermissionsGuard` + `@RequirePermission`**, applied to every platform-administration controller and to the business portal, orders, and inventory controllers. Business-scoped permissions are checked against the business the request resolves to — a grant in business A never satisfies a request naming business B.
- **`SystemRolesService`** reconciles the seeded roles with the catalogue on startup. Deliberately conservative: it creates missing roles and keeps `SUPER_ADMIN`'s stored list complete, but never rewrites the business roles' permissions, so granting a role a new capability stays a deliberate decision and a future roles editor will not have its changes reverted on restart.
- **Migration backfill**: the existing administrator was mapped to `SUPER_ADMIN` and every existing business owner was given a `BUSINESS_ADMIN` membership, so nothing anyone could do before became forbidden.
- **Business registration now grants membership** (`grantBusinessMembership`). Without this a newly registered business had no members at all and its own owner was locked out of the portal — see below.

### Verified

- `npm run typecheck` clean; API 167 tests (166 pass, 1 skipped, 0 fail), mobile 23 pass; `npm run test:e2e` passes; `npm run build` succeeds. 32 of the new tests cover authorization: permission resolution, per-business isolation, and a route-level matrix asserting each route is bound to the permission that protects it.
- Verified against a running server with real HTTP calls. A `BUSINESS_STAFF` account attempting a price change is refused with `403 FORBIDDEN_PERMISSION` and `requiredPermission: MANAGE_PRODUCTS`, while the same call as the owner succeeds — the §14 requirement that the API, not a hidden button, is what protects the operation.

### Caught during verification

- **The end-to-end suite failed first, and it was right to.** Registering a business through the public API created the `Restaurant` and its owner `User` but no `BusinessMember`, so the owner held no permissions inside the business they had just created and `PATCH /restaurant/me` returned 403. The migration backfill only covered businesses that already existed. Fixed in the registration transaction and covered by two unit tests so the fast suite catches it rather than only the e2e, which is skipped unless `RUN_DATABASE_E2E=true`.
- A stale API server from a previous day was holding port 3000, so several `node dist/main.js` restarts failed with `EADDRINUSE` and silently kept serving old code. Early manual results were therefore meaningless; verification was redone on a separate port. Worth remembering: check that a restart actually bound before trusting what a local server tells you.

### Remaining before further work

- **`BUSINESS_STAFF` accounts can be refused correctly but cannot yet be served.** Business resolution still runs through `requireOwnRestaurant(ownerUserId)`, so a member who is not the owner gets `404 RESTAURANT_NOT_FOUND` even for routes their role permits. Switching that lookup to membership resolution is the next phase; until then the role exists in the model but is not usable.
- Field-level price protection is not implemented: `MANAGE_PRODUCTS` currently guards the whole menu-item update, so a role with `MANAGE_PRODUCTS` but not `MANAGE_PRICES` could still change `priceMinor` through it. Item *creation* requires both. Separating the two needs a service-level check on the changed fields.

## 2026-08-10: Phase 15.2 — Membership-based business access and staff management

Makes the `BUSINESS_STAFF` role actually usable. 15.1 could refuse a staff member correctly but could not serve one, because business access was still looked up by `Restaurant.ownerUserId` and a staff account is never the owner.

### Completed

- **Business resolution now runs through membership** (`resolveMemberBusinessId`), replacing the `findUnique({ where: { ownerUserId } })` lookup in the restaurants, orders, and inventory services. `ownerUserId` is untouched and remains the owner of record. Method signatures were deliberately left alone: the services still take the acting user and resolve the business internally, which keeps the change small and keeps actor attribution working.
- **A caller with several active memberships is refused, not resolved to an arbitrary business** (`409 BUSINESS_CONTEXT_REQUIRED`). Silently picking one would be exactly the ambiguity that leaks data between tenants. Until a business selector exists, a person can hold access to only one business at a time.
- **Socket rooms are joined from memberships**, and `order.subscribe` authorization checks membership rather than ownership, so the WebSocket enforces the same tenancy rule as HTTP.
- **Business-scoped notifications** (`createBusinessNotification` + `Notification.businessId`): a new order, a fulfilment decision, and both cancellation paths now notify every active member, so the alert reaches whoever is on shift. One row per member keeps read state per person — one staff member marking a notification read must not hide it from everyone else.
- **Staff management** under `/restaurant/me/staff` (list, add, update role or suspend, remove), gated by `MANAGE_BUSINESS_STAFF`. Removal deactivates the membership rather than deleting it, so audit entries and accepted orders keep pointing at a resolvable person. The owner of record cannot be modified from inside the business, and nobody can change their own access. Only business-scoped roles are assignable from here, so `SUPER_ADMIN` can never be granted from a business screen.
- **`AuditLog.businessId`** landed earlier than planned because the staff endpoints write business-scoped audit entries. This is the column that lets a business be shown its own history.
- **Operational toggles moved to `MANAGE_ORDERS`**: closing the store and marking an item sold out are shift-level decisions. A role that can accept orders must be able to stop the flow without waiting for the owner — the alternative is orders arriving while the only person who can stop them is unreachable.
- **The `MANAGE_PRODUCTS` price leak is closed.** A role could previously change `priceMinor` through the product update without holding `MANAGE_PRICES`. The check lives in `MenuService.updateItem`, where the stored item is already loaded, so it compares against the current value: only a real change is refused, and a full edit form that always sends the price still works.

### Verified

- `npm run typecheck` clean; API 175 tests (174 pass, 1 skipped, 0 fail), mobile 23 pass; `npm run test:e2e` passes; `npm run build` succeeds.
- Verified over real HTTP on a separate port. A `BUSINESS_STAFF` account created through the new endpoint can read the business profile and order queue (both `404` before this phase), close the store, and mark an item sold out, while price changes, business settings, staff management, and inventory all return `403`.
- The price protection was verified with a custom role holding `MANAGE_PRODUCTS` and `MANAGE_MENU` but not `MANAGE_PRICES`: renaming the product succeeded, resending the unchanged price succeeded, changing the price returned `403 FORBIDDEN_PERMISSION` naming `MANAGE_PRICES`, and the stored price was unchanged afterwards.
- All verification actors, the custom role, and their audit rows were removed afterwards; user, membership, role, order and audit counts match their pre-verification values.

### Remaining before further work

- Business context is resolved twice per permissioned request: once by `PermissionsGuard` and once inside the service. Harmless at this volume, but it collapses into a single resolution when a `BusinessScopeGuard` sets the business on the request and services take it as a parameter.
- Staff onboarding creates the account with a password the business admin sets and passes on, because the platform has no email or SMS delivery. Moving an existing account between businesses is refused with `PHONE_ALREADY_REGISTERED` rather than reassigned.
- There is still no admin or business UI for any of this; staff management is API-only.

## 2026-08-11: Phase 15.6a — Integrity fixes before the accounting layer

Four defects and one business-model correction, all of which had to land before any order can produce a financial record. No accounting models were added.

### Completed

- **A cancelled order can no longer be resurrected.** `adminCancelOrder` now closes the courier task in the same transaction, and a driver's transitions are validated against the *order's* status, not only the delivery's. Previously an administrator could cancel a `READY_FOR_PICKUP` order whose delivery was already assigned, and the driver could still walk it to `DELIVERED` — the final step set the order status unconditionally. Under a live ledger that meant cash collected against an order with no financial record to explain it. Claiming a delivery is also refused when its order is no longer awaiting handover.
- **A failed-delivery state exists.** `DeliveryStatus.FAILED` and `OrderStatus.DELIVERY_FAILED`, with `failureReason`, `faultParty`, `failureNote` and `failedAt` on the delivery. Kept deliberately mechanical: the reason is recorded and a simple static map assigns a default fault, with driver-related reasons resolving to `UNDETERMINED` so nothing is attributed to a driver without a human looking. There is no per-reason liability routing yet — the state and the reason exist so the policy can be decided later without a rebuild. `DELIVERY_FAILED` is distinct from `CANCELLED` because money moves on a failed delivery and none moves on a cancellation.
- **The commission base is computable.** `Order.merchandiseDiscountMinor` and `Order.deliveryDiscountMinor` are now persisted; `PromotionCalculation` already produced the split and `Order` was collapsing it. `discountMinor` remains the total, and a CHECK constraint keeps the three reconciled. `AppliedPromotion` gained `scope` and `businessId`, so a record answers whether a business-scoped or platform-scoped offer applied without re-reading an `Offer` row that may have changed. Snapshots written before this are read back as `scope: "UNKNOWN"` rather than guessed at.
- **The service fee is gone.** Removed from pricing, the environment schema, both env examples, all quote and order totals, and the admin and mobile interfaces. Customers now pay the delivery fee only. `Order.serviceFeeMinor` is *retained* with a `0` default rather than dropped, because six existing orders genuinely charged 2.00 and rewriting what those customers paid would contradict the immutability principle the rest of this design rests on. It is no longer written, no longer returned by the API, and no longer displayed.
- **Financial foreign keys are `RESTRICT`.** `Order.customerId` and `Order.restaurantId` no longer cascade, so deleting a person or a business can never erase order history. Worth correcting an earlier finding of mine: `deleteMyAccount` was *already* anonymising rather than deleting — the cascade was the real exposure, not the deletion path.

### Verified

- `npm run typecheck` clean; API 187 tests (186 pass, 1 skipped, 0 fail), mobile 23 pass; `npm run test:e2e` passes; `npm run build` succeeds. Twelve new tests cover the resurrection guard, the failure state and its fault defaults, the discount split, offer scope, and the absence of a service fee.
- Both CHECK constraints were confirmed to reject bad data directly in PostgreSQL: a discount split that does not reconcile, and a `FAILED` delivery with no reason. `Order_customerId_fkey` and `Order_restaurantId_fkey` confirmed as `r` (restrict).
- Verified live over HTTP. A customer quote returns `subtotal + delivery − discount` with no `serviceFeeMinor` field at all. A driver reporting `FAILED` without a reason gets 400; with a reason the order becomes `DELIVERY_FAILED`, the delivery records reason, fault, note and timestamp. And the resurrection case end to end: with the driver `ON_THE_WAY`, an administrator cancelled the order, the delivery was closed automatically, and the driver's `DELIVERED` attempt returned 409 with the order still `CANCELLED`.

### Notes

- A failed delivery deliberately does **not** restore stock. The goods left the premises, and the business is paid for them under the agreed policy, so returning them to inventory would overstate stock.
- Two verification orders were created in the development database and left in place, one `DELIVERY_FAILED` and one `CANCELLED`. They are genuine records and their stock effects are explained by the `InventoryMovement` ledger; deleting them would have left inventory inconsistent.
- The mobile app's service-fee removal is in the working tree but deliberately not committed here, because those files also carry unrelated in-progress i18n work that is not mine to commit.

## 2026-08-11: Phase 15.3 — Business shell and live order intake

The screen a restaurant or supermarket actually operates from. It did not exist before this phase: business owners had only the mobile app, and there was no web interface for entering products at all.

### Completed

- **Two shells, one application.** `apps/admin` now serves both a platform shell and a business shell; which one you get follows from the account type, and every section is gated by permission. Nothing about the platform shell changed except that its navigation is now permission-filtered too.
- **`/auth/me` returns an access context** — permissions, business, and role key — so the interface stops guessing what to render and never offers a control the API will refuse. Advisory only; every operation is still authorized server-side.
- **Live Orders**: new / in progress / ready, oldest first because the oldest unhandled order is the most urgent. Order tickets carry reference, item count, total and elapsed time, and escalate visually past three minutes. One request (`GET /restaurant/me/orders/live`) rather than three, so the safety poll stays cheap; it uses the `(restaurantId, status, createdAt)` index added in 15.0.
- **The alert is driven by server state.** The loop runs while the server still reports unaccepted orders, so it stops because the order left `PLACED` — whoever accepted it, on whichever device. It is never gated on this browser having clicked something, which is what makes the two-employee case correct. Escalates to a double tone past three minutes.
- **Sound must be armed once, and says so.** Browsers refuse audio without a user gesture, so a tablet that reloads overnight would otherwise sit silent with no indication. Arming is explicit, persisted, and its state is always visible; a blocked context surfaces its own message. The tone is generated with Web Audio rather than shipped as an asset.
- **Four refresh paths**: socket event, socket reconnect, tab focus, and a 30-second poll regardless. A socket is the fast path, not the reliable one — a dropped connection would otherwise be indistinguishable from a quiet evening.
- **Order detail** with accept, reject, and advance, reusing the existing compare-and-swap. Losing an acceptance race is treated as normal rather than an error: the view re-fetches and reports who handled it. The substitution panel appears only for a supermarket.
- **Catalogue**: categories and products, create/edit/delete, availability toggles. Price inputs are disabled without `MANAGE_PRICES` and the API enforces the same rule independently. Two new guarded delete endpoints refuse to destroy history — a product that appears on any order, or a category that still holds products.
- **Inventory, suppliers and purchase orders** for supermarkets, and **staff management** using the 15.2 endpoints.

### Verified

- `npm run typecheck` clean; API 194 tests (193 pass, 1 skipped, 0 fail), mobile 23 pass; `npm run test:e2e` passes; `npm run build` succeeds.
- Verified over real HTTP with three accounts. `/auth/me` returns 11 permissions and `BUSINESS_ADMIN` for a business owner, 21 and `isSuperAdmin` for the platform admin. Three concurrent acceptances of one order produced exactly one 200 and two 409s, and the order then left the `new` group — which is precisely what silences the alert everywhere. The full catalogue lifecycle worked, and both delete guards refused: a product with eight order lines and a category still holding products.
- Verified in a real browser at 2048×926 in Arabic. The sidebar sits on the right, the queue columns read right to left with `جديدة` rightmost, and a restaurant sees no inventory section while a supermarket does — along with the SKU, barcode, and stock fields a restaurant has no use for.
- **Realtime confirmed without any browser interaction**: an order placed by `curl` appeared in the `جديدة` column on its own, and the "last updated" stamp advanced.

### What could not be verified in this environment

- **Whether sound is audible.** There is no audio capture here. What was verified is everything around it: arming flips the indicator and clears the warning, no autoplay or `AudioContext` error appears in the console, and the queue state that drives the loop behaves correctly. The tone itself needs a human with speakers.
- **Multi-device silencing** was verified through the API rather than two real browsers: the winner of a concurrent acceptance takes the order out of `PLACED`, and every client's next refresh sees an empty `new` group. Two tablets side by side would be a better test.
- Screenshot capture timed out repeatedly on heavier pages; those were confirmed through the accessibility tree instead, which also proved the layout renders once rather than twice as one truncated capture suggested.

## 2026-08-11: Phase 15.5 — Business and user creation from Super Admin

Turns the platform shell from a read-and-approve tool into one that can actually onboard.

### Completed

- **Create a restaurant or supermarket, owner account included.** `adminCreateBusiness` delegates to the existing `register` service rather than duplicating it: that path already creates the owner, the business, and the `BusinessMember` row without which the owner is locked out of their own portal — the bug the end-to-end suite caught in 15.1. A second implementation would be a second place for it to come back. The only additions are optional immediate approval and an attributed audit entry.
- **Create administrators.** An initial password is set by the creator and passed on, matching how business and driver accounts are already onboarded, since there is no email or SMS delivery. A platform role is optional at creation: an administrator with none holds no permissions and is refused by every administration route, which makes `MANAGE_ADMINS` meaningful rather than decorative.
- **Suspend and restore accounts, and assign or remove platform roles.** Suspension is deliberately not deletion — orders reference their customer and business, and a financial record must always resolve to a person. Suspending bumps the token version and revokes refresh sessions in the same transaction, so it takes effect on the caller's next request rather than whenever a token happens to expire.
- **Nobody can change their own access.** Refused by the API, not merely hidden in the interface.
- `/admin/users` moves from a single read-only listing to full management, still behind `MANAGE_USERS` with the admin-specific operations behind `MANAGE_ADMINS`.

### Verified

- `npm run typecheck` clean; API 202 tests (201 pass, 1 skipped, 0 fail), mobile 23 pass; `npm run build` succeeds. Eight new tests cover creation, duplicate phone numbers, session revocation on suspension, self-change refusal, repeated suspension, and platform-role assignment and removal.
- Verified over real HTTP. A supermarket created from the Super Admin dashboard came back `APPROVED`, and its owner could immediately sign in, read `/auth/me` with `BUSINESS_ADMIN` and 11 permissions, and open both the live queue and the inventory section — the membership row was there.
- A newly created administrator with no platform role was refused `/admin/users` with 403; after being granted `SUPER_ADMIN` the same route returned 200. Suspending them turned their existing token into a 401 immediately and blocked a fresh login with 403. An attempt to suspend one's own account returned `409 ADMIN_SELF_CHANGE`.
- All verification accounts, the created business, and their audit rows were removed afterwards; user, business, membership, role and order counts match their pre-verification values.

### Notes

- A build failure caught a field that a guard clause had silently skipped adding, after a typecheck chain had short-circuited without printing its failure. Worth remembering that `cmd && echo OK` prints nothing on failure, which reads too much like success.

## 2026-08-11: B1 — JOVO design tokens and typography

The token layer and the type system everything downstream will consume. No screen was redesigned; the visible change comes entirely from tokens replacing hardcoded values.

### Completed

- **Self-hosted Cairo and Inter.** Six woff2 subsets (232 KB total) served from `apps/admin/public/fonts`, declared with `@font-face` directly in `styles.css`. Cairo carries Arabic, Inter carries Latin, and each face declares a `unicode-range` — so the browser picks per character and a mixed "JOVO / جوفو" string sets correctly with no markup. No CDN request, no npm dependency, no third-party at runtime. OFL notice included.
- **Complete token layer**: brand, warm-biased neutrals, five semantic families, an 8-step type scale, a 4px spacing scale, four radii, three elevations, and motion tokens. **Zero hardcoded colours and zero hardcoded font sizes remain outside the token block**, down from 15 colours and 13 sizes.
- **Arabic typographic metrics as first-class**, applied through a `[dir="rtl"]` token override rather than a duplicated scale: leading 1.85 against Latin's 1.55, tracking forced to zero because Arabic letters join and tracking breaks them, a +1px optical bump because Arabic has no cap height, and `text-transform` disabled because Arabic has no letter case.
- **Status colours reorganised into five families**, only one of which is orange. `PLACED` is the attention state; everything in flight is blue. `DELIVERY_FAILED` and `FAILED` were missing from the palette entirely and rendered as neutral grey — a failed delivery looked exactly like a driver being off shift. Both now read as errors.
- **The new-order ticket is the only orange object on the queue board**, so "is there anything new" is answered by colour before any text is read. The reference moved to display weight, and the elapsed time escalates to red past three minutes.
- `prefers-reduced-motion` honoured globally.

### Verified

- `npm run typecheck` clean; API 202 tests (201 pass, 1 skipped, 0 fail), mobile 23 pass; `npm run build` succeeds.
- Verified in a real browser in **both languages**. Arabic renders in Cairo with correct RTL mirroring; English renders in Inter with the sidebar on the left and the queue columns reading left to right. Font files confirmed served with HTTP 200.
- Before and after captured: the same login screen previously rendered Arabic in Tahoma on a dark navy gradient, and now renders in Cairo on a light surface with the JOVO orange action.

### Notes

- The login screen and sidebar changed surface colour as a direct consequence of tokenisation — the dark gradients were hardcoded values with no equivalent in a light-only system. The remaining shell work (sidebar structure and density) is B3.
- Three inline `style` objects carrying colour or font size were replaced with classes. The remaining inline styles are layout nudges only and are cleaned up in B4.

## 2026-08-12: B2 — JOVO name, mark, and native identifiers (mobile only)

The mobile app now calls itself JOVO everywhere a person can see, and the Android
project is built as `com.jovo.app`. Scope was `apps/mobile` only; `apps/admin`
was deliberately not touched, and no file outside `apps/mobile` changed except one
`.gitignore` line for `__pycache__`.

Two commits, in this order, so the risky half has a clean fallback:

1. `df6a922` — user-facing rename and logo assets.
2. (this commit) — native identifiers and the regenerated `android/`.

### Completed

- **User-facing rename only.** Screen text, both locale trees, and app metadata.
  Database tables, model names, API routes, i18n *key* names, the internal
  `TasawaQApp` component, the `tasawaq.push-token` key and the
  `tasawaq-location-map` broadcast channel are all unchanged, as are the
  `wasel_access_token` / `wasel_refresh_token` / `wasel_language` storage keys —
  renaming those would sign every existing user out for a change none of them
  would see. The supermarket vertical reads `JOVO MARKET` / `جوفو ماركت`.
- **The logo is generated, not drawn** (`apps/mobile/scripts/generate-logo.py`),
  so every size comes from one source of truth and can be re-rendered. The V's
  outer edges are tangents to a round head and converge on a single point that
  drops below the baseline — a location pin's profile. The shoulders are cut flat
  above the head's widest point; letting them curl over turns the shape into a
  heart, which four intermediate renders confirmed before this one was chosen.
- **Different assets for different slots, deliberately.** The wordmark is for
  in-app use. The app icon and the *native* splash use the mark alone: four
  letters are unreadable at 48px, and Android 12+ masks the splash icon to a
  circle showing only the inner two thirds, which would have clipped the wordmark
  to "OV". The full wordmark still appears on the JS splash that follows.
- **Native identifiers**: `com.jovo.app` (namespace, applicationId,
  bundleIdentifier), slug `jovo`, scheme `jovo`, `rootProject.name` and
  `app_name` `JOVO`, Kotlin package path `com/jovo/app/`. `android/` was
  regenerated with `expo prebuild --platform android --clean`.
- **Splash treatment** is now white with the orange mark, replacing `#F5FAFC` in
  `colors.xml`, `styles.xml`, and the JS splash in `App.tsx`.
- **An adaptive icon was added.** Without one, the launcher scales and crops the
  full-bleed 1024 icon badly; the foreground is now sized to the centre safe zone.

### Regeneration side effects that were corrected, not accepted

`expo prebuild --clean` resets the whole directory, and the previous `android/`
carried hand-made choices with no app.json equivalent. These are re-applied by
`apps/mobile/scripts/post-prebuild.py`, **which must be run after every future
prebuild**:

- `android.enableMinifyInReleaseBuilds` and
  `android.enableShrinkResourcesInReleaseBuilds` were dropped; both restored.
- `EX_DEV_CLIENT_NETWORK_INSPECTOR` was flipped back to `true`; restored to
  `false`.
- The template re-added `signingConfig signingConfigs.debug` to the **release**
  build type, which would sign a release APK with the checked-in debug keystore.
  Removed again.

Adopting `expo-build-properties` would move the gradle.properties values into
app.json and let them survive prebuild unaided. That is a dependency change and
was left out of B2.

### Two changes that came from regeneration and are worth a decision

- **`CAMERA` and `RECORD_AUDIO` permissions appeared.** The committed `android/`
  predated `expo-camera`, so it was stale rather than minimal. `CAMERA` is real —
  barcode scanning. `RECORD_AUDIO` is pulled in by `expo-camera` and is not used,
  so it was added to the existing `blockedPermissions` list, matching the intent
  already expressed there. Worth confirming that barcode scanning still works on
  a real device.
- **`android:usesCleartextTraffic="false"` is no longer emitted** into the main
  manifest. Setting `android.usesCleartextTraffic: false` in app.json does not
  produce the attribute. The effective behaviour is unchanged, because the
  platform default is already `false` above API 28 and the debug manifest still
  overrides it to `true`, but the intent is now implicit rather than written down.

### Verified

- `npm run typecheck` clean; mobile tests 23 pass, 0 fail.
- **Verified in a real browser in both languages** against a running API, at the
  login screen: the JOVO wordmark renders in orange, correctly oriented, and
  **does not mirror in RTL** — the J stays on the left in Arabic exactly as in
  English, while the surrounding layout flips correctly (labels right-aligned,
  `+970` on the right). The browser tab title reads `JOVO`, confirming the
  metadata rename reached the web target.
- **Small sizes were checked before the shape was committed to**, by rendering
  the wordmark at 48, 32, 24 and 16px and the icon at 192, 96, 72, 48, 36 and
  24px. The wordmark stays readable to 16px; the mark stays legible to 24px.
- **Both square assets were checked under a circular mask**, which is how
  Android 12+ draws the splash icon and how most launchers draw the icon. Neither
  is clipped.
- `expo prebuild` output inspected file by file against the previous `android/`;
  the only content differences are the identifiers, the splash colours, and the
  manifest changes listed above.

### The Android build was NOT verified — do this first

**`./gradlew :app:assembleDebug` never completed in this session.** It was
started twice and killed both times by the session ending, not by a build
failure: no error was produced, no APK exists, and `android/app/build/` was
never created. What it did reach on the first attempt is that Gradle configured
the project, resolved dependencies, and got as far as compiling the included
React Native and Expo gradle plugins — so `settings.gradle` and the rename are
not obviously broken. That is *evidence*, not verification.

Both attempts were slow for an environment reason worth knowing: `JAVA_HOME`
points at `C:\Program Files\Android\Android Studio\jbr`, which does not
exist on this machine. Temurin JDK 21 at
`C:\Program Files\Eclipse Adoptium\jdk-21.0.9.10-hotspot` works and is what
both attempts used. On the first attempt the Kotlin compile daemon also failed
to connect and fell back to in-process compilation.

Run this before trusting the rename:

```sh
cd apps/mobile/android
JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.9.10-hotspot"   ./gradlew :app:assembleDebug
```

If it fails on the Kotlin package path, the suspects are
`app/src/main/java/com/jovo/app/*.kt` and `namespace` in `app/build.gradle`.

### What could NOT be verified in this environment

- **Anything behind the login screen.** Reaching the customer home, the
  supermarket header (`JOVO MARKET` / `جوفو ماركت`), and the admin badge requires
  authenticating, and entering an account password is not something this agent
  will do. The strings and the image sources are wired correctly and typecheck,
  but nobody has *looked* at those three screens. **Check them on the device.**
- **The app icon and splash on a real launcher.** They were verified as images
  and under a simulated circular mask, not on a device.
- **iOS entirely.** Only `android/` was regenerated; `ios/` is not in the repo.

## 2026-08-12: B3 — Port the JOVO token system to mobile (in progress, stopped for context)

Scope was `apps/mobile` only, per the standing instruction; `apps/admin` and
`apps/api` were not touched. Everything below is committed on
`agent/phase-15-and-jovo-brand`, one commit per file/group, working tree clean
at each commit.

### Completed

- **Built the token layer**: `src/theme/tokens.ts` (colours, 4px spacing scale,
  radii, elevation, motion, `statusFamily`/`statusPalette` for the five status
  families, `iconSize` for decorative/glyph sizing, `withAlpha()` for the rare
  translucent spot), `src/theme/typography.ts` (RTL-corrected `text(role,
  weight)` returning `fontSize`/`lineHeight`/`letterSpacing`/`fontFamily`/
  `writingDirection`), `src/theme/fonts.ts` (`useAppFonts()` via `expo-font`).
  Palette, spacing, radii and the five status families are numerically
  identical to `apps/admin/src/styles.css` — same brand, same system.
- **Self-hosted Cairo and Inter as static TTFs** (`apps/mobile/assets/fonts/`,
  `OFL.txt` included): downloaded the upstream *variable* fonts from
  `google/fonts` and instanced 400/600/700 with `fontTools.varLib.instancer`
  (Cairo pinned `slnt=0`, Inter pinned `opsz=14`), since RN font loading wants
  plain static instances rather than a variable-font renderer. `expo-font` was
  promoted from a transitive dependency to an explicit one
  (`apps/mobile/package.json`, `~14.0.12`, matching the installed SDK-54
  version) — a real dependency change, called out here since it's the one this
  phase added.
- **`App.tsx`** now calls `useAppFonts()` and keeps the splash screen up until
  both the 3s minimum *and* fonts are ready (a `fontError` still releases the
  gate rather than hanging), so no screen flashes in the system font before
  Cairo/Inter finish loading.
- **`customerTheme` (`features/customer/theme.ts`) is now a thin adapter over
  the tokens** — every value is a reference into `theme/tokens.ts`, not a
  literal. Two names that predate the JOVO palette don't map 1:1 and are
  documented inline: `secondary` (was a dark teal price accent, now points at
  `text` — JOVO has no secondary brand hue) and `surfaceMuted` (was an
  orange-tinted placeholder background, now points at the neutral
  `surfaceSunk`, since orange is deliberately scarce and a thumbnail
  placeholder isn't a call to action).
- **16 of 18 screen files with hardcoded colour are fully migrated** (zero
  hardcoded hex, zero bare font sizes — verified after every file with
  `grep -n "#[0-9A-Fa-f]\{3,8\}"` returning nothing and a clean
  `npm run typecheck --workspace=@wasel/mobile`):
  - `features/admin/ui.tsx` + `offers-screen.tsx` — the shared business/admin
    UI kit, which carried 6 more screens (dashboard, restaurants, drivers,
    orders, users, audit-log) onto tokens for free since they only consume
    `ui.tsx`'s exports and had no hex of their own.
  - `i18n/LanguageSwitcher.tsx`, `components/location-map.native.tsx` +
    `.web.tsx`.
  - `features/customer/account-screen.tsx`, `home-screen.tsx`,
    `restaurant-screens.tsx`, `supermarket-screens.tsx`, `cart-screens.tsx`
    (cart/checkout/history/detail).
  - `features/auth/screens.tsx` (login/signup/OTP/home) and
    `role-registration-screens.tsx` — these carried the *old* teal palette
    (`#0F766E`/`#F5FAFC`) completely untouched by the earlier customer-side
    rebrand, i.e. exactly the audit's "a driver and a customer are visibly
    using different products" finding, and every role passes through login.
  - `features/driver/screens.tsx`, `features/shared/notification-screens.tsx`,
    `features/restaurant/inventory-screen.tsx`.
  - Along the way, two screens (`cart-screens.tsx`'s `OrderDetailScreen` and
    `driver/screens.tsx`'s delivery detail) had their own local copy of a
    status→colour switch statement, duplicating `tokens.ts`'s
    `statusFamily`/`statusPalette`. Both now import the shared one — order and
    delivery status colour is computed in exactly one place across the app.
  - Also, both `home-screen.tsx` and `restaurant-screens.tsx` had an
    orange/green placeholder-thumbnail colour alternation on cards with no
    photo; both were unified to one neutral tint (the split served decoration,
    not meaning).
- **`npm run typecheck` and `npm test` (23/23) pass** after every single
  file-level commit, not just at the end — verified as part of the workflow,
  not after the fact.

### Remaining before B3 is done

Two files still carry the old teal palette in full, both restaurant/business
operator screens, both **not yet started**:

- **`apps/mobile/src/features/restaurant/order-screens.tsx`** (~569 lines, 68
  hardcoded hex values) — the restaurant's incoming-order queue and order
  detail/status-transition screens. Note: this is also B5's "live queue" —
  tokenizing it now is still worth doing (mechanical colour/size correctness),
  but expect B5 to substantially restructure its layout regardless (larger
  type, louder new-order card), so don't over-invest in polishing this pass.
- **`apps/mobile/src/features/restaurant/management-screen.tsx`** (~637 lines,
  51 hardcoded hex values) — restaurant/supermarket profile, categories, menu
  items, staff management.

Both follow the exact same pattern as every file already migrated this
session (confirmed by reading both — same `"#0F766E"`/`"#F5FAFC"`/`"#FFFFFF"`-
family palette, same inline `StyleSheet.create` shape, same
`ActivityIndicator color="#0F766E"` / `StatusBar backgroundColor="#F5FAFC"`
spots to fix). The mechanical recipe that worked for all 16 prior files:

1. Add the import: `import { colors, radius, spacing, statusFamily,
   statusPalette as tokenStatusPalette } from "../../theme/tokens";` and
   `import { text } from "../../theme/typography";` (only pull in
   `statusFamily`/`tokenStatusPalette` if the file has its own status-colour
   switch to delete — check first with `grep -n "case \"PLACED\"\|case
   \"PENDING\""`).
2. Fix JSX-level literal props one at a time (`StatusBar backgroundColor=`,
   `ActivityIndicator color=`, `RefreshControl tintColor=`,
   `placeholderTextColor=`) — these are usually only 3-6 spots per file.
3. Rewrite the trailing `const styles = StyleSheet.create({...})` block in one
   `Edit` call: every colour → the matching `colors.*` token (surface→surface,
   text→text, muted→textMuted, borders→border/borderStrong, the teal brand
   colour→`colors.primary`/`primaryPressed`/`primarySubtle`, status greens/
   reds/ambers→`colors.success…`/`error…`/`warning…`), every `fontSize`+
   `fontWeight` pair → `...text(role, weight)` (role by visual hierarchy: page
   titles `h1`/`h2`, card titles `h3`, body copy `body`/`bodySm`, small meta
   `caption`, tiny labels/badges `label`), every spacing/margin/padding number
   → the nearest `spacing[1..10]` (4/8/12/16/20/24/32/40/48/64), every
   `borderRadius` → `radius.sm/md/lg/pill` (6/10/14/999). Decorative emoji/icon
   glyph sizes (not real text) → `iconSize.xs..xxxl` instead of `text()`.
4. Verify: `grep -n "#[0-9A-Fa-f]\{3,8\}" <file>` returns nothing,
   `npm run typecheck --workspace=@wasel/mobile` is clean,
   `npm run test --workspace=@wasel/mobile` still shows 23/23.
5. Commit that file alone before moving to the next.

After both files: re-run the repo-wide audit to confirm zero hardcoded hex
remains outside `theme/tokens.ts` itself:

```sh
cd apps/mobile/src && grep -rlE "#[0-9A-Fa-f]{3,8}\b" --include=*.tsx --include=*.ts . | grep -v theme/tokens.ts
```

It should print nothing. Only then is B3 actually complete — commit, report to
the user what was verified and how (this doc plus `npm run build` — the mobile
build (`expo export --platform all`) has **not** been run this session and is
worth doing once B3 closes, to catch anything the typecheck alone wouldn't).
Then move to B4.

### Judgment calls made this session (worth knowing before continuing)

- Auth's secondary/link buttons were changed from orange-outline/orange-text
  to neutral (border `borderStrong`, text `text`/`textMuted`). With the
  primary button now solid JOVO orange, every other button also being orange
  violated "orange is scarce, one primary action per screen." Expect this
  pattern (primary = orange fill, everything else = neutral) to recur in the
  two remaining files and in B4's component pass generally.
- Where a dark panel needed text hierarchy (home screen's hero/offer cards,
  supermarket headers), used `withAlpha(colors.textInverse, 0.55|0.72|1)`
  rather than inventing new tint tokens — mirrors how admin's own dark sidebar
  does it in `styles.css` with raw `rgba(255,255,255,X)`, which isn't
  tokenized there either.
- `iconSize` (a second, smaller scale) was added for decorative glyphs/emoji
  placeholders that aren't linguistic text (back-chevrons, product-photo
  stand-in emoji) — they don't want the Arabic optical-size correction real
  type gets from `theme/typography.ts`.

### What could NOT be verified this session

- **No visual verification at all** — no dev server / Expo web export was run
  this session, so nothing above has been *looked at*, only typechecked and
  hex-grepped. That should happen before or immediately after finishing the
  last two files: `cd apps/mobile && npx expo start --web` (or `npm run
  build:web`) and check at minimum the login screen (teal→orange should be
  obvious), the customer home screen, and one business-operator screen in both
  languages.
- **No Android build** — unrelated to this session's changes but still true
  from B2: `./gradlew :app:assembleDebug` has still never completed in this
  environment.

### Prompt for the next session

```
Continue B3 (apps/mobile ONLY, same scope rule as before — do not touch
apps/admin or apps/api) on branch agent/phase-15-and-jovo-brand. Read
docs/progress.md's "B3 — Port the JOVO token system to mobile" entry first;
it documents 16/18 files done and the exact mechanical recipe for the last
two: apps/mobile/src/features/restaurant/order-screens.tsx (68 hardcoded hex)
and apps/mobile/src/features/restaurant/management-screen.tsx (51). Migrate
both onto src/theme/tokens.ts and src/theme/typography.ts following that
recipe, verify with the grep/typecheck/test commands listed there, commit
each file separately, then run the repo-wide zero-hex audit. Once B3 is
fully done, do a first visual pass (expo web export, both languages) before
starting B4. Then continue through B4-B8 per the original task instructions.
```

## 2026-08-12: B3 complete, plus the visual pass that found three real RTL bugs

Finished the two remaining files, then did the visual pass this doc's previous
entry flagged as not yet done — and it was right to insist: three real,
user-visible bugs existed that no amount of typechecking or grepping would
ever have caught, all specific to the web target. All fixed and committed on
`agent/phase-15-and-jovo-brand`.

### B3 completion

- `features/restaurant/order-screens.tsx` (68 hex) and
  `features/restaurant/management-screen.tsx` (51 hex) migrated using the
  exact recipe from the prior entry — both had their own duplicated
  status-colour switch statement (order-screens) or approval-status pill
  (management-screen), both now read from the shared
  `statusFamily`/`statusPalette` in `theme/tokens.ts` instead.
- Repo-wide audit confirmed clean:
  `grep -rlE "#[0-9A-Fa-f]{3,8}\b" apps/mobile/src | grep -v theme/tokens.ts`
  returns nothing. All 18 files, zero hardcoded hex, zero bare font sizes.
  `npm run typecheck` and `npm test` (23/23) clean throughout.

### The visual pass — three real bugs found and fixed

Set up a real browser session against the Expo web export (`npx expo start
--web`) with a live PostgreSQL-backed API, logged in as the seeded customer,
driver, and restaurant-owner accounts (`+970590000000/2/3`, all
`Test@12345`), in both languages. Everything below was *seen*, not inferred.

1. **Arabic text was silently rendering in Inter, not Cairo, at English
   line-height, on every screen, on web.** `theme/typography.ts`'s `text()`
   reads direction inside module-scope `StyleSheet.create()` blocks that
   every screen evaluates once at import time, before React ever mounts.
   `react-native-web`'s `I18nManager` is a stub (confirmed by reading
   `node_modules/react-native-web/dist/exports/I18nManager/index.js` —
   `allowRTL`/`forceRTL` are no-ops, `isRTL` is hardcoded `false` forever),
   so the direction was permanently wrong on web regardless of app state.
   Root-caused via `getComputedStyle()` on a live Arabic heading, which
   showed `fontFamily: Inter-Bold` and LTR line-height on a page whose `dir`
   attribute correctly said `rtl`. **Fixed** by making `theme/tokens.ts`'s
   `isRTL()` read the document's own `dir` attribute on web instead of
   `I18nManager.isRTL`; added `src/i18n/rtl-preset.ts`, imported first in
   `index.ts` (before `App`, before any screen), which sets that attribute
   synchronously from stored language so it's correct before any module's
   styles are built; `reconcileRTL`'s web branch now also triggers a reload
   on an actual language switch, matching native's contract, since these
   module-scope styles need a clean re-evaluation rather than a live patch.
2. **Absolute-positioned elements (`end`/`start`) didn't mirror in RTL on
   web** — confirmed visually on the restaurant menu screen: the back button
   and the favourite-heart icon were both on the wrong side. Root-caused by
   reading `react-native-web`'s source further: `end`/`start` compile to the
   CSS logical properties `insetInlineEnd`/`insetInlineStart`, but their
   *resolved physical value* depends on an internal `LocaleContext` that
   defaults to `"ltr"` unless some ancestor element carries an explicit
   `dir` **prop** (not attribute) — `exports/createElement` wraps any
   `dir`-bearing element in a `LocaleProvider` for exactly this reason nothing
   in the app ever did. Flex-based mirroring (`flexDirection: "row"`,
   `textAlign`, `marginStart`) was unaffected because the browser's own CSS
   bidi engine resolves those from the `dir` *attribute* directly, with no
   react-native-web involvement — which is why this was invisible until an
   absolutely-positioned element was actually looked at. **Fixed** with a
   small `RTLRoot` wrapper in `App.tsx` that passes `dir` down from the live
   `i18n.language`, wrapping the entire app once.
3. **Five hardcoded "‹" back-chevron glyphs (plus one "›" disclosure
   chevron) didn't flip direction** even after fix #2 made their *position*
   correct — a right-positioned back button pointing left reads as visually
   inconsistent. Fixed in `account-screen.tsx`, `cart-screens.tsx`,
   `restaurant-screens.tsx` (×2), `supermarket-screens.tsx`, and
   `home-screen.tsx`'s market banner, all now `isRTL() ? "›" : "‹"` (or the
   reverse for the disclosure chevron).

All three fixes verified by reading computed styles live in the browser
(`getComputedStyle`), not just by re-screenshotting — `fontFamily:
"Cairo-Bold"`, `lineHeight: "29px"` (20 × 1.45, the RTL heading multiplier),
and the back button rendering top-right with a right-pointing glyph,
consistently, across a full page reload with no infinite-reload regression
(an earlier attempt at fix #1, using `I18nManager.isRTL` for the
already-changed? check, caused exactly that loop before the `dir`-attribute
comparison replaced it — caught by watching the console for a repeating
"Running application" log, not assumed away).

### Also fixed during the pass (not bugs, but visibly wrong once seen)

- Customer home screen's quick-actions row (account/orders/notifications/
  sign-out) was four orange icons in a row — none of them the screen's
  primary action, which is exactly what "orange is scarce, one primary
  action per screen" rules out. Changed to neutral (`colors.text`).

### Confirmed working correctly (not just typechecked)

Login (both languages) → customer home → restaurant browse → menu → add to
cart → cart screen → account (profile, saved addresses with the Leaflet map,
language switcher, notification toggle, delete-account danger styling) →
driver home → delivery dashboard → restaurant-owner home → incoming orders
list. Status badges read from the shared token palette everywhere checked.
Empty states already have guiding copy in the screens touched this session
(e.g. "You have no active deliveries" / "Turn on connection to see and
accept deliveries" on the driver dashboard) — not yet audited screen-by-screen,
that's B4's job.

### Found and confirmed real, left for B4 (not fixed here — out of scope for
a visual-verification pass, and exactly what B4 is for)

- **API errors reach the user in English inside the Arabic UI**, confirmed
  live: a wrong-password login attempt in Arabic showed
  `Invalid phone number or password.` verbatim in English. This is the exact
  audit finding B4's brief names.
  - **What actually needs to happen**: this is a backend-message localization
    gap, not a frontend copy fix. Every mobile screen's error handlers do
    `catch (error) { setError(readError(error)) }`, and every `readError`
    helper across all ~18 files does the same thing: `error instanceof
    ApiError || error instanceof Error ? error.message : <localized generic
    fallback>` — i.e. it displays `apps/api`'s raw English `message` field
    verbatim whenever the error has a recognizable shape, which is every
    real API error. `apps/api` is out of scope for this design pass, so B4
    cannot translate the messages at the source. The fix has to live in
    `apps/mobile`: build an Arabic/English translation table keyed by
    `ApiError.code` (`PHONE_ALREADY_REGISTERED`, `ACCOUNT_NOT_FOUND`,
    `ORDER_INVALID_TRANSITION`, etc. — grep `apps/api/src` for
    `throw new ApiError` / equivalent to enumerate the actual set), with the
    existing English `message` as the fallback for any code not yet in the
    table, and swap every screen's `readError`-equivalent to consult it
    instead of returning `error.message` directly. Given there isn't one
    shared `readError` today — it's duplicated per-file, sometimes as
    `readError`, sometimes `readRegistrationError`, `readAdminError`, etc. —
    this is also a natural point to consolidate them into one shared
    `src/core/errors.ts` while fixing this, rather than patching N
    near-duplicate copies.
- **Missing Arabic translation for at least one status key**: the
  restaurant-owner's order list showed a raw `DELIVERY FAILED` badge in
  English inside the Arabic UI (the `t("status.DELIVERY_FAILED", ...)` call
  fell through to its English-shaped fallback). `docs/progress.md`'s Phase
  15.0 entry already flagged a related gap
  (`status.PREPARING_SUPERMARKET` added to *admin's* locale but not wired
  up) — worth a full audit of `apps/mobile/src/i18n/locales/ar/common.json`'s
  `status.*` keys against every `OrderStatus`/`DeliveryStatus` enum value
  actually reachable, not just this one.
- **Seed/demo business names are pre-JOVO-rename content**: "TasawaQ Fresh
  Market" and "Wasel Demo Kitchen" render as-is on the customer home screen
  and browse lists. This is database content from `apps/api`'s seed script,
  not `apps/mobile` UI chrome — out of scope for this design pass entirely,
  flagging only so it isn't mistaken for a leftover rebrand bug later.
- Not re-verified after the B3-completion commits (order-screens.tsx,
  management-screen.tsx) specifically in the browser — typecheck/tests pass
  and the pattern matches 16 already-verified files exactly, but the
  restaurant-owner's order-detail screen (fulfillment proposal editor) and
  the full management-screen workspace (profile/categories/items tabs)
  weren distinctly loaded during this pass. Worth a quick look early in B4
  before restyling them further.

### Environment notes for next session

- `apps/mobile/.env` (gitignored, machine-local) now points
  `EXPO_PUBLIC_API_URL` at `http://localhost:3000` rather than a LAN IP that
  doesn't resolve in this environment. If a future session sees "Could not
  reach the server" immediately on login, check this file first before
  assuming an app bug.
- The Expo web dev server's `dist/` cache directory intermittently held an
  `EBUSY` lock in this environment (Windows file-lock, likely a leftover
  process) — `npx expo start --web -c` (clear cache) plus manually killing
  whatever process `Get-NetTCPConnection -LocalPort 19006` reports resolved
  it every time it came up. Always verify a dev-server restart actually
  bound to the port and served fresh HTML (`curl | grep html`) before
  trusting anything rendered in the browser — a stale process silently
  serving old code produced a very confusing hour on the RTL bug above
  before this was caught.

### Prompt for the next session (start B4)

```
Continue the JOVO design pass (apps/mobile ONLY) on branch
agent/phase-15-and-jovo-brand. B3 is fully complete and visually verified —
read docs/progress.md's "B3 complete, plus the visual pass that found three
real RTL bugs" entry first, especially the "Found and confirmed real, left
for B4" section, which has concrete starting points including a root-cause
analysis for the API-error-language bug (needs a code-keyed translation
table in apps/mobile, not a copy fix) and a status-translation audit.
Start B4 (components and states: buttons, inputs, cards, badges, modals,
toasts, list rows, tabs, status indicators; then loading/empty/error/success
states everywhere, skeletons over spinners). Verify visually in the browser
(expo web, both languages) as you go, the way B3's second half did, not just
by typecheck. Commit and report at each meaningful boundary.
```

## 2026-08-13: Release-build crash fixed; checkout crash contained but NOT fixed; design pass NOT started

Branch: `agent/phase-15-and-jovo-brand`. Everything below is committed and pushed.

### State: what is done, committed, and pushed

- `a9d589d` — **EAS release-build crash. Fixed and verified in the real APK.**
- `f5038f6` — **App-level ErrorBoundary.** Mitigation only, see below.

Working tree clean; `HEAD` == `origin/agent/phase-15-and-jovo-brand`.

### The EAS crash (done — do not re-investigate)

Every EAS Android build succeeded but the APK crashed instantly at launch:
`Error: Production builds require an HTTPS EXPO_PUBLIC_API_URL.` — a
module-level throw in `apps/mobile/src/core/api.ts` firing at import time,
before any UI, with no red box because release builds have none.

Root cause: `apps/mobile/src/env.d.ts` declared `process` as `{ env?: {...} }`
— **optional** `env`. TypeScript therefore forced every call site to write
`process.env?.EXPO_PUBLIC_API_URL`. That parses as an `OptionalMemberExpression`,
but `babel-preset-expo`'s inline-env-vars plugin
(`node_modules/babel-preset-expo/build/inline-env-vars.js:23`) registers only a
`MemberExpression` visitor. It never matched, so the value was never inlined
and was never recorded in `publicEnvVars` metadata — silently, no warning at
any log level.

This is why supplying the variable four different ways (EAS-hosted var,
`eas.json` env block, `NODE_ENV=production`, a `.env` file) all produced
identical crashing APKs: none of them were ever the problem.

Fix touches both `env.d.ts` (non-optional `env`) and `api.ts` (plain member
access). Fixing only `api.ts` fails typecheck — the type declaration is what
created the trap, so both must stay as they are.

Verified in the real artifact, not by build status: build `ef51d60a`,
downloaded the APK, extracted `assets/index.android.bundle` (Hermes bytecode,
magic `c61fbc03`), grepped it. URL literal present once; `EXPO_PUBLIC_API_URL`
present once and only inside the error message; zero surviving `process.env?.`
accesses. Previously: zero URL matches, and the un-inlined property access
present.

**Verification method that actually works** — a green build status means
nothing here, two "successful" builds still crashed:
`eas build:view <id> --json` → download `applicationArchiveUrl` →
`unzip -o apk "assets/*"` → `grep -a -o '<url>' assets/index.android.bundle`.
Note `eas build:view` does **not** accept `--non-interactive`; passing it makes
every call error out and produce no JSON.

### The checkout crash (CONTAINED, NOT FIXED — this is the next task)

Symptom: completing checkout ("confirm order" in cart) kicks the user
completely out of the app instead of showing the confirmation screen.

**Root cause is NOT known.** `f5038f6` adds an ErrorBoundary, which is a
mitigation, not the fix. The app previously had no error boundary anywhere, so
any render-time throw unmounted the entire React tree — on a release build that
presents as the app closing itself with no message.

Ruled out, with evidence — do not spend time re-checking these:

- **The order API.** Placed a real order end to end against the running API;
  returns 201 with a complete payload. (Test order `d19f0b81` exists in the
  local DB from that check — delete it if it gets in the way.)
- **Response/type mismatch.** Every field the confirmation screen and
  `OrderSummaryCard` read — `restaurant.name`, `items[].nameSnapshot`,
  `lineTotalMinor`, `appliedPromotions`, `statusHistory`, the `*Minor` totals —
  is present in the real response with the expected type.
- **`StatusBadge`.** `statusFamily()` always returns a valid family, so the
  palette lookup cannot be undefined.
- **Hermes / `Intl`.** The price and date formatters in the cart flow are hand
  rolled; no `toLocaleString`/`Intl` anywhere in that path. So this is not a
  works-on-web/crashes-on-device locale issue.
- **Socket / order-subscription.** Not connected on the confirmation path.
- **Null `delivery`.** `DeliveryProgressCard` is typed `NonNullable` and is
  guarded by its caller.

**Next step — reproduce it, do not guess.** Two options:

1. `npx expo start --web`, log in as the seeded customer, place an order, read
   the console error. (Per the B3 notes: always confirm the dev server actually
   bound and is serving fresh HTML before trusting the browser.)
2. Rebuild the APK — the installed one predates `f5038f6` and has no boundary —
   place an order on device, and **read the error straight off the boundary's
   on-screen message.** It renders `error.message` deliberately so this is
   diagnosable without wireless ADB and logcat.

Once the message is in hand the fix should be short.

### Three pending judgment calls — reasoning, so they are not blindly reverted

1. **`NODE_ENV=production` left in `eas.json`'s `preview.env`, though proven
   unnecessary.** It was added on a since-disproven theory that Metro's
   env-inlining was gated on it. It is not: inlining is gated on
   `caller.isDev` (`babel-preset-expo/build/common.js:84`), and bundling
   without `NODE_ENV` still inlines correctly (verified locally). It is also
   mildly harmful — EAS warns it makes npm install production-only packages.
   It was left in because the verified-good APK was built *with* it, and
   removing it would invalidate that verification without a fresh build.
   **Safe to remove, but re-verify with the APK grep above when you do.**
2. **`.env.production` + `.easignore` negation approach dropped in favour of
   the `eas.json` env block.** Proven unnecessary: re-bundling with
   `EXPO_NO_DOTENV=1` — so only an injected env var could supply the value —
   still inlined correctly, meaning the `eas.json` block alone is sufficient.
   The `!apps/mobile/.env.production` negation was therefore removed rather
   than shipping env files into the build archive (mild secret-leak vector,
   and a second source of truth for the same value). Do not resurrect this
   approach; it was never the problem.
3. **ErrorBoundary committed without reproducing the bug first.** Deliberate.
   A visible error screen is strictly better than silent app death regardless
   of this specific bug, and it is the diagnostic that will identify the real
   cause on a real device. It is purely additive and reverts cleanly. It
   should **not** be mistaken for a fix to the checkout bug.

### Design pass: NOT STARTED

To be unambiguous: **none** of the following was begun. No files were created
or modified for any of it.

- **Settings screen** — not started, nothing written. Note that
  `LanguageSwitcher` is currently duplicated across five screens
  (`customer/account-screen.tsx`, `auth/screens.tsx`, `driver/screens.tsx`,
  `admin/dashboard-screen.tsx`, `restaurant/management-screen.tsx`);
  consolidating it into Settings means touching all five.
- **Persistent bottom navigation** — not started. Bottom nav and logout
  currently require scrolling to reach; logout belongs in Settings.
- **B4–B8 polish pass** — not started. No work on customer home, browsing,
  cart, or checkout polish.

Out of scope by explicit instruction: do **not** hide or change the restaurant
vertical. That decision is deferred until after the polish pass.

### Environment notes

- Seeded logins, all password `Test@12345`, no OTP (`phoneVerifiedAt` preset).
  Enter country code `+970` and the local part: customer `590000000`, admin
  `590000001`, restaurant owner `590000002`, driver `590000003`, supermarket
  owner `590000004`. All five verified by real login.
- **Login is throttled 5/min** (`auth.controller.ts:21`), and failed attempts
  count. A 429 while cycling through test accounts is the throttler, not a bad
  credential.
- There is **no `SUPERMARKET` role**. `UserRole` is
  `CUSTOMER | RESTAURANT | DRIVER | ADMIN`; supermarket vs restaurant is
  `businessType` on the business. Both owners log in as `RESTAURANT`. Tab count
  in the management workspace reveals which: 3 tabs = RESTAURANT, 4 tabs
  (incl. Inventory) = SUPERMARKET.
- Stray accounts in the local DB that are not from the seed and behave oddly if
  picked by mistake: `+970590000008` (REJECTED business), `+970599112233`
  (SUSPENDED business), and four `Smoke Test Driver` accounts with unknown
  passwords.
- The API must be running on port 3000 and the ngrok tunnel live before any
  rebuild; the tunnel hostname is hardcoded in `eas.json` and dies whenever the
  tunnel restarts.

### Prompt for the next session

```
Continue on branch agent/phase-15-and-jovo-brand. Read docs/progress.md's
"2026-08-13: Release-build crash fixed; checkout crash contained but NOT
fixed; design pass NOT started" entry first — it has the full state, what is
already ruled out on the checkout bug, and three judgment calls with their
reasoning that should not be reverted without reading them.

Two pieces of work, in this order:

1. Fix the checkout crash. Completing checkout kicks the user out of the app.
   Root cause is NOT yet known — the API, type mismatches, StatusBadge,
   Hermes/Intl, the socket, and null delivery are all already ruled out with
   evidence. Do NOT guess-and-rebuild. Reproduce it first: either expo web
   with the seeded customer, or rebuild the APK and read the error off the
   new ErrorBoundary's on-screen message. Then fix, and verify by placing a
   test order end to end and confirming the app stays open and shows the
   confirmation screen.

2. Start the design pass, which has not been begun at all:
   - A proper Settings screen reachable from account/profile, with sections
     for language, account, notifications, about/legal, and logout. Move the
     LanguageSwitcher into it — it is currently duplicated across five
     screens and should not float elsewhere in the UI.
   - Make the primary bottom navigation fixed/persistent so it stays visible
     while content scrolls. Logout belongs in Settings, not somewhere you
     scroll to find.
   - Then the B4-B8 polish pass across the whole app: consistent spacing,
     clear hierarchy, proper empty/loading/error states, and the restrained
     orange-accent rule (~10% of any view). Prioritise customer home,
     browsing, cart, and checkout, but the goal is the whole app feeling
     coherent — not one polished screen surrounded by rough ones.

Do NOT hide or change the restaurant vertical; that is deferred.
Verify visually in the browser (expo web, both languages) as you go, the way
B3 did, not just by typecheck. Commit and push at each meaningful boundary.
```

### NEW SCOPE received 2026-08-13, NOT STARTED — read before touching customer screens

This arrived at the end of the session and **no work was done on any of it.**
It supersedes the shorter design-pass description above.

**Critical structural decision: JOVO MARKET is the only supermarket partner.**
It is not one store among many — it *is* the store. The customer must land
directly in its catalogue. Remove store-selection / store-list / "browse
supermarkets" from the customer flow entirely, and rework home so JOVO MARKET
is the identity of the home experience (branding, categories, featured items),
not a card you tap into.

**Multi-store assumptions found so far.** This is what was already read this
session, NOT an exhaustive audit — finish the sweep before implementing:

- `src/navigation/navigation.ts` — a `supermarkets` list screen and
  `goToSupermarkets()`; `supermarket-catalog` and `supermarket-product` both
  carry `supermarketId` + `supermarketName` params, which stop making sense
  when there is exactly one store.
- `App.tsx` — `onOpenSupermarket` handler wiring the list → catalogue hop.
- `src/features/customer/supermarket-screens.tsx` — the store-list screen.
- `src/features/customer/home-screen.tsx` — surfaces stores as tappable cards.
- API: `GET /api/v1/restaurants` returns a mixed list including `businessType`;
  the client currently filters/browses it. Decide whether the single store is
  resolved once at boot instead.
- Still to check: search, favorites, and the bottom navigation.

**Quality bar:** DoorDash / Uber Eats / Talabat — matched on hierarchy,
confidence, and restraint, not copied. First three seconds should read as a
funded, finished product.

**Per-screen targets** (home, browse, product detail, cart, checkout, order
tracking, account): home = JOVO MARKET branding as hero, distinct visual
weights for category vs product cards, one focal point, skeleton matching the
real layout. Browse = breathing room, scannable filters with clear selection,
fast search, guiding empty states. Product detail = price the most prominent
number, add-to-cart unmistakable in JOVO orange, tactile quantity selector.
Cart = every line scannable, running total visible without scrolling, one
checkout action, inviting empty state. Checkout = address / cash-on-delivery /
summary as distinct labeled sections, weighty confirm button, and a real
confirmation screen with order number and next steps — not a dismissal to home.
Order tracking = status readable at a glance via the five-family colour system.
Account = organised sections, and where Settings lives.

**Icons:** audit every icon; flag and fix mixed outline/filled styles,
mismatched stroke weights, and multiple icon families. One set across the
customer flow. Active vs inactive must differ clearly — orange for
active/primary only, inactive neutral grey. Consistent sizing per role.
**Ask before adding an icon library**; only justified if the current set is
genuinely inconsistent.

**Ease of use:** fewest taps per primary action, comfortable tap targets, most
important action most visually obvious, remove anything not helping the user
act faster. **Deliverable: count taps from app open to completed order and
report the number.**

**Constraints:** light mode only; orange ~10% of any view, one primary action
per screen; Arabic native RTL with Cairo and correct line-height; directional
icons (back, chevron) mirror, non-directional (bag, star) do not; reuse the B3
tokens, no new hardcoded colours. **Verify visually in both languages (web
export is fine) before calling any screen done — typecheck alone is not
sufficient evidence.** Start with home, since the single-store restructuring
affects it most.

**Note a possible tension to resolve with the owner:** an earlier instruction
this session said explicitly *do not hide or change the restaurant vertical,
that decision is deferred*. Removing store selection from the customer flow may
touch shared browsing code paths. Keep restaurant browsing/ordering working as
-is unless told otherwise, and confirm before changing anything restaurant-side.

**The checkout crash is still unfixed** (see above). If the checkout flow is
touched: keep the ErrorBoundary, do not mask a real error, and make the success
path look finished only once it actually works.

#### OWNER DECISION 2026-08-13 — the restaurant/supermarket conflict is resolved

The tension flagged above is settled. Build on this basis:

- **Restaurant browsing stays exactly as it is.** No changes to restaurant
  code or restaurant flow, at all, while doing this work.
- **JOVO MARKET becomes a direct customer entry point** with no
  store-selection list in front of it.
- **The two are decoupled.** Do *not* route supermarket access through the
  same list screen that restaurants use. Supermarket access gets its own
  direct path.

This removes the earlier "restaurant vertical is deferred, confirm first"
caveat: it is not deferred-and-ambiguous any more, it is explicitly
"leave it alone entirely". The decoupling is the mechanism — a shared list
screen is what would have forced restaurant-side edits, so the direct
supermarket entry point is what keeps restaurant code untouched.

Implementation not started. The open design question to settle first is how
the single store is resolved: the customer needs JOVO MARKET's id without
picking it from a list, so decide between resolving it once at boot, hard
configuring it, or adding a dedicated single-store endpoint — rather than
reusing the mixed `GET /api/v1/restaurants` list the current flow browses.

## 2026-08-14: JOVO MARKET-only customer flow; checkout crash investigated, not reproduced

Branch: `agent/phase-15-and-jovo-brand`. Everything below is committed and pushed.

### The checkout crash — investigated with real orders, NOT reproduced, NOT confirmed fixed

**It does not reproduce on the web target.** Five real orders were placed end
to end this session against the live API and PostgreSQL — two before any code
changed (one supermarket, one restaurant) and three after — logged in as the
seeded customer, in both Arabic and English. Every one reached the confirmation
screen with the correct totals. No JS exception reached the console at any
point; the only console errors present are the Chrome extension's own
"message channel closed" noise, not the app's.

So there was no error message to read, and the previous session's premise —
that the ErrorBoundary would surface one on web — does not hold: **the crash is
native-only.** No Android device and no emulator exist in this environment
(`adb devices` empty, `emulator -list-avds` empty), and building an APK was
explicitly out of scope, so the actual on-device error was never obtained.
**Do not record this bug as fixed.**

Two attempts to get closer to a release bundle without a device both dead-ended,
and the reasons are worth keeping:

- `expo export` and `expo start --no-dev --minify` both force production mode,
  which loads `apps/mobile/.env.production` (machine-local, gitignored, excluded
  from EAS by `.easignore`'s `.env.*`). It points at a **dead ngrok tunnel**, so
  the exported app cannot reach the local API and drops straight to login.
- Removing that file does not help either: with a local `http://` URL the
  `!__DEV__ && !startsWith("https://")` guard in `core/api.ts:360` throws at
  import. **A production web bundle cannot be pointed at a local HTTP API at
  all.** Testing production JS locally would need an HTTPS local endpoint.
- Also worth knowing: **Metro's transform cache holds the inlined env value.**
  Two consecutive exports with different `EXPO_PUBLIC_API_URL` produced the same
  baked-in URL until `--clear` was passed. Verify what actually shipped with
  `grep -a -o -E "https?://[a-z0-9.:-]+" dist/_expo/static/js/web/index-*.js`.

#### What *was* found, and fixed: `react-native-maps` with no API key (`79d62f6`)

This is a verified defect, independent of the crash. `react-native-maps` renders
Google Maps on Android, and the Android SDK refuses to initialise without a
`com.google.android.geo.API_KEY` manifest entry. Expo only emits that entry from
`android.config.googleMaps.apiKey` in app.json.

Confirmed absent everywhere: not in `app.json`, not in the generated
`android/app/src/main/AndroidManifest.xml` (grepping `geo.API_KEY`,
`googleMaps`, `MAPS_API_KEY` across `android/` returns nothing), and
`react-native-maps`' own `AndroidManifest.xml` is an empty `<manifest>` element
that supplies nothing. The package *is* autolinked
(`android/build/generated/autolinking/autolinking.json` lists it), so the native
view really is constructed.

Why that lands on checkout specifically: `CheckoutScreen` renders `LocationMap`,
and placing an order navigates straight from checkout to the confirmation
screen. That unmount is the one moment a customer reliably drops a MapView, and
the teardown path is `MapManager.onDropViewInstance` -> `MapView.doDestroy()` ->
`onPause()`/`onDestroy()`
(`node_modules/react-native-maps/android/src/main/java/com/rnmaps/maps/`), which
runs against a GoogleMap delegate that authorisation never created. A native
crash there is not catchable by the JS ErrorBoundary — consistent with the app
closing itself and the boundary never showing anything.

**This is a plausible cause, not a proven one.** It is fixed because it is wrong
regardless: `location-map.native.tsx` now reads the configured key from
`Constants.expoConfig` and mounts `MapView` only when one exists, rendering a
coordinate panel otherwise. Nothing in the address step depends on the map — the
address is typed and "use my current location" goes through `expo-location`,
which needs no Maps SDK. Web (Leaflet over OSM) and iOS (Apple Maps, no key
needed) are unaffected. Setting `android.config.googleMaps.apiKey` restores the
map with no further code change.

**Next session: build an APK and place one order.** If it still closes the app,
the map was not the cause, and the ErrorBoundary should now be present in the
build to show the real message.

### JOVO MARKET is now the customer's direct entry point (`8d4ed31`)

- **Single-store resolution** — new `src/features/customer/market.ts`.
  `resolveMarketStore()` reads the one approved supermarket from the public
  listing and caches the promise; a failed lookup is deliberately not cached, so
  one offline moment cannot make the catalogue unreachable for the rest of the
  session. Not hardcoded: the id differs between the seeded local database,
  staging and production. No new API endpoint was needed. If several
  supermarkets are ever approved the first wins — documented and deliberate,
  not enforced by the API.
- **The store-selection list is gone.** `SupermarketListScreen` deleted, the
  `supermarkets` route removed from `AppScreen`, `goToSupermarkets` removed.
  `goToSupermarketCatalog` now takes optional `{ departmentId, search }`, and the
  catalogue screen accepts `initialDepartmentId` / `initialSearch`.
- **Home is the storefront, not a card you tap into.** `home-screen.tsx` renders
  JOVO MARKET's departments inline (tapping one opens the catalogue already
  filtered), a product grid from the catalogue underneath with working
  add-to-cart and a cart dock, and a search bar that opens the catalogue. The
  store name comes from the resolved store.
- **Offers are filtered** to supermarket-scoped and platform-wide only, so no
  offer card can route into a vertical that is not open. Platform-wide offers
  now open the market catalogue.
- **Restaurants show a "coming soon" card** where they used to be listed. **No
  "notify me"**: there is no subscription endpoint behind it, and a button that
  only flips local state would promise a notification the app cannot send. That
  was the one optional item in the brief and it was skipped on purpose.

Files touched: `App.tsx`, `navigation/navigation.ts`, `navigation.test.ts`,
`features/customer/home-screen.tsx`, `supermarket-screens.tsx`,
`cart-screens.tsx`, new `features/customer/market.ts`, and the four
`en|ar` x `customer|cart` locale files.

### Restaurant code and the business side: untouched and confirmed working

Nothing was deleted. `restaurant-screens.tsx`, the `restaurants` and
`restaurant-menu` routes, `goToRestaurants`, `goToRestaurantMenu`, all
restaurant models and every business-side screen are intact — only the
customer's entry points to browsing are gone, so re-enabling it means restoring
those entry points.

Verified in the browser, not assumed:

- Restaurant owner (`+970590000002`): home, **Incoming Orders queue**, order
  detail, and a **real Accept transition** — an order moved `PLACED -> ACCEPTED`
  with the status history updating and the next action becoming "Start
  Preparing". Restaurant workspace loaded with its **3 tabs** (Profile /
  Categories / Items), profile populated, menu-item editor working.
- Supermarket owner (`+970590000004`): **Supermarket workspace with 4 tabs**
  (Profile / Categories / Items / **Inventory**), profile populated.

### The confirmation screen now looks finished

It had no order number at all, and its copy said "the restaurant has received
your order" in a supermarket-only launch. It now shows the order number derived
as `id.slice(0, 8).toUpperCase()` — **the same derivation the business order
ticket uses** (`apps/admin` `BusinessOrderPage`), so the customer and the store
quote the same number — plus three concrete next steps ending in the exact cash
amount due, and a pointer to My Orders for tracking.

### Verified

- `npm run typecheck` clean across all three workspaces.
- `npm test`: **API 201 pass / 1 skipped by design / 0 fail**, **mobile 25/25**
  (23 prior + 2 new navigation tests for the catalogue's initial filters).
- `npx expo export --platform all` builds web, iOS and Android bundles cleanly.
- Real browser, live API and PostgreSQL, **both languages**: home storefront,
  department filtering, add-to-cart from home, product detail, cart, checkout,
  and the confirmation screen in Arabic RTL and English LTR.

### Small things worth knowing

- `home.departmentProductCount` interpolates `{{total}}`, **not `{{count}}`**.
  `count` is i18next's plural trigger, and this project deliberately avoids
  runtime `Intl` (no `Intl.PluralRules` guarantee on Hermes, no polyfill
  imported). The copy is count-neutral instead.
- `common:map.*` and the error-boundary strings were added to both locales; the
  boundary had been falling back to hardcoded English literals.
- Locale keys orphaned by the removed list screen (`supermarket.title`,
  `home.supermarketsSectionTitle`, `home.searchRestaurantsPlaceholder`, ...) were
  left in place. They are harmless and are exactly what is needed back when
  restaurant browsing returns.
- The seeded store is still named **"TasawaQ Fresh Market"** in the database, so
  that is what the storefront header shows. Pre-rename seed content, out of
  scope here, flagged again so it is not mistaken for a rebrand bug.
- API errors still surface in English inside the Arabic UI (seen again this
  session: "Your session is missing or has expired"). Unchanged, still the B4
  item with its root-cause analysis in the 2026-08-12 entry.

### Explicitly not touched, per instruction

Settings screen, persistent bottom navigation, and the broader B4-B8
design/polish pass. None of it was started.

## 2026-08-15: Settings screen, persistent bottom nav, and a first B4 pass (icons, error/status translation, bidi)

Branch `agent/phase-15-and-jovo-brand`. Started from the user's statement that
the checkout crash is fixed and verified on a real device — this session did
not re-touch checkout logic, only its screen content (see below), and the
full web checkout flow was re-run end to end afterward with no regression.

### 1. Settings screen — done

New `src/features/shared/settings-screen.tsx`, one component for every role.
Sections: Account (signed-in name/phone; customer gets a link into the
existing Account screen for profile/address editing), Language (reuses the
existing `LanguageSwitcher`), Notifications (push toggle, now self-contained
— reads/writes its own token, no longer threaded through Account's props),
About (app name blurb + live `Constants.expoConfig.version`), Logout (with a
confirm dialog). New `{ name: "settings" }` route in `navigation.ts`.

The duplicated `LanguageSwitcher` named in the brief across five screens —
`customer/account-screen.tsx`, `auth/screens.tsx` (the shared RESTAURANT/
DRIVER home), `driver/screens.tsx`, `admin/dashboard-screen.tsx`,
`restaurant/management-screen.tsx` — is gone from all five; each now links to
the shared Settings screen instead (a gear icon in Account's and the
restaurant workspace's header, a text link on the driver dashboard, an extra
action button on the admin dashboard and the shared auth home). This is the
one place this session touched restaurant/driver/admin screens, and only to
swap that one floating widget for a nav link — no business logic changed.
Account screen's own notifications card and inline language switcher were
removed in favour of Settings; its profile/address CRUD is untouched.

### 2. Persistent bottom navigation — done

New `src/features/customer/bottom-nav.tsx`: `CustomerBottomNav` (5 tabs —
Home / Browse / Cart / Orders / Account, Ionicons filled+orange when active,
outline+grey otherwise, a badge on Cart from live cart count) and
`CustomerTabShell`, a thin wrapper (`flex:1` content + the nav as a fixed
sibling below it, not `position: absolute`) applied in `App.tsx` around the
five tab-root screens (`home`, `supermarket-catalog`, `cart`, `order-history`,
`account`). Deep-flow screens (product detail, checkout, order detail,
settings, notifications) deliberately have no tab bar, matching the reference
apps named in the brief. Confirmed genuinely fixed by scrolling a
department/offers/product-grid-length page in the browser — the bar stayed
pinned while content scrolled behind it, screenshotted before and after.
Logout moved out of Home's quick-actions row entirely (that row is deleted)
into Settings, reachable in one tap from the Account tab without scrolling.

**Known gap, not fixable from here:** the tab-root screens keep their own
`SafeAreaView` (default edges, including bottom) *inside* the shell, so on a
real device with a bottom inset (home indicator) that inset is reserved once
inside the screen's content *and* again by the nav bar's own
`SafeAreaView(edges:["bottom"])`, which would show as a few extra pixels of
blank space above the nav on iOS/notched Android. Web has no safe-area inset
so this was invisible in every verification this session could run. Fixing
it means passing `edges={["top","left","right"]}` on those five screens'
`SafeAreaView` — a one-line change per file, deliberately deferred rather
than made unverified.

### 3. B4 pass: icons, error/status translation, one bidi bug, one debug-text bug — substantial, not exhaustive

- **New `src/theme/icon.tsx`**: one icon family (Ionicons via
  `@expo/vector-icons`) for the whole customer surface, wrapping an
  outline/filled pair per semantic name so "active differs from inactive" and
  "orange only when active" are structural, not per-screen convention.
  `backIconName()`/`disclosureIconName()` centralize the RTL-mirroring
  decision that used to be a hand-written `isRTL() ? "›" : "‹"` ternary
  repeated in five files. Not a new *kind* of dependency — `@expo/vector-icons`
  was already an installed transitive dependency of `expo` itself (confirmed
  in the lockfile) and is the standard Expo icon solution; it is now also an
  explicit `package.json` dependency.
  - **Caught before it shipped**: importing `{ Ionicons } from "@expo/vector-icons"`
    (the package barrel) pulled in all ~18 icon families' font files through
    Metro's bundler — confirmed via `expo export --platform web`, which listed
    27 font assets including a 1.31 MB `MaterialCommunityIcons.ttf` never used
    anywhere in this app. Importing the documented direct submodule
    (`@expo/vector-icons/Ionicons`) instead dropped that to the one Ionicons
    font (390 KB) and cut the exported JS bundle from 2.03 MB to 1.6 MB.
  - Replaced with `Icon` everywhere a raw glyph character, emoji-as-UI-control,
    or `isRTL() ? … : …` chevron ternary was standing in for a functional icon:
    `home-screen.tsx` (search, filter, notification bell — now driven by a
    real unread count instead of an always-on dot, market-hero disclosure
    chevron, product-card add button), `cart-screens.tsx` (the shared
    `Header`'s back button, used by Cart/Checkout/Confirmation/History/Detail;
    the remove-line and quantity-stepper buttons), `supermarket-screens.tsx`
    (back button, product-card add button), `account-screen.tsx` (back
    button, new settings button). Decorative placeholder emoji standing in for
    product photography (🥫, 🛒, 🍽️) were deliberately left alone — that's
    the documented convention in `theme/tokens.ts`, not an inconsistency.
- **API errors no longer surface in English inside the Arabic UI** — the
  concrete finding named in this session's brief and diagnosed with a full
  root-cause in the 2026-08-12 entry. New `src/i18n/locales/{en,ar}/errors.json`
  (~95 entries, one per `ApiException` code enumerated by grepping
  `apps/api/src` for `new ApiException(`) and a new shared
  `src/core/errors.ts::readError()` that looks up `error.code` in that table
  and falls back to the server's own message only for a code not yet
  catalogued. Replaced 9 near-duplicate local `readError`/`readAdminError`-
  style functions with it: every customer screen
  (`account-screen.tsx`, `cart-screens.tsx`, `restaurant-screens.tsx`,
  `supermarket-screens.tsx`, `notification-screens.tsx`) plus
  `driver/screens.tsx`, `restaurant/management-screen.tsx`,
  `restaurant/order-screens.tsx`, `restaurant/inventory-screen.tsx`. Left
  `auth/screens.tsx`'s and `role-registration-screens.tsx`'s own versions
  alone — they also handle `PhoneValidationError`, a case the shared helper
  doesn't cover, and `admin/ui.tsx`'s `readAdminError` alone as out of scope.
- **Missing status translations**: `DELIVERY_FAILED`, `FAILED`, and
  `PREPARING_SUPERMARKET` existed in `theme/tokens.ts`'s status-family sets
  (so the *colour* was already right) but had no `status.*` entry in either
  locale, so they fell through to an English default inside Arabic — added to
  both `common.json` files.
- **A real bidi bug, found and fixed**: a customer's phone number
  (`+970590000000`) rendered as `970590000000+` — the leading `+` drifting to
  the visual end — on Settings' and Account's own signed-in-phone line,
  because RTL paragraph direction reorders bidi-neutral digit/symbol runs.
  Fixed with a `writingDirection: "ltr"` style on just those two `Text`
  elements; not audited beyond the two screens this session actually wrote.
- **A stale-translation bug on checkout, investigated, not fully root-caused,
  resolved by removing the content instead**: the raw delivery-pin coordinate
  line (`"Delivery pin selected: 31.90380, 35.20340"`) rendered in *Arabic*
  while every other string on the same checkout screen — including the
  adjacent line built the same way, from the same `t()`, in the same render —
  was correctly English. Confirmed via the actual DOM text (not a screenshot
  read) and reproduced across a full hard reload, so it isn't a Fast Refresh
  artifact. The bundled JS was checked directly and both locale strings are
  present and correct at their expected `pinSelectedNote` key, so the
  resource data itself isn't corrupted; the mechanism that made *this specific*
  interpolated call return the Arabic resource while its English-only
  neighbour didn't remains unexplained. **Do not mark this mechanism as
  understood.** It was made moot rather than fixed: showing a customer raw
  decimal coordinates never helped them "understand or act faster" (the
  brief's own ease-of-use test) when the address text field and the map pin
  already show the same information — so the line was deleted from
  `cart-screens.tsx` outright, which also removes the bug's only known
  reproduction. If mixed-language text is ever seen again on an interpolated
  `t()` call elsewhere, this entry is the place to start.

### 4. Seed rename — done

`apps/api/prisma/seed.ts`'s supermarket `name` (both the `create` and
`update` branches of the upsert) changed from `"TasawaQ Fresh Market"` to
`"JOVO MARKET"`. Re-ran `npm run prisma:seed`; confirmed via
`GET /api/v1/supermarkets` against the live local database that the one
supermarket row now reports `"JOVO MARKET"` — the upsert's `update` branch
means this took effect on the *existing* seeded row, not just future ones.

### Verified

- `npm run typecheck` clean across all three workspaces (API, admin, mobile).
- `npm test`: mobile 25/25 (unchanged count — no screen this session added or
  removed test-covered behaviour), API 201/202 (1 skipped by design,
  unchanged from before this session).
- `npx expo export --platform web` succeeds; bundle-size finding above.
- Real browser (Expo web dev server, live local API + PostgreSQL), **both
  languages, logged in as the seeded customer** (`+970590000000` /
  `Test@12345`): home storefront (search/filter/notification icons, real
  unread badge, department strip, product grid, coming-soon restaurants
  card), add-to-cart from home (cart dock + nav badge both update live),
  product detail, Browse tab (department filter chips, brand names), Cart
  (line items, stepper, remove, running subtotal, checkout button — all
  pinned, all scrollable content behind them), full Checkout (distinct
  address/payment/notes sections, a live delivery quote from the real pricing
  endpoint, 10.00 ILS minimum fee matching the Phase 15.0 change), **a real
  order placed end-to-end** (confirmation screen with a real order number,
  three next steps, exact cash-due total), Order History (PLACED orange /
  DELIVERED green, matching the
  five-family system), Order Detail (full status timeline, red Cancel
  action), Settings (all four sections, language switch round-trip, phone
  bidi fix), Account (gear icon into Settings, saved-address map). Confirmed
  RTL mirroring is still correct after this session's edits: search/filter
  icons, back buttons, and the market-hero disclosure chevron all flip with
  language; the product/offer emoji correctly do not.
- Persistent-nav scrolling behaviour specifically verified by screenshot
  before/after a mid-page scroll, not assumed from the flex layout alone.

### Not started / explicitly out of scope this session

- **The wider B4 states pass** (skeletons over spinners; a genuinely
  guiding empty-cart illustration; toasts) — this session's B4 work was
  scoped to what the brief named concretely (icon audit, the API-error and
  status-translation gaps) plus what verification surfaced (the bidi bug, the
  checkout debug-text bug), not a full component-by-component skeleton pass.
- **B5–B8** (deeper hierarchy/spacing audit, product-detail and checkout
  visual weight pass beyond what already existed from B1–B3, order-tracking
  layout beyond the colour system, account/settings final polish) — not
  started as a distinct pass; today's changes were bug- and
  consistency-driven, not a ground-up redesign of any screen's layout.
- **Tap count, golden path** (home already open, logged in, item already in
  cart's target restaurant/store) — add item (1) → open basket (2) → proceed
  to checkout (3) → calculate delivery price (4) → place order (5) **for a
  customer with a saved default address** (checkout pre-fills it, confirmed
  in the browser — no location/address tap needed). **6 taps** for a
  first-time customer with no saved address, who also taps "use my current
  location" (or types the address by hand, which isn't a "tap"). A delivery
  quote is mandatory before `Place Order` is enabled either way — confirmed
  in `cart-screens.tsx`'s `submit()`, which refuses without one.
- **Restaurant vertical**: untouched, as instructed — no restaurant business
  screen's layout, only the one settings-link swap in `management-screen.tsx`
  and `order-screens.tsx`'s/`inventory-screen.tsx`'s `readError` consolidation
  (behavior-preserving, see above).

### Could not verify without a real device

- The persistent-nav safe-area double-inset gap noted in section 2.
- Whether the Settings push-notification toggle actually delivers a device
  push — registration/token round-trip only, matching the standing
  "sending pushes is a separate integration" boundary from Phase 7/14.
- Everything about the *native* checkout crash the user reports as fixed:
  this session never built or ran an APK, only re-verified the web target
  end-to-end (which never reproduced the crash in any session, including
  this one).

## 2026-08-15: The B5-B8 design/polish pass (states, layout audit, motion, safe-area analysis)

Branch `agent/phase-15-and-jovo-brand`, continuing directly from the same-day
B4 session above. Scope: real skeleton loaders in place of spinners, guiding
empty states, deliberate success feedback, a deeper layout/hierarchy audit,
confirming the order-tracking status-family system is fully applied, minimal
motion, and a read-only assessment of the persistent-nav safe-area question
flagged (not fixed) in the prior entry.

### 1. Loading, empty, and success states — done

- New `src/theme/motion.ts`: `useReducedMotion()` (backed by
  `AccessibilityInfo.isReduceMotionEnabled`, which resolves to
  `prefers-reduced-motion` on web and the OS accessibility setting on
  native — one hook, both platforms) plus the shared easing/duration
  constants `theme/tokens.ts` had already declared but nothing consumed yet.
- New `src/components/skeleton.tsx`: one `Skeleton` primitive (a pulsing
  block, frozen at a fixed opacity under reduced motion) plus
  layout-matching composites — `ProductCardSkeleton`/`ProductGridSkeleton`,
  `DepartmentStripSkeleton`, `OfferCardSkeleton`, `OrderCardSkeleton`/
  `OrderListSkeleton`, `OrderDetailSkeleton`, `ProductDetailSkeleton` — each
  shaped after the real card/screen it stands in for, not a generic bar.
  Replaced every bare `ActivityIndicator` loading state on the customer
  surface: home's department strip/offers/product grid, the supermarket
  catalogue grid and product detail, order history and order detail,
  the notification inbox, and the account screen's two form cards (which
  previously flashed blank inputs before the profile loaded — now shows a
  skeleton and gates the real form behind `profile` being loaded or errored,
  with its own retry action on error).
- New `src/components/toast.tsx`: a `ToastProvider`/`useToast()` pair — a
  dark snackbar-style toast (checkmark icon + message, fades and slides in
  from the top, auto-dismisses after ~2.2s, skips the slide under reduced
  motion) mounted once at the app root above `ErrorBoundary`. Wired into
  `App.tsx`'s single `handleAddToCart` handler (shared by every "Add"
  button — home, catalogue, product detail) so adding an item now gives
  explicit confirmation instead of a silent state change; the existing
  cart-dock/nav-badge count-up is unaffected. Order placement deliberately
  does **not** also get a toast — it already has its own full confirmation
  screen, which is where the one "moment of delight" motion in this app
  now lives: `SuccessCheckmark`, a scale+fade entrance on that screen's
  checkmark (skipped outright, not just shortened, under reduced motion);
  the raw `✓`/`⌖` glyph characters it and the delivery-progress heading were
  standing in for are now real `Icon`s, closing a gap the B4 icon pass had
  missed on this specific screen.
- Guiding empty states, each now icon + message + (where a next action
  actually exists) a real button: cart empty → "Start Shopping" into Browse;
  order history empty → "Browse JOVO MARKET" into Browse; catalogue
  zero-results → a hint line plus "Clear filters" (only shown when a
  filter is actually active) that resets search/department/featured in one
  tap; notification inbox empty → an added hint line. Home's own empty
  states (no offers, store unreachable, no products) keep their existing
  copy — there is no "elsewhere" to send the customer to from the screen
  that already *is* the storefront — but gained the same icon treatment for
  visual consistency with the rest.
- **A real, functional bug fixed alongside this**: home's "store unreachable"
  copy has said "pull down to try again" since it was written, but the
  screen's `ScrollView` never had a `RefreshControl` — the instruction was
  never actionable. Added pull-to-refresh to the whole home screen
  (`refresh()`, wired to a new unified `load(forceStoreRefresh)` that also
  re-fetches offers and the unread count), and made it call the existing
  `forgetMarketStore()` when the store previously failed to resolve, so
  the documented recovery path now actually recovers.
- **A second stale-copy bug, found while touching the empty-cart string**:
  it still read "Add items from a restaurant menu to start an order" — a
  leftover from before the JOVO MARKET-only pivot (2026-08-14 entry above).
  Changed to "Add products from JOVO MARKET…" in both locales.

### 2. Layout/hierarchy audit — findings and fixes

- **A real, visible bug found and fixed**: the supermarket catalogue's
  department/filter chip row (`SupermarketCatalogScreen`) was rendering
  with its pills clipped to roughly half their height, chip labels cut off
  mid-glyph — confirmed via `getBoundingClientRect`/computed-style
  inspection in the live browser, not just a screenshot guess: the
  horizontal `ScrollView`'s host `<div>` computed to `13.6px` tall despite
  its own `maxHeight: 54` and un-shrunk content needing ~34px, meaning the
  flex algorithm was shrinking it below content because its style set
  `flexGrow: 0` but never `flexShrink: 0` — React Native's own default,
  which `react-native-web`'s compiled CSS doesn't reliably reproduce unless
  the style says so explicitly. Fixed with one line
  (`flexShrink: 0` on `departmentStrip`, `alignItems: "center"` on
  `departmentContent`), reloaded, re-measured: pills render at full height,
  fully legible, in both languages. This is exactly the class of bug the
  brief asked this pass to go looking for.
- **Product placeholder-emoji consistency, fixed**: the cart line-item row
  used `🍽️` (a restaurant emoji, left over from before the JOVO
  MARKET-only pivot) and the product-detail screen used `🛍️`, while home
  and the catalogue grid both already used `🥫`. All three now use `🥫`, so
  a customer sees one consistent "no photo" placeholder everywhere in the
  order they'd actually encounter it — catalogue → detail → cart.
- **Order-tracking status-color system: confirmed, and finished applying,
  not just confirmed**. `StatusTimeline`'s dots were hardcoded to orange
  regardless of the status they represented — so an order's full history
  read as an unbroken orange line even after it reached `DELIVERED`. Each
  dot now colors from `statusFamily(entry.toStatus)`, verified live against
  a real delivered order: PLACED orange → ACCEPTED/PREPARING/
  READY_FOR_PICKUP blue → DELIVERED green, readable in one glance exactly
  as the five-family system intends. `DeliveryProgressCard` had the same
  gap one level up — the delivery's own status (`PENDING_ASSIGNMENT`
  through `DELIVERED`) rendered as plain uncolored text with a `⌖` glyph;
  it now reuses the shared `StatusBadge` (color-coded, translated) and a
  real `bicycle` icon, both already used by the order list/detail above it.
- Spacing, weight hierarchy, and image aspect/corner-radius treatment were
  audited screen by screen (home, catalogue, product detail, cart,
  checkout, order history/detail, account/settings) against the existing
  `spacing`/`radius` token scale and found already consistent — every
  screen already reads off `theme/tokens.ts`, nothing hardcoded. The single
  orange-accent rule holds: orange is scoped to primary CTAs, the active
  nav tab, active/attention status badges, and small per-card "add"
  buttons — never a background fill or a secondary action.

### 3. Order-tracking five-status-family system — confirmed complete

Between the color fixes in section 2 and the palette/`statusFamily()` work
already in `theme/tokens.ts`, every place an order or delivery status is
shown to the customer now draws from the same five-family palette:
`OrderHistoryScreen`'s `StatusBadge`, `OrderDetailScreen`'s summary badge,
`StatusTimeline`'s dots, and `DeliveryProgressCard`'s badge. Nothing left
using an ad hoc color.

### 4. Motion — minimal, as instructed

Exactly three additions, all built on the new `theme/motion.ts` and all
`useReducedMotion`-aware: the skeleton pulse (loading), the add-to-cart
toast's slide+fade (state change confirmation), and the order-confirmation
checkmark's scale+fade entrance (the one "moment of delight"). No animation
library was added — everything uses React Native's built-in `Animated`.
Full-screen transition animation between the state-machine-switched screens
in `App.tsx` was deliberately **not** attempted: there is no navigation
library here to hook a transition into, App.tsx swaps `screen.name`
synchronously, and wrapping that swap in a cross-fade would mean touching
the render path of every single screen for a purely decorative gain that
the brief itself called "last, and minimal." Flagged here rather than
silently skipped.

### 5. The persistent-nav safe-area double-inset — analyzed, not fixed

Re-read `bottom-nav.tsx` and the five tab-root screens
(`home-screen.tsx`, `cart-screens.tsx`'s `CartScreen` and
`OrderHistoryScreen`, `supermarket-screens.tsx`'s `SupermarketCatalogScreen`,
`account-screen.tsx`) end to end, and confirmed the gap flagged in the prior
entry is real, not a false alarm:

- `CustomerBottomNav` wraps itself in
  `<SafeAreaView edges={["bottom"]}>` — correct, it needs the bottom inset
  since it sits at the physical bottom of the screen.
- Every one of the five tab-root screens *also* wraps its own content in
  `<SafeAreaView style={styles.screen}>` with **no `edges` prop**, which
  defaults to all four edges — including bottom. But inside
  `CustomerTabShell`, that screen is never at the physical bottom; the nav
  bar is rendered below it as a sibling. So each screen reserves a
  bottom-inset-sized strip of blank padding at the end of its own content,
  immediately above a nav bar that reserves the *same* inset again for
  itself — the inset gets paid for twice.
- **This is a real risk**, not a false alarm — it only shows up on a device
  with a nonzero bottom inset (an iPhone with a home indicator, or Android
  gesture navigation), which is why it was invisible in every verification
  this session could run: web has no safe-area inset at all, so
  `insets.bottom` resolves to `0` and the double-reservation is `0 + 0`.
  Nothing short of a real device (or an iOS/Android simulator with a
  simulated inset) will show the actual gap.
- **The correct fix**: change those five screens' outer `SafeAreaView` to
  `edges={["top", "left", "right"]}` — dropping `"bottom"` — since
  `CustomerBottomNav` already owns that edge. One line per file, five
  files: `home-screen.tsx`, `cart-screens.tsx` (both `CartScreen` and
  `OrderHistoryScreen` — same file, two separate `SafeAreaView`s),
  `supermarket-screens.tsx`'s `SupermarketCatalogScreen`, and
  `account-screen.tsx`. Deliberately **not applied** — per instruction, this
  needed a second pair of eyes before touching five screens on the strength
  of a read, not a device measurement. `SupermarketProductScreen` and the
  deep-flow cart screens (`CheckoutScreen`, `OrderConfirmationScreen`,
  `OrderDetailScreen`) are unaffected either way — they're not wrapped in
  `CustomerTabShell`, so their own `SafeAreaView` is correctly the outermost
  edge-owner as written.

### Verified

- `npm run typecheck` and `npm test` (25/25) clean in the mobile workspace;
  `npx expo export --platform web` bundles cleanly at 754 modules, still
  one Ionicons font (390 KB) and a 1.61 MB JS bundle — the new icons used
  this session (`checkCircle`, `checkmark`, `star`, `basket`, `alertCircle`,
  `bicycle`) were all already in the bundled Ionicons set from the B4 pass,
  so no bundle-size regression.
- Real browser (Expo web dev server against the live local API/PostgreSQL),
  **both languages, logged in as the seeded customer**: home's pull-to-
  refresh, the add-to-cart toast (screenshotted mid-animation via a batched
  click+screenshot to beat the ~2.2s auto-dismiss, confirmed correct RTL
  layout in Arabic — icon and text both flow right-to-left), the empty cart
  state and its "Start Shopping" CTA routing into Browse, the catalogue's
  zero-results state and working "Clear filters", the department-chip fix
  (before/after, `zoom`-captured), a real order's status timeline showing
  the orange→blue→green progression end to end, `DeliveryProgressCard`'s
  new badge and icon, and the notification inbox's new header/skeleton.
  Console read via `read_console_messages` showed no application errors
  (only an unrelated Chrome-extension messaging warning).
- Confirmed via `git status` that only the intended 14 files changed — no
  incidental edits to `apps/api`, `apps/admin`, restaurant/driver/admin
  screens, backend logic, database schema, auth, or routing.

### Not verified / explicitly out of scope this session

- The safe-area double-inset gap itself — see section 5; needs a real
  device or simulator, not this session's tools.
- Order placement's `SuccessCheckmark` animation specifically — the live
  checkout run hit an expired access token late in this session (an
  unrelated, pre-existing short-JWT-lifetime characteristic, not a
  regression from anything touched here) before a fresh order could be
  placed and screenshotted mid-animation. The component logic was
  read-verified and follows the exact same `useReducedMotion` pattern
  already proven working by the toast; low residual risk, but flagging
  since it is the one motion addition not screenshotted in the browser.
- Native builds: everything this session touched was verified against the
  Expo web target only, matching this environment's standing constraint
  (no device available this session either). No native-only code paths
  (constants, permissions, native modules) were touched.
- One pre-existing, out-of-scope data oddity noticed while browsing in
  English: one seeded product ("حمص") has an Arabic-only name in the
  database, so it renders untranslated inside the English UI. This is
  seed data, not application code — same category as the previously-flagged
  "TasawaQ Fresh Market" seed-name mismatch — and was left alone.

## 2026-08-15: The safe-area fix, and the first APK built from this branch

Branch `agent/phase-15-and-jovo-brand`, continuing from the B5-B8 session
above. Scope: apply the safe-area double-inset fix that session analyzed but
deliberately left unapplied, then produce an installable Android APK for
real-device testing.

### 1. The bottom safe-area double-inset — applied

Applied exactly the fix the prior entry's section 5 identified:
`edges={["top", "left", "right"]}` on the five tab-root screens'
outer `SafeAreaView` (`home-screen.tsx`, `cart-screens.tsx`'s `CartScreen`
and `OrderHistoryScreen`, `supermarket-screens.tsx`'s
`SupermarketCatalogScreen`, `account-screen.tsx`), since `CustomerBottomNav`
already owns the bottom edge. Also documented the contract on
`CustomerTabShell`'s doc comment, so the bottom edge doesn't get silently
added back by someone reading only the screen file.

**A second, previously unnoticed bug surfaced by the typecheck.** Adding the
`edges` prop made `tsc` fail on `supermarket-screens.tsx` only —
`Property 'edges' does not exist`. The cause: that file imports
`SafeAreaView` from **`react-native`**, the deprecated built-in, not from
`react-native-safe-area-context` like every other screen. The built-in is
iOS-only and a **no-op on Android**, so both screens in that file (the Browse
tab and the product-detail screen) were applying no safe-area insets at all
on Android — independent of, and predating, the double-inset issue. Switched
the import to the context version. `restaurant-screens.tsx` has the same
stale import; it was left alone deliberately, since the restaurant vertical
is deferred and unreachable in the customer flow — noted here as a known
remaining instance rather than fixed out of scope.

Verified: `npm run typecheck` clean, `npm test` 25/25 in the mobile
workspace. Committed as `e45bf5d`.

### 2. API + tunnel

The ngrok tunnel was **dead** at the start of this session (public URL
returned ngrok's 404 "tunnel not found"; no `ngrok.exe` process running).
The API itself was healthy — a `node dist/main` process on port 3000, started
2026-08-14, independent of any agent session.

Restarted ngrok on the reserved hostname
`impaired-villain-itinerary.ngrok-free.dev` and verified end to end rather
than by process existence: `/api/v1/health/ready` returns 200 with
`database: connected`, `GET /api/v1/supermarkets` returns the real JOVO
MARKET row, and a real `POST /api/v1/auth/login` as the seeded customer
returns 201 with a valid CUSTOMER JWT. (The login DTO takes
`countryCode` + `phoneNumber`, not a combined `phone` field — a flat `phone`
body returns `VALIDATION_ERROR`.)

The tunnel was then **restarted as a detached process** (`Start-Process`,
hidden window) rather than as a child of the agent session, and re-verified,
so on-device testing does not depend on an agent session staying open.

### 3. The APK build

`eas build --platform android --profile preview`, build
`3649829a-2e1e-4333-9dfc-ce6ce407d8b9`, from commit `e45bf5d` — finished,
signed, universal (all four ABIs), 78 MB, versionCode 13 / 0.13.0.

Config confirmed before building: the `preview` profile's `env` and the
EAS-hosted `preview` environment **both** hold
`https://impaired-villain-itinerary.ngrok-free.dev`, matching the live
tunnel. EAS logs that the build-profile value wins where the two overlap;
they are identical, so the precedence is moot here — but worth knowing if
they ever diverge.

### 4. Verifying the URL is genuinely in the shipped bundle

This branch has shipped "successful" builds that crashed on launch, so build
status was not treated as evidence. `assets/index.android.bundle` was
extracted from the downloaded APK (confirmed Hermes bytecode by its
`c61fbc03` magic) and grepped directly:

- `https://impaired-villain-itinerary.ngrok-free.dev` is present as a literal
  in the Hermes string table (once; Hermes suffix-packs strings, so it shares
  storage with the adjacent `deviceName` — the contiguous bytes are still an
  exact match).
- `http://localhost:3000` is **absent**. This matters: the repo's gitignored
  local `.env` contains exactly that value, and a stale `apps/mobile/dist/`
  web bundle in the working tree has it baked in. Neither reached this build.
  The only dev-fallback literal left is `http://10.0.2.2:3000`, Metro having
  eliminated the other `Platform.select` branches for the Android target.
- `EXPO_PUBLIC_API_URL` appears **exactly once** — as part of the error
  message string. Had babel's inline-env-vars plugin failed to substitute it,
  Hermes would also need that same text as a property-name string for a
  runtime `process.env` lookup, giving two occurrences. One occurrence is
  positive evidence the inlining actually happened, not just that a matching
  string exists somewhere.

**Why this specific check.** `api.ts:360` throws at **module load** —
`if (!__DEV__ && (!configuredApiUrl || !configuredApiUrl.startsWith("https://")))` —
so an un-inlined env var produces a build that succeeds and then dies
immediately on launch, before any screen renders. Confirmed by grep that this
is the *only* module-load-time throw in the app; every other `throw` in
`src/core/` sits inside a function body. That makes it the highest-value
single thing to verify in a shipped bundle, and it is now verified clean.

### Not verified

- **The APK was never launched.** No device was connected and no AVD exists
  on this machine (the `emulator` binary is installed, but
  `~/.android/avd/` is empty), so nothing here proves the app runs. What is
  proven is narrower and worth stating precisely: the one known crash
  mechanism — an un-inlined API URL tripping the module-load guard — is not
  present in this bundle.
- **The safe-area fix itself remains device-only to confirm.** Web has a zero
  bottom inset, which is why the double-inset was invisible in every prior
  session; only a device with a home indicator or Android gesture navigation
  will show whether the gap is actually gone.
- The native `android/` directory means this is a bare workflow: EAS logs
  that `android.package` in `app.json` is ignored in favour of the native
  value. Both say `com.jovo.app`, so they agree today — but `app.json`'s
  Android block is not the source of truth for this build.

## 2026-08-16: Getting the supermarket catalogue entry form ready for real JOVO MARKET data entry

Branch `agent/phase-15-and-jovo-brand`. Scope: an audit of the mobile
Restaurant/Supermarket Workspace's product form (`management-screen.tsx`)
against the `MenuItem` Prisma model, then closing every real gap found,
ahead of the user entering JOVO MARKET's actual inventory. Image upload was
explicitly out of scope; `imageUrl` stays a plain URL field.

### Audit findings

- Every existing schema field — `sku`, `barcode`, `brand`, `unitLabel`,
  `stockQuantity`, `reorderLevel`, `isVariableWeight`, `isFeatured` — was
  already wired end-to-end (DTO, service, mobile form) for supermarkets.
  Confirmed live, not just read: creating a product with each of these set
  round-tripped correctly through the real API and database (see
  Verification below).
- **`costPriceMinor` did not exist anywhere** — not in the schema, not in
  any DTO, not in either mobile or admin-web form. The user asked for it
  specifically because the margin/accounting work is still ahead and
  wanted to avoid revisiting every product later. Added as a new nullable
  column (see below) — this is a real schema change, not just UI wiring,
  but stayed within "what's needed for these fields": no accounting/margin
  *calculation* was added, only the ability to record and retrieve the raw
  number.
- **A second, separate, less-complete catalogue form exists**:
  `apps/admin/src/pages/business/CataloguePage.tsx`, part of a full
  self-service business portal in the `apps/admin` web app (Catalogue,
  Inventory, Live Orders, Staff pages, gated by the Phase 15
  `BusinessMember`/permission system). It is missing `brand`,
  `isFeatured`, `isVariableWeight`, and `reorderLevel` entirely, and was
  **not** touched this session. `docs/progress.md`'s own history
  (2026-08-15 entry) confirms the mobile Workspace is the tool that has
  actually been exercised and verified end-to-end across many prior
  sessions, and "verify via the web export" matches this project's
  established term for running the mobile app through Expo's web build —
  not the separate admin app. Flagged here in case the user is actually
  using `apps/admin` for data entry, since that form would need the same
  pass if so.
- The "silently disabled save button" trap: the no-category-yet case was
  already handled (an `Empty` state with explicit copy replaces the whole
  form). The undocumented trap was different — **both the item form and
  the category form cleared themselves immediately on submit, before
  knowing whether the save actually succeeded.** A duplicate SKU/barcode,
  a permission error, or a dropped connection would wipe the form's
  contents out from under the user while the real error appeared above it,
  silently discarding whatever they had typed. Fixed by making `run()`
  return success/failure and only clearing the form when it resolves true.

### Changes made

- **Schema**: `MenuItem.costPriceMinor Int?` (migration
  `20260815223840_phase15b_menu_item_cost_price`, applied to the live
  local database), with a `CHECK (costPriceMinor IS NULL OR
  costPriceMinor >= 0)` constraint matching the existing `priceMinor`
  constraint's style.
- **API**: `costPriceMinor` added to `CreateMenuItemDto`/`UpdateMenuItemDto`,
  `MenuItemOwnerView` (owner/admin-only — deliberately kept off
  `MenuItemPublicView` so it can never reach a customer-facing response;
  verified by a test asserting the key is absent from a public menu
  payload), `menu.service.ts`'s create/update/view mapping, and the admin
  restaurant-menu mapping. Changing it now requires `MANAGE_PRICES`, the
  same permission that already gates `priceMinor` — reusing, not
  duplicating, Phase 15's existing "changing what something costs is a
  separate permission from editing it" rule. Also fixed a latent gap in
  `testing/fake-prisma.ts`: the unit-test fake's `menuItem.create`/`update`
  never wired `isVariableWeight`, `barcode`, or `reorderLevel` at all
  (silently `undefined` in every test), even though the real Prisma
  columns and the mobile form both already used them — fixed alongside
  adding `costPriceMinor`'s own wiring, since it's the same class of gap
  the audit was specifically asked to rule out.
- **Mobile form** (`management-screen.tsx`): added the cost-price field;
  reordered fields to name → category → price → cost price → description
  → image URL → the grocery-specific fields, per the requested "sensible
  field order"; replaced the price/category disabled-button validation
  with explicit inline error messages (empty name, no category, invalid
  or negative price, invalid or negative cost price) using new
  `restaurantOps` locale keys in both languages; fixed the reset-on-submit
  bug described above for both the item and category forms so a failed
  save no longer erases the form; the product list row now shows the cost
  price (`· Cost 5.00 ILS`) alongside price/stock/featured when one is
  recorded, for a quick sanity check while entering data.
- Category creation already leaves the form ready for the next item
  without navigation (the category picker keeps its selection across a
  successful save) — confirmed already true, not changed.

### Verified

- `npm run typecheck` and `npm test` clean across all three workspaces:
  **204/205 API tests pass (1 skipped by design)**, up from 201 (2 new
  cost-price service tests, plus the existing public-menu test extended
  with a "cost price never appears on a public view" assertion); **25/25
  mobile tests unchanged**; `apps/admin` typechecks clean against the
  updated shared owner-view type.
- Rebuilt and restarted the live local API (it was running a pre-session
  build) so the new column/DTOs were actually live, then, against the
  real running API/PostgreSQL and the real JOVO MARKET account
  (`+970590000004`) through the mobile app's Expo web export in a real
  browser: added four real test products through the actual form — a
  simple item, a variable-weight item (also incidentally exercised
  `isFeatured`), one with SKU + barcode, and one built specifically to
  round-trip `costPriceMinor` (2000/1375 minor units in, confirmed exactly
  2000/1375 back via a direct authenticated API read) — then deleted all
  four (via the API — see gap below) and confirmed the product count
  returned to exactly the pre-existing 6.

### Known gaps, not fixed this session (flagged, not silently skipped)

- **No delete action exists anywhere in the mobile catalogue UI**, despite
  a working `DELETE /restaurant/me/menu/items/:itemId` backend endpoint
  that refuses only once an item has been ordered. Today a mis-entered
  product can only be "paused" (marked unavailable), never removed. This
  session's own test-product cleanup had to go through the API directly
  for exactly this reason. Worth a follow-up if fat-fingered entries turn
  out to be common during the real data-entry pass.
- The `apps/admin` business self-service `CataloguePage` (see audit
  findings above) does not have `costPriceMinor`, `brand`, `isFeatured`,
  `isVariableWeight`, or `reorderLevel` — left alone since the mobile
  Workspace is the tool with the established track record, but flagged in
  case the user actually enters data there instead.
- `isAvailable` (pause/resume) remains a list-row action, not a form
  field — unchanged, since a freshly created product should default to
  available, matching every existing product's behavior.

## 2026-08-16 (follow-up): Completing the admin web CataloguePage, and adding guarded delete

Branch `agent/phase-15-and-jovo-brand`. The user is switching to keyboard
data entry on a computer for the hundreds of real JOVO MARKET products, so
this closes the two gaps flagged at the end of the mobile-form session
above: `apps/admin`'s business self-service catalogue form was missing
fields the mobile form already had, and neither surface could delete a
mis-entered product.

### 1. `apps/admin/src/pages/business/CataloguePage.tsx` — completeness pass

- Added `costPriceMinor` (new field, mirrors the mobile session's schema
  work — `apps/admin`'s `MenuItemOwner` type just needed the field added,
  the backend already supports it), `brand`, `reorderLevel`, and toggle
  buttons for `isFeatured`/`isVariableWeight` — the same four fields
  flagged as missing in the prior audit.
- **Found and fixed a real unit-mismatch bug while doing this, not asked
  for but directly in scope**: the price input's own placeholder read
  "Price (agorot)" — this form took `priceMinor` as a raw integer typed
  directly into the field (`body.priceMinor = Number(draft.price)`), unlike
  the mobile form, which always took shekels and multiplied by 100. Typing
  "12.50" here silently became 1250 *agorot* = 12.50 ILS by coincidence
  only for whole numbers — a decimal price like "12.50" would have produced
  12 (rounded) instead of 1250. Converted both the create/update path and
  `startEdit`'s pre-fill to shekels-in/shekels-out, exactly like the mobile
  form, with the same "what the customer pays" / "what you paid for it"
  label wording so the two tools read identically.
- Field order: name, category, price, cost price, unit, description, image
  URL, then (supermarket only) brand/SKU/barcode, stock/reorder level,
  featured/variable-weight toggles — same ordering rationale as the mobile
  pass.
- Replaced the disabled-button-only validation with explicit inline errors
  (empty name, invalid/negative price, invalid/negative cost price),
  surfaced through the page's existing `error-banner` — no new UI pattern
  needed, this page already had one.
- **Checked for the mobile session's reset-before-confirm bug and it does
  not exist here**: `submitItem`'s `setDraft(emptyDraft)` was already
  sequenced *after* the awaited `create`/`updateBusinessItem` call inside
  the same try block `run()` wraps, so a thrown error already skips past
  the reset and lands in `run()`'s `catch`. Verified live (see below) by
  triggering a validation error mid-edit and confirming every field —
  including brand/SKU/barcode/toggles — was still populated.
- Product table gained a "Cost" column (dash when unset), next to Price.

### 2. Guarded delete, both business types

- `apps/admin`'s delete button already called the existing guarded
  `DELETE /restaurant/me/menu/items/:itemId` (unmodified this session —
  `menu.service.ts`'s `deleteItem` already refuses with `409
  MENU_ITEM_IN_USE` once any `OrderItem` references the product, exactly
  as the user asked to reuse), but fired with no confirmation at all.
  Added `apps/admin/src/components/ConfirmModal.tsx` — a new, generic
  yes/no confirmation dialog reusing the existing `ReasonModal`'s visual
  shell (`.reason-modal-*` CSS classes) without requiring a written reason,
  since a delete needs a decision, not a text field. Wired it into both the
  product delete button (with the product's name interpolated into the
  prompt) — category delete was left on its plain click, unchanged, since
  it was out of the fields/products scope this pass covered.
- No backend or mobile changes were needed for the guard itself; only the
  new confirmation step is new code.

### Verified

- `npm run typecheck` and `npm test` clean across all three workspaces —
  same counts as the prior session (204/205 API, 25/25 mobile) plus
  `apps/admin`'s own clean `tsc --noEmit` and `vite build`.
- Against the live local API/PostgreSQL and the real JOVO MARKET account,
  through the actual running `apps/admin` dev server in a real browser:
  - Added a simple product (name, price, cost price) — round-tripped
    exactly (9.50 / 6.00 ILS) via the products table's new Cost column.
  - Added a fully-loaded product (all fields: brand, SKU, barcode, unit,
    stock, reorder level, both toggles, description, cost price) —
    confirmed every single field round-tripped exactly via a direct
    authenticated API read (`priceMinor: 2275`, `costPriceMinor: 1540`,
    `brand: "Test Brand"`, `sku`, `barcode`, `stockQuantity: 40`,
    `isFeatured: true`, `isVariableWeight: true`, `reorderLevel: 5`).
  - Edited that product with the name cleared: the inline "Enter a name
    before saving" error appeared and **every other field — price, cost,
    brand, SKU, barcode, stock, both toggles — was still exactly as
    entered**, confirming no reset-before-confirm bug. Fixed the name and
    saved successfully on the next attempt.
  - Deleted the simple product via the new confirm dialog (cancel-by-
    backdrop-click and the confirm button both worked); confirmed removed
    from the table.
  - **Guard test, not just the happy path**: placed a real customer order
    against the full-field product (`POST /orders`, seeded customer
    `+970590000000`), confirmed the delete confirmation dialog surfaced
    the backend's exact guard message — "This product appears on past
    orders and cannot be deleted. Mark it unavailable instead." — and the
    product stayed in the table. Removed the test order directly in
    PostgreSQL afterward (no API path un-places an order; this was purely
    to un-block cleanup of a product created only for this test), then
    deleted the product successfully through the same UI flow.
  - Final count confirmed via both the UI and a direct API read: exactly
    the original 6 seeded products, nothing extra, nothing missing.

### Handoff notes for whoever picks this branch up next

**State: both catalogue-entry surfaces are done, committed, and pushed to
`agent/phase-15-and-jovo-brand`.** The user (JOVO MARKET's owner) is about
to start real bulk data entry through the `apps/admin` web portal
(`/business/catalogue`, logged in as a `RESTAURANT`-role/`SUPERMARKET`-
business-type account — same login as the mobile app). Nothing here should
need follow-up unless real data entry turns up a field or edge case this
session didn't anticipate.

**What changed, in one paragraph:** `MenuItem.costPriceMinor` is a new
nullable column (migration `20260815223840_phase15b_menu_item_cost_price`,
already applied to the local database — a fresh clone/deploy still needs
`prisma migrate deploy`). It's owner/admin-only, gated by the same
`MANAGE_PRICES` permission as the sale price, and deliberately excluded
from every customer-facing view. Both the mobile Restaurant/Supermarket
Workspace (`apps/mobile/src/features/restaurant/management-screen.tsx`)
and the admin web business portal (`apps/admin/src/pages/business/
CataloguePage.tsx`) now expose every `MenuItem` field except `imageUrl`'s
upload (still a plain URL field, by explicit request — no image upload
exists anywhere in this codebase), have matching shekels-in/shekels-out
price and cost-price entry with clear labels, inline validation instead of
silently-disabled buttons, and a guarded delete (refuses once an item has
been ordered, same backend rule reused by both surfaces) with a
confirm-before-delete step on the web portal specifically (mobile still has
no delete UI at all — see gap below).

**Known gaps, deliberately not fixed — read before assuming something is
broken:**
- **Mobile still has no delete UI**, only pause/resume. This was flagged
  after the first (mobile-only) session and intentionally not built,
  because the second session's follow-up request scoped delete to the web
  portal specifically ("I'll be entering data from my computer, not my
  phone"). If mobile data entry becomes relevant again, port the same
  `ConfirmModal` pattern (or the mobile app's own toast/dialog convention)
  and wire it to the same already-guarded `DELETE
  /restaurant/me/menu/items/:itemId` endpoint — no backend work needed.
- **Category delete has no confirmation** on either surface — only product
  delete got the confirm-modal treatment this session, since that's what
  was asked for. Category delete is already guarded server-side (refuses
  while the category still holds products), so the risk is lower, but it's
  inconsistent UX now that products have a confirm step and categories
  don't.
- The seeded product **"حمص" has an Arabic-only name** and shows
  untranslated in the English UI — this is pre-existing seed data, not
  application code, flagged repeatedly across sessions so it isn't
  mistaken for a new bug.
- **Nothing about margin/profit calculation exists yet.** `costPriceMinor`
  is stored and displayed (both catalogue forms show a "Cost" column/value
  next to price), but no screen computes a margin, markup percentage, or
  profit report from it. That's real future work, not an oversight — the
  original request was explicitly "store it now so I don't have to revisit
  every product later," not "build the margin report."

**Local environment, as left at the end of this session** (useful if you
pick this up on the same machine): the API is running as a detached
`node --enable-source-maps dist/main` process on port 3000 (rebuilt with
this session's schema/DTO changes — if you change `schema.prisma` again,
rebuild and restart it the same way, since a running process doesn't pick
up a new Prisma client on its own), PostgreSQL is the `tasawaq-postgres`
Docker container, and the `impaired-villain-itinerary.ngrok-free.dev`
tunnel is still pointed at the local API for device testing. The admin
web (`apps/admin`, port 5173) and mobile Expo web (port 8088) dev servers
used for this session's browser verification were both stopped afterward
— start either with `npm run dev`/`npx expo start --web` from the
respective `apps/` directory when next needed. Seeded test accounts used
throughout: JOVO MARKET owner `+970590000004`, customer
`+970590000000`, both password `Test@12345`.

## 2026-08-19: Phase 15.6 — The accounting layer

The whole money layer for a cash-on-delivery business: what every party is
entitled to, who is physically holding customers' cash, and what has actually
been paid. Those are three different questions and the design never lets them
collapse into one.

### The two things being tracked, kept apart on purpose

**Entitlement** — `OrderFinancialRecord` (one order's money, frozen at its
terminal outcome) and `PartnerEarning` (one party's signed, append-only share
of one source). **Cash custody** — `DriverCashCustody` (what a driver took at
the door) and `CashSettlement` (a handover event, with what was expected, what
was counted, and the difference). **Payment** — `PartnerSettlement`, separate
again, because "earned 1,400" and "was paid 1,400" answer different questions
and a system that reports only their difference cannot say whether anyone has
been paid.

A driver holding 320.00 of customers' money while being owed 14.00 in pay is
two facts about two pockets. The API reports them side by side and never nets
them; the admin screen shows them in adjacent columns.

### Completed

- **Every rate is configurable and versioned.** `FinancialRateSet` carries the
  commission (standard and promotional), the subscription, the commission
  split, the supermarket margin split, the *separately configured* cost split,
  the driver's delivery share and the three weights that divide what is left.
  A rate never changes in place: it is immutable at the database level, so a
  change means publishing a version. Migration `20260818150121` seeds version 1
  with the agreed model.
- **Historical snapshots are real.** `Order.financialRateSetId` and
  `Order.commissionBpSnapshot` are stamped as the order is taken, and
  `OrderItem.costPriceMinorSnapshot` freezes what the platform paid for each
  line. A commission halved next month cannot restate last month's payouts —
  verified end to end, not merely intended.
- **The two verticals are structurally different code paths**, as they should
  be. A restaurant is paid its merchandise less commission; a supermarket
  partner is paid the cost of the goods and then shares the margin 40/30/30.
  Only the delivery fee, which behaves identically either way, is shared code.
- **The delivery-fee remainder now reaches its partners.** The `TODO` in
  `delivery.rules.ts` is resolved: the driver's 70% is joined by delivery
  operations and the two owners dividing the remaining 30% evenly. A driver's
  own figures are now read from the ledger rather than recomputed, so there is
  one source of truth for what a driver has earned.
- **Discount scope decides who absorbs a promotion.** A business-scoped offer
  comes off the business; a platform-scoped one off the two owners, with the
  business paid as though the promotion had not happened. A promotion whose
  scope was never recorded (see 15.6a) is carried by the platform and reported
  as unattributed, because a business must never be billed for a discount
  nobody can attribute.
- **Failed deliveries follow the recorded fault, not a blanket rule.** The
  business is still paid for goods that left the premises and the driver is
  still paid for the attempt; one party then carries the whole uncollected
  amount, chosen from the delivery's `faultParty`. A fault attributed to the
  driver deliberately still lands on the platform — charging a driver is a
  decision about a person's pay and belongs to a human making an adjustment,
  not to a default that fires when a reason code is picked from a list.
- **Supermarket operating costs are a workflow, not a calculation.** The
  supermarket side reports a cost and it stays `PROPOSED`, charging nobody,
  until someone holding `APPROVE_OPERATING_COSTS` decides. Approval freezes the
  rate set onto the entry and writes the three-way split in the same
  transaction. There is no approve route on the business controller at all.
- **Subscriptions** bill each restaurant once a month, skip promotional
  partners entirely rather than charging them zero, and are safe to re-run.
- **Corrections are entries, never edits.** `FinancialAdjustment` carries a
  reason, an actor, a timestamp and its own ledger rows; the original record
  still says exactly what it said.

### The guarantees live in the database

37 CHECK constraints, and the ones that matter are not decorative:

- `OrderFinancialRecord.orderId` is unique, so an order cannot be valued twice.
- `PartnerEarning` is unique on `(sourceType, sourceId, payeeKey, component)`,
  so one source cannot credit one party for the same reason twice.
- `DriverCashCustody_never_oversettled` — `settledAmountMinor <=
  collectedAmountMinor`. Double settlement is impossible at the database level,
  not merely checked a few lines earlier in a service.
- `CashSettlement.reference` and `PartnerSettlement.reference` are unique, so a
  retried handover or payout is refused rather than posted twice.
- Nine triggers refuse any `UPDATE` or `DELETE` on financial history.
  `DriverCashCustody` is the one financial table that may legitimately change,
  and only upward, and only in its settled amount.

Genuine repair takes an explicit, visible route: drop the trigger, fix, restore
— which is what `src/integration/financial-triggers.util.ts` does for test
fixtures and what a repair migration would do in production.

### Verified

- `npm run typecheck` clean across all three workspaces; **API 271 pass, 2
  skipped by design, 0 fail** (up from 204, with 40 new money tests); `apps/admin`
  builds; **`npm run test:e2e` 21/21**.
- **The money tests are worked examples with the arithmetic spelled out**, not
  assertions comparing a function to itself. Every distribution is checked
  against the cash actually collected, and a loop confirms every amount from 0
  to 999 splits three ways without gaining or losing an agora.
- **The end-to-end suite runs against real PostgreSQL**, because the guarantees
  above cannot be demonstrated against a test double. Nineteen checks including
  both worked examples, partial settlement, a repeated handover refused, an
  already-settled order refused by both the service and the database, the
  cost-approval workflow, a rate change leaving an already-taken order
  untouched, and the ledger refusing to be edited.

#### Worked example — restaurant, 110.00 collected

```
items 2 x 50.00                       100.00
delivery fee (minimum)                 10.00
customer pays in cash                 110.00

commission 20% of 100.00               20.00  -> Mohammad 10.00, Khaldoun 10.00
restaurant  100.00 - 20.00             80.00
driver      70% of 10.00                7.00
remainder   10.00 - 7.00                3.00  -> Abdullah 1.00, Mohammad 1.00,
                                                 Khaldoun 1.00
--------------------------------------------
80.00 + 20.00 + 7.00 + 3.00           110.00   = exactly what was collected
```

#### Worked example — JOVO MARKET, 210.00 collected

```
goods at retail 2 x 100.00            200.00
delivery fee (minimum)                 10.00
customer pays in cash                 210.00

cost of goods                         140.00  -> supermarket partner, in full
margin 200.00 - 140.00                 60.00  -> partner 40%  24.00
                                                 Mohammad 30% 18.00
                                                 Khaldoun 30% 18.00
driver 70% of 10.00                     7.00
remainder                               3.00  -> 1.00 each, three ways
--------------------------------------------
supermarket partner 140.00 + 24.00    164.00
Mohammad 18.00 + 1.00                  19.00
Khaldoun 18.00 + 1.00                  19.00
Abdullah                                1.00
driver                                  7.00
--------------------------------------------
total                                 210.00   = exactly what was collected
```

- **Both examples were also placed as real orders** through the running local
  API against the real JOVO MARKET account, and the resulting records matched
  line for line — including a live browser check of the admin screens in both
  Arabic and English. A partial handover of 150.00 was recorded through the
  actual UI: cash handed over 150.00, still held 60.00, the order correctly
  left open rather than marked settled, and the driver's 7.00 of earnings
  untouched. The 2,500.00 rent entry was approved through the UI and charged
  1,000.00 / 750.00 / 750.00, with the ledger check still reading Balanced.
  All of that verification data was removed afterwards; the financial tables
  are back to zero rows, JOVO MARKET is back to its original 6 products, and
  all nine triggers are enabled.

### Three fixes this work required

- **The e2e runner now sets `RESTAURANT_ORDERING_ENABLED`.** A suite cannot set
  it itself: TypeScript hoists imports above statements, so `ConfigModule` read
  the environment before the assignment ran and the restaurant vertical stayed
  silently behind its launch gate. This had been failing the Phase 13 suite;
  it passes again.
- **`FinancialRateSet.createdByUserId` is now `RESTRICT`**, matching every other
  actor reference in the layer. As `SET NULL`, deleting a user issued an
  `UPDATE` the append-only trigger refused — a confusing failure for something
  that should simply not be allowed.
- **A migration grants `PROPOSE_OPERATING_COSTS` to `BUSINESS_ADMIN`.**
  `SystemRolesService` deliberately never rewrites a business role's
  permissions, so a new capability reaching existing roles is a reviewed data
  change rather than a silent one on deploy. Worth remembering for the next
  permission added.

### Decisions worth knowing about

- **Financial records are produced at `DELIVERED` *and* `DELIVERY_FAILED`.**
  The brief said "at DELIVERED only", contrasted with cancelled and rejected
  orders producing none. A failed delivery is neither: money genuinely moves
  (15.6a added the state for exactly that reason, and the failed-delivery rules
  would otherwise be dead letters). Cancelled and rejected orders still produce
  nothing at all.
- **A driver's 70% is taken from the fee before any delivery-fee promotion.**
  A discount is funded by whoever offered it, never out of the driver's pay.
- **Splits use largest-remainder allocation**, so three shares of 10.01 come to
  3.34 / 3.34 / 3.33 and never to 3.34 × 3. Ties break toward the earlier
  weight, which makes the result deterministic and therefore testable.
- **Every computation re-checks itself** against the cash collected before it
  is returned. If a rate, a price, or a promotion snapshot ever drifts, the
  delivery fails loudly rather than writing a ledger that is quietly a few
  shekels out.
- **A cost with an unknown price is flagged, not guessed.** A supermarket line
  with no recorded cost price is treated as zero — which overstates the margin
  — and the record carries `costDataComplete: false` so the number reads as
  provisional rather than exact.

### Known gaps, deliberately not built

- **No `PartnerSettlement` for a partial entitlement.** An earning is cleared by
  exactly one payout (unique on `earningId`), so a payout that does not match a
  whole set of earnings leaves a legitimate unallocated remainder. Balances are
  always `SUM(earnings) - SUM(payouts)` regardless, so nothing is lost —
  allocations are provenance, not the arithmetic.
- **`NET_OF_EARNINGS` handover mode exists in the schema but is not
  implemented.** Handovers are gross today, as agreed; the column is there so
  netting can be switched on later without a rebuild.
- **No scheduled job runs the monthly subscription.** The endpoint exists and
  is safe to re-run; something has to call it.
- **The admin accounting screens are functional, not designed.** Plain tables,
  no visual pass — that belongs to the design phase, and nothing here presumes
  what it will look like.
- **Nothing recomputes the six pre-existing orders** that predate the ledger.
  They were delivered before any of this existed and have no financial record;
  the reconciliation check would refuse two of them anyway, since they carry the
  service fee removed in 15.6a.

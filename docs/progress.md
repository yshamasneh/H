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

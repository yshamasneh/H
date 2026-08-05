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

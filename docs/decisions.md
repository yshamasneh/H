# Decisions

## 2026-08-04: Persist authentication in PostgreSQL

The earlier Express demo and in-memory users/sessions were replaced by NestJS, Prisma, and PostgreSQL. Database uniqueness on normalized phone is the final duplicate-account protection, with serializable transactions handling signup races.

## 2026-08-04: Phone-only customer identity

Customer registration and login use only `+970` or `+972` phone numbers. The country prefix and local number are separate in the app and normalized with `libphonenumber-js` in both client and server. Public clients cannot choose a role; self-registration always creates `CUSTOMER`.

## 2026-08-04: Free terminal OTP for development

OTP delivery is behind a provider interface. The current provider prints the code only in the NestJS terminal, while PostgreSQL stores an HMAC bound to challenge, phone, and purpose. Production startup rejects this provider. A real WhatsApp Business or SMS implementation can replace the provider without changing auth flow code.

## 2026-08-04: Stateful refresh and reset credentials

Access tokens are short-lived JWTs. Refresh and reset tokens are opaque random values whose hashes are persisted so they can be rotated, revoked, and consumed once. A successful password reset increments the access-token version and revokes all refresh sessions.

## 2026-08-04: Keep the existing native mobile setup

The Expo SDK 54 development-client, checked-in Android project, three-second branded splash, logo asset, SecureStore use, and VS Code tasks were preserved. Authentication screens use the project's existing lightweight conditional navigation style.

The checked-in Android project is the native source of truth. Expo Doctor's app-config synchronization warning is disabled explicitly for that reason; native configuration changes must be applied to Android Studio files as well as app config when applicable. The existing square Android launcher icons remain unchanged, while the wide TasawaQ asset remains the in-app and splash logo.

## 2026-08-04: Use npm workspaces locally

The repository keeps `pnpm-workspace.yaml` for compatibility with the original specification, while exact local commands use the installed npm workspace setup.

## 2026-08-04: Restaurant status names diverge from the original spec

The spec's own `Restaurant` table design (§9) uses `status: PENDING | ACTIVE | SUSPENDED`. Phase 3 instead implements `RestaurantStatus: PENDING | APPROVED | REJECTED`, matching an explicit approval-workflow requirement given for this phase. `APPROVED` plays the role the spec gave `ACTIVE`; there is no `SUSPENDED` state yet because no endpoint changes an already-approved restaurant's status in this phase. Admin suspension of a live restaurant is left for a later phase and will need its own decision about whether to reuse or extend this enum.

## 2026-08-04: Restaurant owner accounts self-register without OTP, then use the existing login endpoint

Customer signup verifies phone ownership through an OTP challenge before the account exists. Restaurant onboarding in Phase 3 skips that: `POST /api/v1/restaurants/register` creates a `RESTAURANT`-role `User` and a `PENDING` `Restaurant` in one transaction, with `phoneVerifiedAt` set immediately (self-attested, not SMS-verified) so the existing, unmodified `POST /api/v1/auth/login` works for the new role without any changes to the auth module. This was chosen over building a second OTP flow or a JWT-issuing registration response because it reaches a working restaurant-onboarding path with the least new surface area, and it leaves the auth module exactly as it was validated in the customer-auth phase. It also means a restaurant owner can log in and manage their profile/menu before an admin approves the restaurant — only the public catalog is gated on `status = APPROVED`. Registration does not accept a role from the client; it always creates `RESTAURANT`, matching the "public clients cannot choose a role" rule from Phase 2.

## 2026-08-04: Menu category and item ownership is resolved from the authenticated user, never from a client-sent restaurant id

Every `/api/v1/restaurant/me/...` endpoint looks up the caller's restaurant via `Restaurant.ownerUserId = request.user.id` — the restaurant id itself never appears in the URL or body for the owner-portal routes. For category/item mutation endpoints where a resource id *is* in the URL (e.g. `PATCH /restaurant/me/menu/items/:itemId`), the service re-checks that the resource's `restaurantId` matches the caller's own restaurant before allowing the change, and returns a generic `404` (not `403`) on mismatch so a restaurant cannot learn that another restaurant's item id exists. A `RolesGuard` (`common/guards/roles.guard.ts`) plus `@Roles()` decorator were added to enforce `RESTAURANT`/`ADMIN` role checks on top of the existing `JwtAuthGuard`, reused as-is.

## 2026-08-04: Admin approval is a minimal, dedicated pair of endpoints

`POST /api/v1/admin/restaurants/:id/approve` and `.../reject` only work on a restaurant currently in `PENDING` status (`RESTAURANT_NOT_PENDING` otherwise) — no free-form status endpoint. A full admin panel, an `AuditLog`, and a rejection-reason field are out of scope for Phase 3 and were deliberately not added; the spec's own admin section is deferred to a later phase. An `ADMIN` seed account (`+970590000001` / `Test@12345`) was added so the approval flow is testable locally without a real admin panel.

## 2026-08-06: Delivery address is stored as plain fields on `Order`, not a reusable `Address` model

Phases 1-3 never built the spec's `Address` table (§9), so Phase 4 had a real choice between adding one now or taking the task's documented fallback of "plain fields: label, line, lat/lng." Building a full saved-address book (CRUD, default address, per-customer list) is a customer-profile feature orthogonal to checkout correctness, and Phase 4's actual mandate is server-side pricing/snapshot correctness for the order transaction itself. `Order` therefore carries `deliveryLabel`, `deliveryAddressLine`, `deliveryLatitude`, and `deliveryLongitude` (the last two optional) entered fresh at checkout each time. `deliveryLatitude`/`deliveryLongitude` have no input UI in the mobile checkout screen in this phase — there is no map/location picker anywhere in the app yet — so they are always stored `null` today; the columns exist so a future location picker or `Address` book can populate them without another migration. A dedicated `Address` model with its own CRUD endpoints is deferred to whenever a real "saved addresses" feature is requested.

## 2026-08-06: Fee calculation is a single isolated flat-rate function

`calculateOrderFees(subtotalMinor)` in `apps/api/src/orders/pricing.ts` returns a flat `deliveryFeeMinor` (500, i.e. 5.00 ILS) and flat `serviceFeeMinor` (200, i.e. 2.00 ILS), ignoring the subtotal entirely. Real delivery pricing (distance/zone-based fees, restaurant-specific service fees, surge pricing) is explicitly out of scope for this phase per the task brief; the only requirement was that the calculation be simple, documented, and isolated so it can be replaced by a real rules engine later without touching `OrdersService.createOrder`'s transaction logic. `discountMinor` is hardcoded to `0` for the same reason — there is no coupon/promo system yet.

## 2026-08-06: `OrderStatus` only has `PLACED` and `CANCELLED` in this phase, and nothing transitions to `CANCELLED` yet

The task brief was explicit that Phase 4 owns order creation only, and Phase 5 owns restaurant-side status transitions (`ACCEPTED`, `PREPARING`, etc.). The Prisma enum was kept to exactly the two values named in the brief rather than pre-adding the full spec state machine (§8), since an enum with unused-until-later values is easy to extend in a future migration and adding it now would be speculative. No endpoint in this phase ever writes `CANCELLED` — every order created here stays `PLACED` — so `CANCELLED` currently exists in the schema but is unreachable; a customer-facing cancel endpoint is left for Phase 5 to design alongside the rest of the transition map, since cancellation rules (e.g. "only before the restaurant accepts") depend on states this phase doesn't have.

## 2026-08-06: `OrderPaymentMethod` is a real Prisma enum with one member (`CASH`)

Matches the same pattern the task asked for explicitly: model it as an enum now so adding a second payment method later is a migration plus a DTO change, not a schema redesign. The mobile checkout screen renders payment options by iterating `orderPaymentMethodValues`/`orderPaymentMethods` (backend and mobile each keep their own small `as const` array mirroring the enum, matching how `restaurantStatusValues` already does this in `restaurants.dto.ts`) instead of hardcoding a single "Cash on Delivery" button, so a second method appears in the UI automatically once the array grows.

## 2026-08-06: `OrdersService` re-resolves restaurant ownership with its own Prisma query instead of importing `RestaurantsService`

`GET /restaurant/me/orders` and `GET /restaurant/me/orders/:id` need the same `Restaurant.ownerUserId = request.user.id` lookup Phase 3's `RestaurantsService.requireOwnRestaurant` already does. Rather than exporting `RestaurantsService` from `RestaurantsModule` and importing it into the new `OrdersModule` (which would mean modifying Phase 3's module wiring to serve a Phase 4 need), `OrdersService` has its own private `requireOwnRestaurant` that runs the identical one-line `prisma.restaurant.findUnique({ where: { ownerUserId } })` query. This keeps the `orders` module decoupled from `restaurants` module internals — the only thing Phase 4 reads from Phase 3's domain is `Restaurant` and `MenuItem` rows via the shared Prisma client, never Phase 3's service classes — matching the task's "don't touch Phase 3 restaurant/menu code except to reference it" boundary literally.

## 2026-08-06: Cart lives in `App.tsx` component state, not a new state library

The spec (§18) explicitly allows Zustand for the cart but the codebase has never introduced it — Phase 2 and 3 both kept navigation and session as plain `useState`/typed-union state in `App.tsx`, and the task instructions for this phase repeat "do not introduce a new state-management library." `Cart` (`apps/mobile/src/cart.ts`) is therefore a single `useState<Cart | null>` held by `TasawaQApp`, passed down to `RestaurantMenuScreen`, `CartScreen`, and `CheckoutScreen` as props, with pure functions (`startCart`, `addCartItem`, `setCartItemQuantity`, `removeCartItem`) doing the actual mutations — the same "pure helpers + lifted `useState`" shape the existing `navigation.ts` already uses for screen transitions. It is not persisted (matches §18: "no Cart table," and the task's "local app state, not persisted server-side until checkout"). Restaurant-mismatch handling uses React Native's built-in `Alert.alert` confirm/cancel dialog (a native modal, not a web `confirm()` — the app has no other bespoke modal component to reuse) to ask the customer whether to clear the cart before adding an item from a different restaurant, per the task's explicit requirement not to silently mix restaurants.

## 2026-08-06: Token storage extracted from `App.tsx` into `src/session.ts`

Before this phase, `App.tsx` was the only place that ever needed the stored access/refresh tokens (login, restore-session, logout), so the SecureStore keys and helpers lived as local consts/functions there. Checkout, order history, and order detail are now separate leaf screens that each need the access token to call authenticated endpoints, and passing it down as a prop through every intermediate screen (including ones that don't otherwise need it) would spread auth plumbing across unrelated components. `src/session.ts` centralizes the SecureStore keys and `getAccessToken`/`getRefreshToken`/`saveTokens`/`clearTokens`, and `App.tsx` now imports from it instead of defining them inline. This is a mechanical extraction with no behavior change to the existing login/logout/restore-session flow.

## 2026-08-06: Order migration was hand-authored and not applied to a live database

This development environment has no Docker daemon and no local PostgreSQL install available, so `prisma migrate dev` could not be run against a real database the way Phase 2 and 3's migrations were created. The migration SQL (`prisma/migrations/20260806000000_orders_cart_checkout/migration.sql`) was instead written by hand, following the exact style Phase 3's migration already established (enum/table/index/FK ordering, and manually-added `CHECK` constraints on every money and quantity column, mirroring `MenuItem_priceMinor_check`). `prisma generate` and `prisma validate` both succeed against the updated schema, and the full test suite runs entirely against the existing in-memory `Fake*Prisma` test doubles (no test in this repo touches a real database), so lint/typecheck/tests/build all verify clean. Before this branch is deployed anywhere, run `npm run prisma:migrate` (or `prisma migrate deploy` against the target database) once to confirm the hand-written SQL applies cleanly — it has not been executed against Postgres in this session.

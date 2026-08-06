# Architecture

TasawaQ is an npm workspace with two runnable applications:

- `apps/mobile`: Expo React Native application and native Android development project.
- `apps/api`: NestJS API backed by PostgreSQL through Prisma.

## Authentication data

`User` is the persistent identity. Public signup can create only `CUSTOMER` users. Phone numbers are unique normalized E.164 values restricted to `+970` and `+972`. Passwords use Argon2id hashes.

`PendingCustomerRegistration` holds a normalized phone, full name, and already-hashed password until phone verification. `PhoneVerificationChallenge` stores HMAC-SHA-256 OTP hashes, purpose, expiration, attempts, resend time, and consumption state. `RefreshSession` stores only a hash of each rotating refresh token. `PasswordResetToken` stores only a hash of each short-lived reset token.

## Signup sequence

1. The app validates the selected prefix, local number, full name, and matching password fields.
2. NestJS repeats validation and normalization and rejects a registered phone with `PHONE_ALREADY_REGISTERED`.
3. In one database transaction, the API upserts the pending registration and creates a signup challenge. Older active signup challenges are consumed.
4. The development provider prints the plain six-digit code only in the API terminal.
5. Verification checks purpose, HMAC, expiry, attempts, and consumed state.
6. A serializable transaction rechecks uniqueness, creates one verified active `CUSTOMER`, consumes the challenge, deletes the pending row, and creates access/refresh credentials.

## Login and session sequence

1. The API normalizes the phone and checks the Argon2id password hash.
2. Inactive or unverified users are rejected. Incorrect phone/password combinations share the generic `INVALID_CREDENTIALS` response.
3. A short-lived access JWT contains only identity/session claims. A rotating refresh token is represented in PostgreSQL by its SHA-256 hash.
4. The access guard verifies the JWT, session, active/verified user, and token version. Logout revokes the refresh session.

## Password reset sequence

1. Forgot Password creates an OTP only when the normalized phone belongs to an existing user.
2. OTP verification creates a random, short-lived, reset-only token and stores only its hash.
3. Password reset consumes the token atomically, changes the Argon2id hash, increments the user's token version, and revokes all refresh sessions.

## Mobile navigation

The mobile app preserves its lightweight typed state navigation instead of introducing a new navigation dependency. Routes cover Login, Customer Sign Up, Forgot Password, reusable OTP verification, New Password, and Home. Access and refresh tokens are stored with Expo SecureStore. The server-provided role controls home routing; the signup UI never accepts a role.

## Development infrastructure

Docker Compose runs PostgreSQL 17 with a health check and named persistent volume. Prisma migration `20260804190000_customer_phone_auth` creates all authentication tables, constraints, enums, indexes, and foreign keys. The native splash, TasawaQ logo, Android project, Expo development-client configuration, and VS Code tasks remain in place.

## Restaurants and menus

`Restaurant` belongs to exactly one `RESTAURANT`-role `User` (`ownerUserId`, unique). `status` is `PENDING | APPROVED | REJECTED`; `isOpen` is a separate toggle the owner controls directly. A restaurant only appears in the public catalog when `status = APPROVED AND isOpen = true`; its detail and menu endpoints only require `status = APPROVED`, so a temporarily closed restaurant stays reachable by direct link. `MenuCategory` and `MenuItem` belong to a restaurant; items also belong to a category. `MenuItem.priceMinor` is a Postgres `INTEGER` (never a float), matching the money-handling rule in the product spec. Categories use `isActive` and items use `isAvailable` as soft-disable flags instead of deletion, so historical orders (once orders exist) can still reference a since-hidden item.

### Restaurant onboarding sequence

1. `POST /api/v1/restaurants/register` validates a strong password pair, normalizes the phone the same way customer signup does, and rejects an already-registered phone with `PHONE_ALREADY_REGISTERED`.
2. One transaction creates a `RESTAURANT` `User` (with `phoneVerifiedAt` set immediately — there is no OTP step for restaurant onboarding) and a `PENDING` `Restaurant` owned by that user.
3. The owner logs in through the existing, unmodified `POST /api/v1/auth/login`. They can manage their profile and menu while `PENDING`; only the public catalog is gated on approval.
4. An `ADMIN` calls `POST /api/v1/admin/restaurants/:id/approve` (or `/reject`). Both only accept a restaurant currently in `PENDING` status.

### Restaurant-portal ownership

Every `/api/v1/restaurant/me/...` route resolves the caller's restaurant from `Restaurant.ownerUserId = request.user.id` — never from a client-supplied restaurant id. Where a category or item id does appear in a URL, the service re-verifies that resource's `restaurantId` matches the caller's own restaurant before reading or writing it, returning `404` (not `403`) on a mismatch. Role enforcement is a new `RolesGuard` + `@Roles()` decorator (`common/guards`, `common/decorators`) layered on top of the existing `JwtAuthGuard`, which is reused unchanged.

### Public catalog

`GET /api/v1/restaurants` (paginated), `GET /api/v1/restaurants/:id`, and `GET /api/v1/restaurants/:id/menu` require no authentication. The menu response only includes active categories and available items, each already filtered server-side — the mobile client does no additional filtering.

## Cart, checkout, and orders

`Order` belongs to one `CUSTOMER` `User` and one `Restaurant`. `OrderItem` belongs to an `Order` and references a `MenuItem`, but stores its own immutable `nameSnapshot`/`priceMinorSnapshot` taken at creation time — the two are never re-derived from live `MenuItem` rows after the order exists, even if the restaurant later changes that item's price or name. `OrderStatus` (`PLACED | CANCELLED`) and `OrderPaymentMethod` (`CASH`, modeled as an enum for future methods) are both intentionally minimal for this phase; every order created here stays `PLACED`, and the restaurant-side accept/reject/preparing transition map is Phase 5's work. Delivery address is three-to-four plain columns on `Order` (`deliveryLabel`, `deliveryAddressLine`, optional `deliveryLatitude`/`deliveryLongitude`) rather than a reusable `Address` model, since no address book exists yet in this codebase.

### Order-creation sequence

1. `POST /api/v1/orders` (`CUSTOMER`, JWT) runs entirely inside one Prisma transaction. It re-reads the restaurant by id and requires `status = APPROVED` and `isOpen = true`, re-reads every requested `menuItemId` scoped to that restaurant and requires `isAvailable = true` for all of them — if any single line fails, the whole order is rejected and nothing is written (no partial orders).
2. Subtotal is computed entirely from server-read `MenuItem.priceMinor` values; the create-order DTO does not even accept a client-supplied price field. `calculateOrderFees(subtotalMinor)` (`apps/api/src/orders/pricing.ts`) — an isolated, named function — returns a flat placeholder delivery fee and service fee that can be replaced with a real rules engine later without touching the transaction logic. `discountMinor` is hardcoded to `0` (no coupon system yet).
3. The `Order` and all `OrderItem` rows are created together in the same transaction, with snapshots taken at that moment, and the full order (items + restaurant summary) is returned to the client as the authoritative result.

### Order ownership

`GET /api/v1/orders/me` and `GET /api/v1/orders/:id` scope to `request.user.id` as `customerId`; a mismatched order id returns a generic `ORDER_NOT_FOUND`, the same pattern Phase 3 uses for cross-restaurant menu access. `GET /api/v1/restaurant/me/orders` and `.../:id` resolve the caller's restaurant the same way Phase 3's `RestaurantsService.requireOwnRestaurant` does (`Restaurant.ownerUserId = request.user.id`), but `OrdersService` runs that lookup itself via the shared Prisma client rather than importing `RestaurantsService`, keeping the `orders` and `restaurants` Nest modules decoupled.

### Mobile cart

The cart is a single `useState<Cart | null>` lifted into `App.tsx` (no new state-management library), backed by pure functions in `src/cart.ts`. It is scoped to one restaurant at a time; adding an item while the cart holds items from a different restaurant triggers a native `Alert.alert` confirm/cancel prompt before clearing it. The cart screen's running subtotal is explicitly labeled an estimate; checkout only ever displays totals returned by `POST /orders`, never a locally computed total. `src/session.ts` centralizes SecureStore access-token/refresh-token storage (extracted from `App.tsx`) so the new checkout/order-history/order-detail screens can read the access token without prop-drilling it through unrelated screens.

## Order status transitions (Phase 5)

`OrderStatus` is now `PLACED | ACCEPTED | PREPARING | READY_FOR_PICKUP | DELIVERED | REJECTED | CANCELLED`. `OrdersService` holds an explicit `allowedOrderTransitions` map (`apps/api/src/orders/orders.service.ts`); every write goes through `PATCH /api/v1/restaurant/me/orders/:id/status`, never a free-form status field. The update runs inside a transaction: it re-reads the current status, checks the transition map, applies the change with a conditional `updateMany({ where: { id, status: <expected current> } })` and verifies `count === 1` (the same guard style already used for refresh-token rotation in the auth module), then inserts an `OrderStatusHistory` row (`fromStatus`, `toStatus`, `changedByUserId`, optional `note`). `POST /orders` also inserts an initial history row (`fromStatus: null -> PLACED`) at creation time, so a freshly placed order already has a one-entry history. `GET /orders/:id` (customer) and `GET /restaurant/me/orders/:id` both return the full ordered `statusHistory` array via the same `toOrderDetailView` mapping. `CANCELLED` remains defined in the transition map (`PLACED -> CANCELLED`) but unreachable — no endpoint writes it yet, matching the precedent already set in Phase 4's decisions log.

## Driver and delivery flow (Phase 6)

`DriverProfile` is a 1:1 profile keyed directly by `userId` (`isOnline`, optional last known `lastLatitude`/`lastLongitude`). `Delivery` is 1:1 with `Order` (`orderId` unique) with its own `DeliveryStatus` (`PENDING_ASSIGNMENT | ASSIGNED | PICKED_UP | ON_THE_WAY | DELIVERED | CANCELLED`) and per-transition timestamps (`assignedAt`, `pickedUpAt`, `onTheWayAt`, `deliveredAt`). A new `drivers` Nest module (`DriversService`, `DriversController` for public registration, `DriverPortalController` for `DRIVER`-role routes) owns this flow.

- **Delivery creation**: when a restaurant transitions an order to `READY_FOR_PICKUP` (Phase 5's endpoint), `OrdersService` creates the `Delivery` row (`PENDING_ASSIGNMENT`) inside the same transaction as the status change — this is the one place Phase 6 touches Phase 5's `OrdersService`, matching the task's explicit "wire in the new status transition" allowance.
- **Atomic claim**: `POST /driver/me/deliveries/:id/accept` requires the driver to be online, then claims the delivery with `delivery.updateMany({ where: { id, status: PENDING_ASSIGNMENT, driverId: null }, data: { status: ASSIGNED, driverId, assignedAt } })` and checks `count === 1` inside a transaction — the same conditional-update-plus-count-check race guard used everywhere else in this codebase (refresh rotation, Phase 5's status transitions). Two simultaneous accept calls for the same delivery: exactly one succeeds, the other gets `DELIVERY_ALREADY_CLAIMED`.
- **Pickup-to-delivered**: `PATCH /driver/me/deliveries/:id/status` validates `PICKED_UP -> ON_THE_WAY -> DELIVERED` against an `allowedDeliveryTransitions` map and rejects any delivery not assigned to the calling driver (generic `DELIVERY_NOT_FOUND`, not `403`, to avoid confirming another driver's delivery exists — the same privacy pattern as cross-restaurant order access). Reaching `DELIVERED` also updates the parent `Order.status` to `DELIVERED` and appends an `OrderStatusHistory` row with `changedByUserId` set to the driver, inside the same transaction.
- **Availability**: `GET /driver/me/deliveries/available` lists every `PENDING_ASSIGNMENT` delivery — any online driver can see and accept any of them; there is no distance/matching algorithm, per this phase's explicit scope boundary. `GET /driver/me/deliveries` lists only the caller's own deliveries.
- **Driver onboarding**: `POST /api/v1/drivers/register` mirrors the restaurant self-registration pattern exactly (creates a `DRIVER` user with `phoneVerifiedAt` set immediately, self-attested, then the existing unmodified `POST /auth/login` works) — no admin-approval workflow, since building one would mean admin-facing endpoints, which this phase's scope explicitly excludes.
- **Customer visibility**: `GET /orders/:id` includes a `delivery` summary (status + timestamps, no driver PII) whenever a `Delivery` row exists for that order.

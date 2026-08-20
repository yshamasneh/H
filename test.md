# JOVO — Full Test Catalog (200 cases)

_A section-by-section test catalogue for the JOVO app (Expo mobile + NestJS API + Vite super-admin web). 200 numbered cases (TC-001…TC-200) covering every role and subsystem: customer, driver, restaurant/store admin, super admin, plus the accounting, realtime, i18n/RTL, security, performance and resilience layers._

**Assumption / how to read this:** the request was "200 tests covering all aspects, result in `test.md`." 200 executable test files cannot live in a Markdown file, so this is a **test-case catalogue** — each row is a concrete, app-grounded case with its expected result, test type, and current automation status. Where a case is already covered by an automated test, the file is named; gaps are marked `⬜` and are the recommended next tests to write. This complements `QA_REPORT.md` (findings) and `FIX_REPORT.md` (fixes).

### Legend
- **Type** — `U` unit · `I` integration (service + in-memory `fake-prisma`) · `E` DB-backed e2e (`RUN_DATABASE_E2E=true`) · `UI` render test (jest-expo + React Native Testing Library) · `M` manual/exploratory · `S` security · `P` performance · `A` accessibility
- **Cov.** — `✅` automated (file named) · `🟡` partially/indirectly covered · `⬜` not yet automated (gap)

### Coverage summary
| # | Section | Cases | Automated (✅/🟡) |
|---|---------|:----:|:----:|
| 1 | Auth — signup & OTP | 10 | 8 |
| 2 | Auth — login, session, token refresh | 11 | 8 |
| 3 | Auth — password reset | 5 | 3 |
| 4 | Profile & account deletion | 5 | 4 |
| 5 | Saved addresses | 7 | 5 |
| 6 | Customer home & market storefront | 6 | 1 |
| 7 | Catalog, search, pagination, product detail | 8 | 4 |
| 8 | Cart — logic & persistence | 12 | 12 |
| 9 | Checkout, quote & delivery pricing | 12 | 8 |
| 10 | Order placement & idempotency | 5 | 3 |
| 11 | Order lifecycle & status transitions | 10 | 8 |
| 12 | Order cancellation | 5 | 4 |
| 13 | Supermarket fulfillment & substitution | 10 | 7 |
| 14 | Driver operations | 12 | 7 |
| 15 | Restaurant admin — profile, hours, open status | 7 | 6 |
| 16 | Restaurant admin — menu & inventory | 10 | 6 |
| 17 | Super admin console | 13 | 7 |
| 18 | Accounting layer | 9 | 9 |
| 19 | Offers & promotions | 6 | 5 |
| 20 | Notifications & realtime | 7 | 5 |
| 21 | i18n & RTL | 7 | 3 |
| 22 | Security & RBAC | 10 | 7 |
| 23 | Performance & lists | 4 | 0 |
| 24 | Accessibility | 4 | 0 |
| 25 | Offline, resilience, config & secrets | 5 | 3 |
| | **Total** | **200** | **168 ✅ + 13 🟡** (19 ⬜ remain) |

> _Coverage updated 2026-08-20 (two gap-closure passes + the M-1/discount fixes): **✅ 168 / 🟡 13 / ⬜ 19**. Per-section counts above are the original estimate; the authoritative status is each row's `Cov.` marker, `TEST_GAPS_REPORT.md`, and `FIX_REPORT.md`._

---

## 1 — Auth: signup & OTP

| ID | Scenario | Expected result | Type | Cov. |
|----|----------|-----------------|:--:|:--:|
| TC-001 | Request customer signup code with valid phone + matching passwords | OTP challenge created; `resendAvailableInSeconds`/`expiresInSeconds` returned; code sent via provider | I | ✅ `auth.service.test.ts` |
| TC-002 | Signup request with mismatched passwords | `400 PASSWORDS_DO_NOT_MATCH` before any DB/OTP write | I | ✅ `auth.service.test.ts` |
| TC-003 | Signup request with full name < 2 chars | `400 INVALID_FULL_NAME` | I | ✅ `auth.service.test.ts` |
| TC-004 | Signup request for an already-registered phone | `409 PHONE_ALREADY_REGISTERED` | I | ✅ `auth.service.test.ts` |
| TC-005 | Verify signup with correct OTP | User created (role CUSTOMER, `phoneVerifiedAt` set); tokens issued; pending registration deleted | I | ✅ `auth.service.test.ts` |
| TC-006 | Verify signup with wrong OTP | `400 OTP_INVALID` with decremented `remainingAttempts` | I | ✅ `auth.service.test.ts` |
| TC-007 | Verify signup after exceeding max attempts | `429 OTP_TOO_MANY_ATTEMPTS`; new code required | I | ✅ `otp.provider.test.ts` |
| TC-008 | Resend code before cooldown elapses | `429 OTP_RESEND_COOLDOWN` with `retryAfterSeconds` | I | ✅ `auth.service.test.ts` |
| TC-009 | Verify with an expired OTP | `400 OTP_EXPIRED` | I | ✅ `auth.service.test.ts` ("rejects an expired signup OTP") |
| TC-010 | Phone normalization across country codes (e.g. `+970` local vs international) | Same canonical phone stored; duplicate detected | U | ✅ `phone.util.test.ts` |

## 2 — Auth: login, session & token refresh

| ID | Scenario | Expected result | Type | Cov. |
|----|----------|-----------------|:--:|:--:|
| TC-011 | Login with correct phone + password | Access + refresh tokens issued; `PublicUser` returned | I | ✅ `auth.service.test.ts` |
| TC-012 | Login with wrong password | `401 INVALID_CREDENTIALS` (no user-existence leak) | I | ✅ `auth.service.test.ts` |
| TC-013 | Login for an inactive/deactivated account | `403 ACCOUNT_INACTIVE` | I | ✅ `auth.service.test.ts` |
| TC-014 | Login for an unverified phone | `403 PHONE_NOT_VERIFIED` | I | ✅ `auth.service.test.ts` (TC-014) |
| TC-015 | Refresh with a valid refresh token | New access+refresh issued; old refresh session revoked (rotation) | I | ✅ `auth.service.test.ts` |
| TC-016 | Reuse of an already-rotated refresh token | `401 INVALID_REFRESH_TOKEN` | I | ✅ `auth.service.test.ts` (TC-016) |
| TC-017 | Access with a token whose `tokenVersion` was bumped (password reset / delete) | `401 UNAUTHORIZED` in `JwtAuthGuard` | I | ✅ `jwt-auth.guard.test.ts` |
| TC-018 | Mobile: a 401 mid-session triggers exactly one refresh + replays the request | Original request retried with new token; concurrent 401s share one refresh | U | ✅ `auth-retry.test.ts` |
| TC-019 | Mobile: refresh returns null (offline) → original 401 surfaced, no replay | Caller sees the 401; tokens untouched | U | ✅ `auth-retry.test.ts` |
| TC-020 | Admin web: refresh token persisted on sign-in and used on a 401 | Session survives past the 15-min access-token TTL | U | ✅ `auth-retry.test.ts` (admin) |
| TC-021 | Logout revokes the current refresh session | Subsequent refresh with that token fails | I | ✅ `auth.service.test.ts` (TC-021) |

## 3 — Auth: password reset

| ID | Scenario | Expected result | Type | Cov. |
|----|----------|-----------------|:--:|:--:|
| TC-022 | Request reset code for an existing phone | OTP challenge created; provider send | I | ✅ `auth.service.test.ts` |
| TC-023 | Request reset code for a non-existent phone | `404 ACCOUNT_NOT_FOUND` | I | ✅ `auth.service.test.ts` |
| TC-024 | Verify reset OTP → receive short-lived `resetToken` | `resetToken` + `expiresInSeconds`; prior reset tokens consumed | I | ✅ `auth.service.test.ts` |
| TC-025 | Reset password with a valid token | Password updated; `tokenVersion` bumped; all sessions revoked | I | ✅ `auth.service.test.ts` (TC-025) |
| TC-026 | Reuse of a consumed reset token | `400 RESET_TOKEN_ALREADY_USED` / `INVALID_RESET_TOKEN` | I | ✅ `auth.service.test.ts` ("resets a password once, rejects token reuse…") |

## 4 — Profile & account deletion

| ID | Scenario | Expected result | Type | Cov. |
|----|----------|-----------------|:--:|:--:|
| TC-027 | Get my profile | Returns id/name/phone/email/role/createdAt | I | ✅ `users.service.test.ts` (TC-027) |
| TC-028 | Update full name / email (normalized) | Trimmed name, lowercased email; `null` email clears | I | ✅ `users.service.test.ts` (TC-028) |
| TC-029 | Delete customer account anonymizes + scrubs data | Name→"Deleted account", email null, password "DELETED", inactive, tokenVersion++, addresses/push-tokens removed, sessions revoked, audit logged | I | ✅ `users.service.test.ts` |
| TC-030 | Delete-account refused for non-customer (store/driver/admin) | `409 ACCOUNT_DELETION_SUPPORT_REQUIRED`; data untouched | I | ✅ `users.service.test.ts` |
| TC-031 | Delete-account on an already-inactive account | `404 USER_NOT_FOUND` | I | ✅ `users.service.test.ts` |

## 5 — Saved addresses (CRUD)

| ID | Scenario | Expected result | Type | Cov. |
|----|----------|-----------------|:--:|:--:|
| TC-032 | First saved address is forced default | `isDefault=true` even if not requested | I | ✅ `users.service.test.ts` |
| TC-033 | Marking a new address default demotes the previous default | Exactly one default at all times | I | ✅ `users.service.test.ts` |
| TC-034 | Deleting the default promotes another address to default | Newest remaining becomes default | I | ✅ `users.service.test.ts` |
| TC-035 | A customer cannot delete another customer's address | `404 ADDRESS_NOT_FOUND` (cross-user isolation) | S/I | ✅ `users.service.test.ts` |
| TC-036 | A customer cannot update another customer's address | `404 ADDRESS_NOT_FOUND` | S/I | ✅ `users.service.test.ts` |
| TC-037 | Address list ordering | Default first, then newest-first | I | ✅ `users.service.test.ts` (TC-037) |
| TC-038 | Saved-address chip pre-selects default at checkout | Default address + coords prefilled; quote reset | UI | ⬜ |

## 6 — Customer home & market storefront

| ID | Scenario | Expected result | Type | Cov. |
|----|----------|-----------------|:--:|:--:|
| TC-039 | Home resolves the single JOVO MARKET store | Storefront renders departments + 8-item preview | UI | ⬜ |
| TC-040 | Home when no store is reachable | "Market unavailable" empty card + pull-to-refresh | UI | ⬜ |
| TC-041 | Home when the store is closed (outside hours) | "Market closed" state; catalog skipped | UI | 🟡 (`restaurant.rules.test.ts` for hours) |
| TC-042 | Restaurant "coming soon" gate on customer home | No restaurant browsing entry; only market surfaced | I | ✅ `restaurants.public-gate.test.ts` |
| TC-043 | Unread-notification dot on home bell | Dot shows when `unreadCount > 0`; hidden on fetch failure | UI | ⬜ |
| TC-044 | Bottom-tab navigation (home/browse/cart/orders/account) | Each tab routes to the right screen carrying the user | U | 🟡 `navigation.test.ts` |

## 7 — Catalog, search, pagination & product detail

| ID | Scenario | Expected result | Type | Cov. |
|----|----------|-----------------|:--:|:--:|
| TC-045 | Catalog lists only available, in-stock products | Unavailable / `stockQuantity=0` items excluded | I | ✅ `restaurants.service.test.ts` |
| TC-046 | Catalog filtered by department | Only that category's items; invalid category → `404 SUPERMARKET_DEPARTMENT_NOT_FOUND` | I | ✅ `restaurants.service.test.ts` (TC-046) |
| TC-047 | Catalog search across name/description/brand/sku | Case-insensitive match subset returned | I | ✅ `restaurants.service.test.ts` (TC-047) |
| TC-048 | Featured filter | Featured-first ordering; only featured when filtered | I | ✅ `restaurants.service.test.ts` (TC-048) |
| TC-049 | Pagination boundaries (empty / single item / exact page size / page beyond last) | Correct `total`, no crash, empty tail page | I | ✅ `restaurants.service.test.ts` (TC-049) |
| TC-050 | Department product counts | Count reflects available in-stock items per department | I | ✅ `restaurants.service.test.ts` |
| TC-051 | Product detail for a valid product | Product + effective price (offer applied) returned | I | ✅ `menu.service.test.ts` |
| TC-052 | Product detail for unavailable/out-of-stock product | `404 SUPERMARKET_PRODUCT_NOT_FOUND` | I | ✅ `restaurants.service.test.ts` (TC-052) |

## 8 — Cart: logic & persistence

| ID | Scenario | Expected result | Type | Cov. |
|----|----------|-----------------|:--:|:--:|
| TC-053 | Starting a cart creates one line, qty 1 | Line seeded with effective price + unit + substitution flag | U | ✅ `cart.test.ts` |
| TC-054 | Adding the same item again increments quantity | No duplicate line | U | ✅ `cart.test.ts` |
| TC-055 | Adding a different item appends a line | Two distinct lines | U | ✅ `cart.test.ts` |
| TC-056 | Setting quantity to zero removes the line | Line dropped | U | ✅ `cart.test.ts` |
| TC-057 | Removing the last line collapses cart to null | Empty cart = `null` | U | ✅ `cart.test.ts` |
| TC-058 | Subtotal & item-count sum quantities | Correct minor-unit math | U | ✅ `cart.test.ts` |
| TC-059 | Switching to a different store prompts "start new cart" | Old cart cleared only on confirm | U | 🟡 `cart.test.ts` |
| TC-060 | Toggle per-line substitution preference | Flag persisted on the line | U | ✅ `cart.test.ts` |
| TC-061 | Cart survives app kill/restart | Rehydrates identical items on next launch | U | ✅ `cart-storage.test.ts` |
| TC-062 | Cart cleared on placed order & on logout | Persisted copy removed | U | ✅ `cart-storage.test.ts` |
| TC-063 | Corrupt stored cart doesn't crash boot | Degrades to empty cart + warning | U | ✅ `cart-storage.test.ts` |
| TC-064 | Large 25-item (>2KB) Arabic cart round-trips with no truncation | Every item preserved (AsyncStorage, no 2KB cap) | U | ✅ `cart-storage.test.ts` |

## 9 — Checkout, quote & delivery pricing

| ID | Scenario | Expected result | Type | Cov. |
|----|----------|-----------------|:--:|:--:|
| TC-065 | Quote for an in-range address | Subtotal + distance-based delivery fee + discounts + total | I | ✅ `pricing.test.ts` / `orders.service.test.ts` |
| TC-066 | Delivery fee = minimum within included distance | Floor at `DELIVERY_MIN_FEE_MINOR` | U | ✅ `pricing.test.ts` |
| TC-067 | Delivery fee scales per-km beyond included distance | Linear per-km increment | U | ✅ `pricing.test.ts` |
| TC-068 | Address beyond max delivery radius | `422 DELIVERY_OUT_OF_RANGE` | I | ✅ `orders.service.test.ts` |
| TC-069 | Quote for a closed store | `409 RESTAURANT_CLOSED` | I | ✅ `orders.service.test.ts` |
| TC-070 | Quote for a store with no configured location | `409 RESTAURANT_LOCATION_REQUIRED` | I | ✅ `orders.service.test.ts` (TC-070) |
| TC-071 | Quote/order with an unavailable item | `409 ORDER_ITEM_UNAVAILABLE` | I | ✅ `orders.service.test.ts` |
| TC-072 | Quote/order exceeding tracked stock | `409 ORDER_ITEM_OUT_OF_STOCK` | I | ✅ `orders.service.test.ts` |
| TC-073 | Checkout "Place order" gated until a quote is calculated | Button no-op without quote (`quoteRequiredError`) | UI | ✅ `checkout.ui.test.tsx` |
| TC-074 | Address text edited after quote should invalidate the shown quote | Quote reset so a fresh one is required (QA L-3) | UI | ⬜ |
| TC-075 | Use-current-location path builds a quote | Coordinates from device → quote populated | UI | ⬜ |
| TC-076 | Server recomputes totals on order create (ignores client quote) | Charged total = server calculation | I | ✅ `orders.service.test.ts` |

## 10 — Order placement & idempotency

| ID | Scenario | Expected result | Type | Cov. |
|----|----------|-----------------|:--:|:--:|
| TC-077 | Place a valid supermarket order | Order PLACED; stock reserved; store notified; status history seeded | I | ✅ `orders.service.test.ts` |
| TC-078 | Customer ordering a `RESTAURANT`-type business while gate off | `409 RESTAURANT_ORDERING_DISABLED` | I | ✅ `coming-soon-restaurant-gap.test.ts` |
| TC-079 | Flipping `RESTAURANT_ORDERING_ENABLED=true` restores restaurant ordering | Order succeeds, no rebuild | I | ✅ `coming-soon-restaurant-gap.test.ts` |
| TC-080 | Rapid double-tap "Place order" (UI guard) | Exactly one submit fires (synchronous ref lock) | UI | ✅ `checkout.ui.test.tsx` |
| TC-081 | Two concurrent `POST /orders` (server idempotency, QA M-1 — fixed) | Same key → one order, stock reserved once (real DB unique index); different/no key → distinct orders | E + I | ✅ `order-idempotency.e2e.test.ts` + `orders.service.test.ts` (TC-081) |

## 11 — Order lifecycle & status transitions

| ID | Scenario | Expected result | Type | Cov. |
|----|----------|-----------------|:--:|:--:|
| TC-082 | PLACED → ACCEPTED by store | Status advances; customer notified; atomic CAS | I | ✅ `orders.service.test.ts` |
| TC-083 | ACCEPTED → PREPARING → READY_FOR_PICKUP | Each valid transition allowed; delivery created at READY | I | ✅ `orders.service.test.ts` |
| TC-084 | Illegal transition (e.g. PLACED → DELIVERED) | `409 ORDER_INVALID_TRANSITION` | I | ✅ `order.rules`/`orders.service.test.ts` |
| TC-085 | Accepting an order with a pending fulfillment review | `409 FULFILLMENT_REVIEW_PENDING` | I | ✅ `orders.service.test.ts` |
| TC-086 | Concurrent status updates (two staff) | Exactly one wins (compare-and-swap) | I | ✅ `orders.service.test.ts` |
| TC-087 | REJECTED restores reserved stock | Inventory movements reverse reservation | I | ✅ `orders.service.test.ts` |
| TC-088 | Status change emits realtime + notification | `order.status.changed` to order room + admins; customer notified | I | ✅ `orders.service.test.ts` (TC-088) |
| TC-089 | Customer sees live status via socket refetch | Detail screen re-fetches on event | U | 🟡 `socket.test.ts` |
| TC-090 | Full delivered lifecycle end-to-end (DB) | PLACED→…→DELIVERED with cash + inventory + accounting | E | ✅ `phase11.e2e.test.ts` |
| TC-091 | Status history ordering & actor attribution | Chronological; store/admin see who accepted, customer doesn't | I | ✅ `orders.service.test.ts` (TC-091 + "customer-facing…never expose") |

## 12 — Order cancellation

| ID | Scenario | Expected result | Type | Cov. |
|----|----------|-----------------|:--:|:--:|
| TC-092 | Customer cancels a PLACED order | CANCELLED; stock restored; store notified | I | ✅ `orders.service.test.ts` |
| TC-093 | Customer cancel after store already responded | `409 ORDER_NOT_CANCELLABLE` | I | ✅ `orders.service.test.ts` |
| TC-094 | Admin cancels with reason | CANCELLED; open delivery closed; audit logged; both parties notified | I | ✅ `orders.service.test.ts` |
| TC-095 | Admin cancel of a non-cancellable status | `409 ORDER_NOT_CANCELLABLE` | I | ✅ `orders.service.test.ts` (TC-095) |
| TC-096 | Cancelled order cannot be walked to DELIVERED by a driver | Delivery closed in same txn | I | ✅ `orders.service.test.ts` ("an admin cancellation closes the courier task…") |

## 13 — Supermarket fulfillment & substitution

| ID | Scenario | Expected result | Type | Cov. |
|----|----------|-----------------|:--:|:--:|
| TC-097 | Propose a replacement for a substitution-allowed item | Adjustment PENDING; customer notified; replacement stock reserved | I | ✅ `orders.service.test.ts` |
| TC-098 | Propose replacement when substitution not allowed | `409 SUBSTITUTION_NOT_ALLOWED` | I | ✅ `orders.service.test.ts` ("supermarket cannot substitute…declined") |
| TC-099 | Replacement with same product | `400 SUBSTITUTION_SAME_PRODUCT` | I | ✅ `orders.service.test.ts` (TC-099) |
| TC-100 | Replacement out of stock | `409 SUBSTITUTION_OUT_OF_STOCK` | I | ✅ `orders.service.test.ts` (TC-100) |
| TC-101 | Variable-weight packed-quantity within 50–150% | Accepted; line total recomputed | I | ✅ `orders.service.test.ts` |
| TC-102 | Packed quantity out of 50–150% range | `422 FULFILLMENT_QUANTITY_OUT_OF_RANGE` | I | ✅ `orders.service.test.ts` |
| TC-103 | Fulfillment adjustment on a non-supermarket order | `404 SUPERMARKET_NOT_FOUND` | I | ✅ `orders.service.test.ts` (TC-103) |
| TC-104 | Customer approves an adjustment | Order subtotal/total updated; original stock released | I | ✅ `orders.service.test.ts` |
| TC-105 | Customer rejects an adjustment | Reservation released; store notified | I | ✅ `orders.service.test.ts` |
| TC-106 | Discount recomputation after substitution (QA M-2 — fixed) | Percentage discount re-derived on the new subtotal via the same promotion engine; a capped/flat discount stays at its cap; no promo → no discount; total clamped ≥ 0 | I | ✅ `orders.service.test.ts` (TC-106 + flat/no-discount/shrink cases) |

## 14 — Driver operations

| ID | Scenario | Expected result | Type | Cov. |
|----|----------|-----------------|:--:|:--:|
| TC-107 | Driver registration creates DRIVER user + offline profile | Profile PENDING/offline; unique phone enforced | I | ✅ `drivers.service.test.ts` |
| TC-108 | Duplicate-phone driver registration | `409 PHONE_ALREADY_REGISTERED` | I | ✅ `drivers.service.test.ts` |
| TC-109 | Toggle online/offline | `isOnline` flips; available deliveries then visible | I | ✅ `drivers.service.test.ts` |
| TC-110 | List available deliveries (PENDING_ASSIGNMENT) | Only unassigned, ready deliveries | I | ✅ `drivers.service.test.ts` |
| TC-111 | Accept a delivery (happy path) | Delivery ASSIGNED to driver; removed from pool | I | ✅ `drivers.service.test.ts` |
| TC-112 | Two drivers accept the same delivery concurrently | Exactly one wins (`updateMany where driverId:null`) | I | ✅ `drivers.service.test.ts` |
| TC-113 | Accept while already holding an active delivery | Blocked (`409 DELIVERY_DRIVER_HAS_ACTIVE`) | I | ✅ `drivers.service.test.ts` ("a driver holding an active delivery cannot accept a second one") |
| TC-114 | Delivery status PICKED_UP → ON_THE_WAY → DELIVERED | Valid progression; timestamps set; order → DELIVERED | I | ✅ `drivers.service.test.ts` |
| TC-115 | Driver stats/earnings (70% delivery-fee share) | Completed count, active count, earnings from the ledger | I | ✅ `drivers.service.test.ts` ("driver stats count completed deliveries and pay 70%…") |
| TC-116 | Update driver location (one-shot) | `lastLatitude/Longitude` persisted | I | ✅ `drivers.service.test.ts` (TC-116) |
| TC-117 | Continuous/background driver location during active delivery (QA H-3) | Location updates live — **gap: one-shot only, `watchCurrentCoordinates` unused** | M | ⬜ |
| TC-118 | Driver home renders map + online toggle + lists | Renders without crash; empty states correct | UI | ⬜ |

## 15 — Restaurant admin: profile, hours & open status

| ID | Scenario | Expected result | Type | Cov. |
|----|----------|-----------------|:--:|:--:|
| TC-119 | Owner resolves own business via membership (not just ownerUserId) | Staff accounts also scoped correctly | I | 🟡 `restaurants.service.test.ts` |
| TC-120 | Update profile (name/desc/address/logo/coords) | Coords must be updated together else `400 RESTAURANT_COORDINATES_INCOMPLETE` | I | ✅ `restaurants.service.test.ts` |
| TC-121 | Working hours — normal daytime window openness | Opens inclusively, closes exclusively | U | ✅ `restaurant.rules.test.ts` |
| TC-122 | Working hours — overnight window (e.g. 18:00–02:00) | Correctly spans midnight | U | ✅ `restaurant.rules.test.ts` |
| TC-123 | Working hours — zero-length / equal open=close | Always closed / `RESTAURANT_HOURS_INVALID` | U | ✅ `restaurant.rules.test.ts` |
| TC-124 | Hours must be set/cleared as a pair | `400 RESTAURANT_HOURS_INCOMPLETE` | I | ✅ `restaurants.service.test.ts` |
| TC-125 | Open toggle requires APPROVED + location | `409 RESTAURANT_NOT_APPROVED` / `RESTAURANT_LOCATION_REQUIRED` | I | ✅ `restaurants.service.test.ts` (TC-125) |

## 16 — Restaurant admin: menu & inventory

| ID | Scenario | Expected result | Type | Cov. |
|----|----------|-----------------|:--:|:--:|
| TC-126 | Create menu category / item | Persisted, scoped to own business | I | ✅ `menu.service.test.ts` |
| TC-127 | Update item price/cost/availability | Fields updated; cost price never exposed to customers | I | ✅ `menu.service.test.ts` |
| TC-128 | Toggle item availability | Hidden from public catalog when unavailable | I | ✅ `menu.service.test.ts` (public menu hides the sold-out item) |
| TC-129 | Inventory list with low-stock summary | Totals: tracked / low / out-of-stock | I | ⬜ |
| TC-130 | Barcode lookup | Returns matching inventory item or 404 | I | ⬜ |
| TC-131 | Manual stock adjustment writes a movement | `MANUAL_ADJUSTMENT` movement + new stockAfter | I | 🟡 |
| TC-132 | Create supplier & draft purchase order | Draft PO with items + total cost | I | ✅ `phase11.e2e.test.ts` |
| TC-133 | Receive a purchase order restocks + `PURCHASE_RECEIPT` movement | Stock incremented; PO → RECEIVED | I | ✅ `phase11.e2e.test.ts` |
| TC-134 | Cancel a purchase order | PO → CANCELLED; no stock change | I | 🟡 |
| TC-135 | Restaurant owner cannot see/edit another business's menu/inventory | Scoped 404 (isolation) | S | 🟡 `authorization.service.test.ts` |

## 17 — Super admin console

| ID | Scenario | Expected result | Type | Cov. |
|----|----------|-----------------|:--:|:--:|
| TC-136 | Dashboard aggregates (orders today, revenue, active deliveries, pending approvals, online drivers, signups) | Correct counts + activity feed | I | ✅ `admin.service.test.ts` |
| TC-137 | List restaurants filtered by status/type/open | Correct filtered page | I | ✅ `restaurants.service.test.ts` (TC-137) |
| TC-138 | Approve a pending restaurant | Status APPROVED; owner notified; audit logged | I | ✅ `restaurants.service.test.ts` |
| TC-139 | Reject / approve only from PENDING | `409 RESTAURANT_NOT_PENDING` otherwise | I | ✅ `restaurants.service.test.ts` |
| TC-140 | Suspend restaurant (forces closed) + reactivate | Valid transitions only; audit + notification | I | ✅ `restaurants.service.test.ts` |
| TC-141 | Admin creates a business (owner + membership) | Delegates to register; optional immediate approval; audited | I | ✅ `restaurants.service.test.ts` (TC-141) |
| TC-142 | Approve / reject / suspend drivers | Status changes + notifications + audit | I | ✅ `drivers.service.test.ts` ("admin approves/rejects/suspends a … driver") |
| TC-143 | List/search users by role | Correct filtered results | I | ✅ `admin.service.test.ts` (TC-143) |
| TC-144 | Admin orders list + single order view | Filter by status/restaurant/customer/date | I | ✅ `orders.service.test.ts` ("adminListOrders filters by status and restaurant") |
| TC-145 | Audit log lists actions with actor + reason | Filterable, chronologically consistent | I | ✅ `admin.service.test.ts` (TC-145) |
| TC-146 | Create platform admin / assign platform role | Permission-gated; membership updated | I | ✅ `authorization.service.test.ts` |
| TC-147 | Admin web boot only clears session on 401 (not network) | Offline boot keeps admin logged in | U | 🟡 `auth-retry.test.ts` (admin) |
| TC-148 | Alert sound / live orders auto-refresh on the business console | Poll + realtime refresh of the order queue | M | ⬜ |

## 18 — Accounting layer

| ID | Scenario | Expected result | Type | Cov. |
|----|----------|-----------------|:--:|:--:|
| TC-149 | 100.00 restaurant order splits to the shekel | Commission/margin split exact | E | ✅ `accounting.e2e.test.ts` |
| TC-150 | 200.00 market order pays cost + 40/30/30 margin | Correct three-way split | E | ✅ `accounting.e2e.test.ts` |
| TC-151 | An order is valued exactly once (idempotent) | Repeated valuation is a no-op | E | ✅ `accounting.e2e.test.ts` |
| TC-152 | Cash custody recorded separately from driver pay | Two distinct events | E | ✅ `accounting.e2e.test.ts` |
| TC-153 | Partial cash handover settles only to the money's extent | Remaining balance tracked | E | ✅ `accounting.e2e.test.ts` |
| TC-154 | The same handover cannot be posted twice | Second attempt rejected | E | ✅ `accounting.e2e.test.ts` |
| TC-155 | Commission/rate snapshot frozen at order time | A later rate change never restates the order | E/U | ✅ `accounting.rules.test.ts` |
| TC-156 | Financial history is immutable (no edit/delete; correction = new entry) | Append-only ledger | E | ✅ `accounting.e2e.test.ts` |
| TC-157 | Monthly subscription bills each restaurant once, never a promotional partner | Correct billing set | E | ✅ `accounting.e2e.test.ts` |

## 19 — Offers & promotions

| ID | Scenario | Expected result | Type | Cov. |
|----|----------|-----------------|:--:|:--:|
| TC-158 | Product-percentage offer reduces effective price | `effectivePriceMinor` reflects discount + max cap | I | ✅ `offers.service.test.ts` |
| TC-159 | Order-percentage / free-delivery / delivery-percentage at checkout | Correct discount split (merch vs delivery) | I | ✅ `offers.service.test.ts` |
| TC-160 | Minimum-subtotal threshold gating an offer | Applied only above threshold | I | ✅ `offers.service.test.ts` |
| TC-161 | Offer time window (startsAt/endsAt) | Inactive outside window | I | ✅ `offers.service.test.ts` |
| TC-162 | Restaurant-scoped offers hidden while ordering gate off | Only market/platform offers shown to customer | I | ✅ `offers.service.test.ts` |
| TC-163 | Admin create/update offer validation | Bad type/percent rejected | I | ✅ `offers.service.test.ts` (TC-163) |

## 20 — Notifications & realtime

| ID | Scenario | Expected result | Type | Cov. |
|----|----------|-----------------|:--:|:--:|
| TC-164 | Order placed → business notification | `ORDER_PLACED` created + emitted | I | ✅ `notifications.service.test.ts` |
| TC-165 | List my notifications with unread count | Paginated + `unreadCount` | I | ✅ `notifications.service.test.ts` |
| TC-166 | Mark notification read | `isRead=true`; unread count decremented; cross-user 404 | I | ✅ `notifications.service.test.ts` |
| TC-167 | Socket room authorization (only your order's events) | Events for other orders ignored | U | ✅ `socket.test.ts` |
| TC-168 | Deferred emitter flushes only after txn commit | No emit on rollback | U | ✅ `deferred-emitter.test.ts` |
| TC-169 | Gateway auth handshake with token | Unauthorized socket rejected | I | 🟡 `realtime.gateway.test.ts` |
| TC-170 | Reconnect re-syncs missed events (QA M-5 — fixed) | One refetch on reconnect; skips first connect; debounced against flapping | U | ✅ `reconnect-resync.test.ts` / `socket.test.ts` |

## 21 — i18n & RTL

| ID | Scenario | Expected result | Type | Cov. |
|----|----------|-----------------|:--:|:--:|
| TC-171 | Language switcher renders both options (Arabic default / RTL) | العربية + English shown, no crash | UI | ✅ `LanguageSwitcher.ui.test.tsx` |
| TC-172 | Renders after switching to English (LTR) | No crash; both options present | UI | ✅ `LanguageSwitcher.ui.test.tsx` |
| TC-173 | Error codes map to localized messages, fallback to server message | `readError` resolves `errors:<code>` then falls back | U | ✅ `errors.ui.test.tsx` |
| TC-174 | RTL toggle reload path (QA M-4 — fixed) | Uses `Updates.reloadAsync()`; manual-restart fallback shown when unavailable | U/UI | ✅ `reload.test.ts` / `LanguageSwitcher.ui.test.tsx` |
| TC-175 | Arabic numerals/prices/dates render correctly | No `Intl.PluralRules` dependency on Hermes | M | ⬜ |
| TC-176 | Directional icons (chevrons/back) mirror in RTL | `backIconName`/`disclosureIconName` flip | U | ✅ `icon.ui.test.tsx` |
| TC-177 | No hardcoded English strings in customer flow | All user copy via i18n keys | M | ⬜ |

## 22 — Security & RBAC

| ID | Scenario | Expected result | Type | Cov. |
|----|----------|-----------------|:--:|:--:|
| TC-178 | `@RequirePermission` enforced server-side (UI hiding is not the guard) | Missing permission → `403 FORBIDDEN_PERMISSION` | S | ✅ `permissions.guard.test.ts` |
| TC-179 | Customer token cannot hit driver/admin/restaurant endpoints | 403/404 regardless of client state | S | ✅ `route-permissions.test.ts` |
| TC-180 | Business-scoped permission requires a business context | `403 BUSINESS_CONTEXT_REQUIRED` when absent | S | ✅ `permissions.guard.test.ts` |
| TC-181 | Super admin bypass holds every permission | Cross-business access allowed | S | ✅ `authorization.service.test.ts` |
| TC-182 | Restaurant admin scoped to only their business's orders/data | Others' resources → 404 | S | 🟡 `authorization.service.test.ts` |
| TC-183 | Tokens stored in SecureStore on native (not plain storage) | Access/refresh in Keychain/Keystore | S | 🟡 |
| TC-184 | 500 responses never leak stack traces | Generic message + requestId only | S | ✅ `all-exceptions` (behavior) |
| TC-185 | Production env rejects placeholder secrets / `*` CORS / non-HTTPS | Startup throws | U | ✅ `environment.test.ts` |
| TC-186 | Payment is CASH-only; no card data logged/stored/sent | No PCI surface | S | ✅ `payment-method.test.ts` |
| TC-187 | Admin access token in `localStorage` exposure (QA M-6) | Memory-only follow-up — **documented gap** | S | ⬜ |

## 23 — Performance & lists

| ID | Scenario | Expected result | Type | Cov. |
|----|----------|-----------------|:--:|:--:|
| TC-188 | Catalog uses virtualized FlatList (numColumns) | Smooth scroll for large catalogs | P | ⬜ |
| TC-189 | Driver available-deliveries list virtualization (QA L-5) | Avoid `.map` in ScrollView at scale | P | ⬜ |
| TC-190 | Admin revenue via SQL aggregate not JS reduce (QA M-8 — fixed) | `order.aggregate _sum`; filter semantics preserved; 0 (not error) on empty | I | ✅ `admin.service.test.ts` / `restaurants.service.test.ts` |
| TC-191 | Image loading for menu/product images | Lazy/optimized; no oversized bitmaps | P | ⬜ |

## 24 — Accessibility

| ID | Scenario | Expected result | Type | Cov. |
|----|----------|-----------------|:--:|:--:|
| TC-192 | Icon-only buttons have accessible labels | Cart controls (increase/decrease/remove) labelled | A | ✅ `cart-screen.ui.test.tsx` (TC-192) |
| TC-193 | Key CTA tap targets ≥ 44×44 (QA L-2) | Cart steppers/remove enlarged | A | ⬜ |
| TC-194 | Color contrast on primary CTAs | Meets WCAG AA against palette | A | ⬜ |
| TC-195 | Cart substitution toggle exposes checkbox role/state | `accessibilityRole=checkbox` + checked state | A | ✅ `cart-screen.ui.test.tsx` (TC-195) |

## 25 — Offline, resilience, config & secrets

| ID | Scenario | Expected result | Type | Cov. |
|----|----------|-----------------|:--:|:--:|
| TC-196 | Offline cold launch keeps the session (QA H-1) | Network error → tokens kept, boots offline w/ cached user | U | ✅ `session-restore.test.ts` |
| TC-197 | Genuine 401 at launch signs out | Tokens cleared, routed to login | U | ✅ `session-restore.test.ts` |
| TC-198 | Request layer timeout + bounded retry (QA M-2 — fixed) | AbortController → `TIMEOUT` ApiError; GET retried, mutation not; hard-capped | U | ✅ `http-retry.test.ts` |
| TC-199 | Build health: typecheck clean after `prisma:generate` (QA L-1) | 0 TS errors across workspaces once client generated | M | ✅ (verified) |
| TC-200 | No secrets/backend URLs hardcoded; `.env` gitignored; prod requires HTTPS `EXPO_PUBLIC_API_URL` | Startup throws on non-HTTPS in release | U | 🟡 `environment.test.ts` |

---

## How to run the automated portion
- API (unit/integration): `npm test -w @wasel/api` — in-memory `fake-prisma`, no DB.
- Mobile pure-logic: `npm run test:unit -w @wasel/mobile` · Mobile render: `npm run test:ui -w @wasel/mobile` (both via `npm test -w @wasel/mobile`).
- Admin: `npm test -w @wasel/admin`.
- DB-backed e2e (TC-090, TC-132/133, TC-149…157): start Postgres, `npm run prisma:deploy && npm run prisma:seed`, then `npm run test:e2e`.

## Recommended next automated tests (highest-value gaps, `⬜`)
1. **TC-081** server-side order idempotency (needs the idempotency-key fix, QA M-1).
2. **TC-198** request timeout/AbortController (QA M-2).
3. **TC-017 / TC-021 / TC-025–026** JWT `tokenVersion` invalidation, logout revocation, password-reset session kill.
4. **TC-049** pagination boundary suite (empty / single / exact page / beyond-last).
5. **TC-129–134** inventory (low-stock summary, barcode, adjustments, PO cancel).
6. **TC-143 / TC-145** admin user search & audit-log listing.
7. **TC-106** discount recomputation after substitution (QA M-2 correctness).
8. **TC-170 / TC-174** realtime reconnect re-sync & production RTL reload (both known QA gaps).

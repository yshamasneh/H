# JOVO — Full Project Audit

**Date:** 2026-08-27
**Branch audited:** `agent/phase-15-and-jovo-brand` @ `eb9b1a7`
**Scope:** whole monorepo — `apps/api` (NestJS/Prisma), `apps/admin` (React/Vite), `apps/mobile` (Expo), migrations, deploy config, live dev database.
**Method:** read the code; ran the test suite and typecheck; queried the running PostgreSQL container directly; ran the database-backed e2e suite against a fresh throwaway database. Documentation claims were checked against code, not taken at face value.

Throughout, findings are tagged:

- **[VERIFIED]** — I ran it, queried it, or read the exact code path end to end.
- **[LIKELY]** — strongly indicated by the code but not executed against a live failure.

---

## 0. Executive summary

This is a genuinely well-built codebase. That is not flattery and it matters for how you should read the rest of this document. The authorization model is enforced server-side on every route, the state machines use compare-and-swap writes rather than read-then-write, the accounting layer pushes its guarantees down into database CHECK constraints and append-only triggers instead of trusting the service layer, and the money arithmetic is written as pure functions with worked-example tests. Typecheck is clean across all three apps and 408 tests pass. I found no SQL injection, no missing auth guard, no cross-tenant leak.

The problems are not in the craft. They are in three places:

1. **One live money bug that is silently mis-splitting revenue right now**, caused by data rather than code — and the system's own self-check cannot detect it by design.
2. **A set of things that exist as documentation, schema, or endpoints but have no runtime** — no SMS provider, no push delivery, no scheduled jobs, no hosting.
3. **A handful of local-only assumptions** that will change behaviour the moment this runs on a real server.

The single most urgent item is §4.1. Read that first.

### The five things that would actually hurt you

| # | Finding | Impact |
|---|---------|--------|
| 1 | Every JOVO MARKET product has no cost price → the supermarket is paid ~40% of retail instead of ~88% on every order, and the ledger still reconciles so nothing flags it | §4.1 |
| 2 | No SMS/OTP provider exists — production config *requires* one and no customer can sign up without it | §2.1 |
| 3 | Push notifications are stored but never sent — the store and drivers get no alert unless the app is open and connected | §2.2 |
| 4 | Store opening hours are evaluated in server-local time with no timezone set → 2–3 hour skew on a UTC server | §2.3 |
| 5 | The database you are about to enter real product data into is the dev database, complete with a seeded admin whose password is in the repository | §2.4 |

---

## 1. Verified build and test results

I ran these myself. These are real numbers, not claims from a document.

### Typecheck — **PASS** [VERIFIED]

`npm run typecheck` (all three workspaces, `tsc --noEmit`) exits 0. No errors, no warnings, no `@ts-ignore` suppressions hiding failures.

### Unit / integration tests — **408 pass, 0 fail** [VERIFIED]

`npm test` exits 0.

| Workspace | Tests | Pass | Fail | Skipped |
|-----------|------:|-----:|-----:|--------:|
| `@wasel/api` | 322 | 319 | 0 | 3 |
| `@wasel/mobile` (unit) | 70 | 70 | 0 | 0 |
| `@wasel/mobile` (jest UI) | 16 | 16 | 0 | 0 |
| `@wasel/admin` | 3 | 3 | 0 | 0 |
| **Total** | **411** | **408** | **0** | **3** |

API suite runtime: 108.8 s.

The 3 skipped API tests are the database-backed e2e suites, gated behind `RUN_DATABASE_E2E=true`. They are not broken — they are opt-in, and I ran them separately (below).

### Database-backed e2e — **22 pass, 0 fail** [VERIFIED]

I provisioned a fresh throwaway database (`jovo_audit_test`), applied all 23 migrations with `prisma migrate deploy`, and ran `npm run test:e2e`. Exit 0, 285 s, 22 assertions across 3 suites, against real PostgreSQL rather than test doubles:

- the accounting layer values both verticals, tracks cash custody, and refuses to be rewritten
- financial history refuses to be edited or deleted
- a correction is a new, attributed entry rather than an edit
- subscriptions bill each restaurant once a month, and never a promotional partner
- the balances view answers who is owed what, and traces it to its parts
- reading the books and moving money are different authorities
- concurrent order creation with the same idempotency key produces one order and reserves stock once
- Phase 13 connects delivery, grocery fulfillment, cash totals, and inventory procurement in one lifecycle

This matters: the database-level guarantees described in §4.0 (unique indexes, CHECK constraints, immutability triggers) are demonstrated against a real engine, not asserted against a mock. The migrations also apply cleanly from scratch, which means a fresh production deploy will come up correctly.

`@wasel/admin` has exactly one test file (`auth-retry.test.ts`, 3 tests), covering the token-refresh coordinator. Those tests do run. Everything else in the app — including the accounting screens that record cash handovers and partner payouts — has no tests at all. [VERIFIED]

> **Correction (2026-08-27):** an earlier revision of this report stated that the admin glob matched nothing and the app ran zero tests. That was wrong — the 3 tests run. The substantive gap, that the money-handling screens are untested, is unchanged.

### CI configuration — strong, but not covering this branch [VERIFIED]

`.github/workflows/ci.yml` runs lint, typecheck, tests, build, Prisma validate + migration replay, the full e2e suite against a real PostgreSQL service container, `npm audit --audit-level=high`, and both container builds. CodeQL runs weekly. This is a better gate than most projects this size have.

However: `on.push.branches` is `[main, agent/customer-phone-auth]`. The branch you are working on, `agent/phase-15-and-jovo-brand`, only gets CI via a pull request. Direct pushes to it are unverified.

---

## 2. What works locally and will break in production

This is the section you asked to be most valuable, so it comes before the feature inventory.

### 2.1 There is no SMS provider. Customers cannot sign up. — BLOCKER [VERIFIED]

`apps/api/src/auth/otp.provider.ts` has exactly two implementations:

- `DevelopmentOtpProvider` — writes the OTP code to the server log. This is what you are using now.
- `WebhookOtpProvider` — POSTs `{ phone, purpose, code }` to an HTTPS endpoint you must supply.

`apps/api/src/config/environment.ts:41` refuses to boot in production unless `OTP_PROVIDER=webhook`, and then requires `OTP_WEBHOOK_URL` and `OTP_WEBHOOK_TOKEN`. **That webhook does not exist anywhere in this repository.** It is a service you have to build or buy (Twilio, Vonage, a local Palestinian SMS gateway, or a WhatsApp Business bridge) and then host.

Consequences the moment you go to production:

- Customer signup (`POST /auth/customer/signup/request-code`) is the **only** way to create a customer account. No OTP delivery means no customers.
- Password reset is equally dead.
- The API will not even start without the three webhook variables set.

This is not a small integration. It needs a vendor account, sender-ID registration (which in Palestine can take days to weeks), a deployed bridge service, and a token. **Treat this as the longest-lead-time item in the whole project.**

Secondary issue in the same path: `issueOtp` (`auth.service.ts:339-405`) creates the challenge row inside a serializable transaction and *then* calls `otpProvider.send()` outside it. If the SMS bridge is down or times out, the challenge is committed, the 60-second resend cooldown starts, the user gets a 500, and no code was ever sent. They must wait out a cooldown for a code that does not exist. There is no retry and no compensating delete. [VERIFIED — read the code path]

### 2.2 Push notifications are stored but never sent — BLOCKER for operations [VERIFIED]

The `PushToken` table exists. `POST /users/me/push-tokens` stores Expo push tokens. The mobile app (`apps/mobile/src/core/push-notifications.ts`) correctly requests permission, creates an Android `orders` channel at HIGH importance, and registers the token.

I grepped the entire API for any call to Expo's push service (`exp.host`, `expo.dev/--/api`, `ExpoPush`, `push/send`). **There are zero matches.** `apps/api/src/notifications/notification.util.ts` is the only notification writer, and it does exactly two things: inserts a `Notification` row, and emits a Socket.IO event to room `user:<id>`.

What this means in the store, on day one:

- A customer places an order at 14:30. The supermarket's tablet has the app backgrounded or the screen off. **Nobody is told.** The order sits in `PLACED` until a human happens to open the app.
- A delivery enters `PENDING_ASSIGNMENT`. Drivers with the app backgrounded get **no alert**. The order sits in `READY_FOR_PICKUP`.
- The customer's "your driver is on the way" notification only arrives if their app is foregrounded with a live socket.

For a cash-on-delivery marketplace whose entire product is timely handoffs, this is a functional gap, not a polish item. The admin web app ships an `alert-sound.ts`, which suggests the current workaround is "keep the admin dashboard open on a screen with the volume up." That works for a pilot. It does not work for a business.

### 2.3 Opening hours use server-local time with no timezone configured [VERIFIED]

`apps/api/src/restaurants/restaurant.rules.ts:29`:

```ts
const current = now.getHours() * 60 + now.getMinutes();
```

`now.getHours()` returns **the server process's local hour**. I grepped `Dockerfile`, `docker-compose.production.yml`, `.env.example`, `.env.production.example`, and all of `apps/api` for `TZ` or any `Asia/*` zone. **No timezone is set anywhere.** A `node:22-bookworm-slim` container runs in **UTC**.

Palestine is UTC+3 in summer (IDT), UTC+2 in winter.

So a store configured to open 07:00 and close 23:00 would, on a UTC production server, actually accept orders from **10:00 to 02:00** local time. Customers locked out for the first three hours of the trading day; orders still accepted for three hours after closing.

This works perfectly on your machine because your machine runs in Palestinian local time. It breaks the day you deploy.

**It is not biting you yet** — I checked the database, and JOVO MARKET currently has `opensAt` and `closesAt` both `NULL`, which the function treats as "no schedule, follow the manual `isOpen` switch." [VERIFIED via database query] The bug arms itself the moment you set opening hours, which you will want to do before launch.

Fix: `ENV TZ=Asia/Hebron` in the Dockerfile and the compose file, or convert `isWithinWeeklyHours` to take an explicit IANA zone. The latter is more correct; the former is sufficient for a single-city launch.

### 2.4 You are about to put real product data into the dev database [VERIFIED]

I queried the running `tasawaq-postgres` container. It currently contains:

```
+970590000000  test                    CUSTOMER
+970590000001  admin                   ADMIN         <-- password: Test@12345
+970590000002  Demo Restaurant Owner   RESTAURANT
+970590000003  Demo Driver             DRIVER
+970590000004  Demo Supermarket Owner  RESTAURANT
+970599112233  Test Owner              RESTAURANT
+970590000008  علي محمد                 RESTAURANT
+970583660012  Smoke Test Driver       DRIVER
+970582969995  Smoke Test Driver       DRIVER
+970587789448  Smoke Test Driver       DRIVER
+970587539429  Smoke Test Driver       DRIVER
```

The password `Test@12345` is hardcoded at `apps/api/prisma/seed.ts:24` and committed to the repository. It is the password for **the ADMIN account** and every other seeded account.

Also present: 20 test orders, 4 businesses (two of them junk — `Pending Test Diner` SUSPENDED, `جويي` REJECTED), 10 deliveries, and four accumulated "Smoke Test Driver" accounts from repeated manual test runs.

`seed.ts:10` does refuse to run when `NODE_ENV=production`, which is a good guard. But it does not protect against the scenario that actually matters: **carrying this database forward into production.** If you enter real JOVO MARKET products here and later point production at this database, you ship a live admin account whose password is on GitHub.

**Start production from an empty database.** Run `prisma migrate deploy` against a fresh one, never `prisma db seed`, and create the first admin by hand.

### 2.5 The API base URL is compiled into the mobile app at build time [VERIFIED]

`apps/mobile/src/core/api.ts:352`:

```ts
const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "");
```

`EXPO_PUBLIC_*` variables are **inlined by Babel at bundle time**. There is a comment in that same file explaining a past bug where `process.env?.X` silently failed to inline — the team has already been bitten by this once.

The practical consequence with your ngrok setup: **every time the tunnel URL changes, every installed APK is dead** until you rebuild and redistribute. There is no runtime configuration, no remote config, no fallback host.

There is a good guard at line 360 — a production build throws at startup unless the URL is HTTPS — so you cannot accidentally ship a cleartext build. That same guard means you cannot ship an APK pointing at a plain-HTTP host either.

**A stable HTTPS hostname must exist before you build the APK you hand to real customers.** Not after.

### 2.6 The rate limiter is in-process memory [VERIFIED]

`app.module.ts` registers `ThrottlerModule` with no storage adapter, so it uses the default in-memory store.

- Every API restart resets all rate-limit counters. A crash-loop is also a rate-limit bypass.
- It is correct for exactly one API replica. `docker-compose.production.yml` runs one, so this is fine *today*. Add a second replica for availability and each enforces limits independently, doubling your effective limits.

`docs/security-review.md` already discloses this honestly. Noted so it is not forgotten when you scale.

### 2.7 Trusted-proxy hop count is a guess [LIKELY]

`environment.ts` defaults `TRUST_PROXY` to `1` in production. Correct for the supplied topology (nginx to api, one hop). Put Cloudflare or any other CDN in front and there are two hops: Express reads the wrong entry from `X-Forwarded-For` and **every request appears to come from the same IP**, collapsing all per-IP rate limiting into one shared bucket. Worth remembering when hosting is chosen.

### 2.8 PartnerAccountsService failure is swallowed at boot [VERIFIED]

`apps/api/src/accounting/partner-accounts.service.ts:22-28` upserts the three partner accounts (`OWNER_A`, `OWNER_B`, `DELIVERY_OPS`) on module init, wrapped in a `try/catch` that logs a warning and continues:

```ts
} catch (error) {
  // Reference data upkeep must never stop the API from starting.
  this.logger.warn(`Could not reconcile partner accounts: ...`);
}
```

If that upsert fails — most plausibly because the database is not accepting connections yet during a cold start — the API comes up healthy with **no partner accounts**. Then `writeEarnings` throws `Partner account "OWNER_A" does not exist` on the first delivery, which rolls back the whole transaction, and **the driver cannot mark anything delivered**. The API looks healthy; deliveries just fail with 500s.

It self-heals on the next restart (the upsert is idempotent), but "restart the API" is not an obvious diagnosis from that symptom. Consider failing the readiness probe rather than only warning.

### 2.9 Legacy service fee would block a delivery [VERIFIED — latent, not live]

`accounting.rules.ts` / `assertReconciles` requires that the sum of all distributed entitlements exactly equals `order.totalMinor`. The distribution is `subtotal + deliveryFee − merchandiseDiscount − deliveryDiscount`. But `Order.totalMinor` on legacy rows is `subtotal + deliveryFee + serviceFee − discount`.

Any order carrying a non-zero `serviceFeeMinor` therefore fails the assertion by exactly the service fee. That throws inside the driver's delivery transaction and **makes it impossible to mark that order delivered.**

I queried the database: **6 orders have `serviceFeeMinor <> 0`.** All six are already terminal (4 DELIVERED, 2 CANCELLED), so there is no live instance. New orders always write `serviceFeeMinor = 0`, so it cannot recur.

Reporting it because it is the clearest illustration of the failure mode: a reconciliation mismatch does not produce a warning, it produces a driver who physically cannot close a job. Note also that `docs/progress.md` states two pre-existing orders would be refused by the reconciliation check; the actual count is **four** (see §7.2).
---

## 3. Completeness audit, by role

A useful framing first: **I found essentially no stubs.** I grepped the whole codebase for `TODO`, `FIXME`, `not implemented`, and `stub`, and the only hits were in comments explaining design decisions and in React `placeholder=` props. The code that exists is finished code. The gaps in this project are *absent features* and *absent runtime*, not half-written ones. That is a much better position to be in.

### 3.1 Customer — largely complete

**Working end to end** [VERIFIED by reading the full path]:

- Phone signup with OTP, login, refresh-token rotation, logout, password reset. Pending registrations are held in `PendingCustomerRegistration` and only promoted to a `User` after the code is verified — so an abandoned signup leaves no account.
- Browse JOVO MARKET: `GET /supermarkets`, `/supermarkets/:id/catalog` (departments, search, pagination), `/supermarkets/:id/products/:id`.
- Cart with persistent storage across app restarts (`cart-storage.ts`, backed by SecureStore/AsyncStorage), cleared on logout.
- Quote (`POST /orders/quote`) and checkout (`POST /orders`) with client-supplied idempotency key — a retried checkout returns the original order rather than double-ordering. This is enforced by a `(customerId, idempotencyKey)` unique index, not just by the fast-path lookup.
- Saved addresses with default-address promotion logic, correctly scoped to the owner.
- Order history, order detail, live status via Socket.IO with a documented reconnect-resync path (`reconnect-resync.ts`).
- Cancel own order (only while `PLACED`) with stock restoration.
- Approve/reject a fulfillment adjustment (substitution or packed-weight change) — the customer must consent before totals change.
- Notification inbox, settings, Arabic/English with RTL, skeleton loaders, error boundary.

**Absent or partial:**

- **No push notifications** (§2.2). This is the big one for the customer too — order-ready and driver-assigned events are invisible unless the app is open.
- **No order rating or feedback.** Nothing in schema or code.
- **No reorder / "buy again"** from history.
- **No minimum order value.** `calculateOrderQuote` has no floor. A customer can order one 3 ILS item and trigger a 10 ILS delivery that costs you a driver's 7 ILS share. That is a deliberate-decision question, not a bug, but it is unguarded.
- **No delivery time estimate or slot selection.** Customers see status, not ETA.
- **Restaurants are gated off** as intended — `RESTAURANT_ORDERING_ENABLED` defaults to `false` in `environment.ts:96` and gates both public browsing (`restaurants.service.ts:36`) and order creation (`orders.service.ts:811`). The mobile home screen shows a "coming soon" card. [VERIFIED — gate is server-side, not just UI]

### 3.2 Driver — functional, thin

**Working:**

- Self-registration (`POST /drivers/register`), then admin approval before they can go online.
- Online/offline toggle, location update (foreground only, on demand).
- Open delivery pool (`GET /driver/me/deliveries/available`), atomic claim via `updateMany` CAS on `status: PENDING_ASSIGNMENT, driverId: null` — two drivers racing cannot both win. [VERIFIED]
- One active delivery at a time, enforced by a count check inside the transaction.
- Status progression PICKED_UP → ON_THE_WAY → DELIVERED, and a FAILED path that requires a reason code and derives a fault party.
- Earnings screen reading from the ledger (`getOwnStats`), correctly reporting **earnings** and **cash held** as two separate numbers rather than one combined balance.

**Absent:**

- **No dispatch.** Deliveries sit in an open pool. There is no assignment algorithm, no proximity matching, no offer/timeout/reassign cycle, and no escalation if nobody claims a job. An order can sit in `READY_FOR_PICKUP` indefinitely with nothing alerting anyone. For one supermarket and a handful of drivers this is survivable, but it is manual dispatch by WhatsApp in practice.
- **No driver cancel/handback.** Once claimed, a driver's only exits are DELIVERED or FAILED. If a driver's bike breaks, an admin has no clean path to reassign — I found no admin reassignment endpoint.
- **No navigation integration.** The driver sees an address and coordinates, not a route.
- **No shift or availability model.**
- **Drivers self-attest their phone number** — `drivers.service.ts:78` sets `phoneVerifiedAt: new Date()` with no OTP. See §6.4.

### 3.3 Business owner / staff — the most complete role

**Working:**

- Multi-user businesses via `BusinessMember` + business-scoped `Role` rows. `Restaurant.ownerUserId` remains the single legal owner; access is granted through membership. Staff management (`business-staff.service.ts`) is well guarded: no self-modification, no owner modification, and only `BUSINESS`-scoped roles are assignable, so a business admin cannot escalate anyone to `SUPER_ADMIN`. [VERIFIED]
- Live order queue, order detail, accept/prepare/ready/reject with an explicit transition allowlist.
- Catalogue: categories and items, price, cost price, SKU, barcode, brand, unit label, variable-weight flag, featured flag, availability toggle, reorder level.
- Inventory: stock adjustments with mandatory reason and CAS writes, movement history, barcode lookup, suppliers, purchase orders with receiving that increments stock transactionally.
- Fulfillment adjustments: propose a substitution or an actual packed weight; the customer must approve; on approval the order's subtotal, discount split and total are recomputed by re-running the same promotion engine used at checkout.
- Operating cost proposals (supermarket only) — propose, and the platform approves.
- Analytics screen and business-scoped notifications delivered to every active member.

**Absent or thin:**

- **No bulk product import.** You are about to enter a supermarket catalogue by hand, one product at a time, through a form. For a real supermarket (hundreds to thousands of SKUs) this is the practical bottleneck between now and launch, and nothing in the codebase addresses it. There is no CSV import, no bulk price update, no image upload pipeline.
- **No image hosting.** `imageUrl` is a plain string column. There is no upload endpoint, no storage bucket, no CDN. Every product image must already be hosted somewhere public and pasted in as a URL.
- **Cost price is optional** everywhere — the DTO, the service, and both UIs treat it as optional. See §4.1, because this is where it turns into a money bug.
- **No business-facing financial statement.** The business can propose operating costs but has no screen showing what it is owed. `business-accounting.controller.ts` exposes only operating costs. Balances live entirely in the platform admin's view.

### 3.4 Super admin — complete for platform ops, gapped for finance

**Working (web admin at `apps/admin`):** dashboard, restaurants list/detail with approve/reject/suspend/reactivate, business creation, orders list/detail with reasoned cancellation, drivers approve/reject/suspend/reactivate, users list with activate/deactivate and platform-role assignment, audit log, and an accounting section with four tabs (balances, driver cash, operating costs, rate sets).

**Permission model:** `PermissionsGuard` enforces `@RequirePermission` on the server, and `route-permissions.test.ts` locks the decorator-to-route wiring so a missing decorator fails a test rather than silently opening a route. `SUPER_ADMIN` holds every permission implicitly. I checked every `@Controller` in the API and **every non-public one applies `JwtAuthGuard` plus `RolesGuard`, and every administrative one also applies `PermissionsGuard`.** [VERIFIED — enumerated all 22 controllers]

**Absent from the admin web UI, though the API exists:**

| Capability | API endpoint | Web UI |
|---|---|---|
| Create a new rate set (change commission, splits, subscription) | `POST /admin/accounting/rates` | **none** |
| Generate monthly subscription charges | `POST /admin/accounting/subscriptions/generate` | **none** |
| Record a financial adjustment (the *only* way to correct a ledger error) | `POST /admin/accounting/adjustments` | **none** |
| Manage offers/promotions | `GET/POST/PATCH /admin/offers` | **none** (mobile admin app only) |

The adjustment gap matters most. Financial history is immutable by database trigger — correcting any mistake *requires* an adjustment, and today that means hand-crafting a `curl` with a bearer token. The first time a number is wrong in production, that is what you will be doing under time pressure. [VERIFIED — `api.accounting.ts` exposes no adjustment call]

**Also absent:** no data export (CSV/Excel) anywhere, for orders, ledger, or catalogue. Accountants will ask for this immediately.
---

## 4. Data integrity and money correctness

### 4.0 What the accounting layer gets right

I want to state this clearly before the problems, because it changes how you should weigh them.

The accounting layer is the strongest part of this codebase, and it is stronger than most production financial code I have read. Specifically [all VERIFIED by reading migration `20260818150121_phase15_6_accounting_layer/migration.sql` and the schema]:

- **Guarantees live in the database, not the service.** `OrderFinancialRecord.orderId` is `UNIQUE`, so double-computation is impossible even from a hand-run script. `PartnerEarning` has a `UNIQUE (sourceType, sourceId, payeeKey, component)` — one source can credit one payee one component exactly once. `CashSettlement.reference` and `PartnerSettlement.reference` are unique, so a retried handover or payout cannot post twice. `PartnerSettlementAllocation.earningId` is unique, so one entitlement can be cleared by exactly one payout.
- **Append-only enforced by trigger.** Nine `BEFORE UPDATE OR DELETE` triggers on `PartnerEarning`, `OrderFinancialRecord`, `CashSettlement`, `CashSettlementAllocation`, `PartnerSettlement`, `PartnerSettlementAllocation`, `FinancialAdjustment`, and `FinancialRateSet` raise `restrict_violation`. A service bug or a manual `UPDATE` cannot rewrite financial history.
- **`DriverCashCustody` is the one mutable financial table, and its mutability is fenced.** A dedicated trigger permits only `settledAmountMinor` and `status` to change, refuses any decrease, and refuses deletes. A `CHECK` enforces `settledAmountMinor <= collectedAmountMinor` — double-settlement is prevented by the database, not by a comparison a few lines earlier in a service.
- **CHECK constraints encode business rules**: discount funding splits must sum back to the discount they came from; a restaurant record must carry a commission rate and a supermarket record must not; a failed delivery must have collected zero and must name an absorber; `payeeKey` must agree with the foreign key it denormalises; components that only ever cost money can never appear as credits; a driver's delivery share can only be paid to a driver.
- **Money splits use largest-remainder allocation** (`allocateByWeights`), so three shares of 10.01 come to 3.34/3.34/3.33 and never to 3.34 x 3. Ties break toward the earlier weight, making it deterministic and testable.
- **Rates are versioned and immutable.** An order is stamped with `financialRateSetId` and `commissionBpSnapshot` at placement, so a rate changed next month cannot restate an order taken today.
- **Entitlement, payment, and cash custody are three separate facts**, never conflated. "The driver is owed 7.00" and "the driver is holding 87.50 of customers' money" are different rows in different tables. This is the thing cash-on-delivery businesses most often get wrong, and it is right here.
- **The delivery transition and the financial record are one transaction.** `drivers.service.ts:341` calls `recordOrderFinancials(tx, ...)` inside the same `$transaction` that moves the delivery and the order. An order cannot reach a terminal state without its money being recorded.

With that established, here is what is actually wrong.

### 4.1 CRITICAL — every JOVO MARKET order is currently mis-splitting revenue [VERIFIED]

**The data.** I queried the live database:

```
        name        | items | with_cost | tracked_stock
--------------------+-------+-----------+---------------
 JOVO MARKET        |     6 |         0 |             5
 Wasel Demo Kitchen |     5 |         0 |             0
```

**Zero of the six JOVO MARKET products have `costPriceMinor` set.** Cost price is optional in the DTO (`restaurants.dto.ts:193`), optional in the service (`menu.service.ts:81` — `input.costPriceMinor ?? null`), and optional in both the admin web form and the mobile form. Nothing requires it and nothing warns about it.

**The code path.** Trace it end to end:

1. `orders.service.ts:875` snapshots `costPriceMinorSnapshot: menuItem.costPriceMinor` onto each order line → `null` for every line.
2. `order-financials.util.ts:summariseGoodsCost` sees `null`, sets `complete = false`, and **skips the line entirely** — so `goodsCostMinor` totals **0**.
3. `accounting.rules.ts:computeOrderFinancials`, SUPERMARKET branch: `marginMinor = itemSubtotalMinor - goodsCostMinor` → the **entire retail value becomes "margin"**.
4. That margin is split 40/30/30 between the supermarket partner and the two platform owners.

**The arithmetic.** Take a realistic basket: 100.00 ILS of groceries costing you 80.00, plus the 10.00 minimum delivery fee. Customer pays 110.00.

| Party | What they *should* get | What they *actually* get | Difference |
|---|---:|---:|---:|
| JOVO MARKET (supermarket partner) | 80.00 cost + 8.00 margin share = **88.00** | 0 cost + 40.00 margin share = **40.00** | **−48.00** |
| Owner A | 6.00 + 1.00 delivery = 7.00 | 30.00 + 1.00 = 31.00 | +24.00 |
| Owner B | 6.00 + 1.00 delivery = 7.00 | 30.00 + 1.00 = 31.00 | +24.00 |
| Delivery ops | 1.00 | 1.00 | — |
| Driver | 7.00 | 7.00 | — |
| **Total** | **110.00** | **110.00** | — |

**The supermarket receives 45% of what it is owed. The two platform owners are overpaid by 24.00 each on a single 100 ILS basket.**

**Why nothing catches it.** This is the part that matters most. `assertReconciles` — the guard the design leans on, which throws loudly if a computation drifts — **passes**. Both columns total 110.00. The invariant it checks is "everything distributed equals cash collected," and that invariant *is* satisfied; the money is all distributed, just to the wrong parties. The `ledgerImbalanceMinor` figure on the admin overview will also read zero.

The only signal is `OrderFinancialRecord.costDataComplete = false`. Nothing alerts on it, nothing blocks the order, no screen highlights it, and the ledger rows are immutable — so correcting even one order requires a hand-crafted `FinancialAdjustment`, for which there is no UI (§3.4).

**To be fair to the design:** `docs/progress.md` does disclose this behaviour, describing it as "a cost with an unknown price is flagged, not guessed" and noting that it "overstates the margin." That is an honest description of a deliberate choice. What the document does not say — and what makes it urgent rather than theoretical — is that **the launch store's entire catalogue is currently in exactly that state**, so the footnote is the live behaviour, not the edge case.

**Fix, in order of preference:**

1. Enter cost prices for all six products before any real order is placed. This alone resolves it today.
2. Make `costPriceMinor` required for `businessType: SUPERMARKET` products at the DTO/service layer, so a new product cannot be created without one.
3. Add a guard in `calculateOrderQuote` that refuses to sell a supermarket item with no cost price, or at minimum a loud warning on the admin overview counting `costDataComplete = false` records.

Item 1 is a ten-minute data-entry task and closes the live exposure. Items 2 and 3 stop it recurring on product number 200.

### 4.2 HIGH — fulfillment adjustments update the price but not the cost [VERIFIED]

`orders.service.ts:recomputeOrderPricingAfterAdjustment` (lines 531-568) runs when a customer approves a substitution or an actual packed weight. It correctly recomputes and writes:

- `subtotalMinor` (from the new effective line totals)
- `merchandiseDiscountMinor`, `deliveryDiscountMinor`, `discountMinor`
- `promotionSnapshot`
- `totalMinor`

It does **not** touch `OrderItem.costPriceMinorSnapshot`, and it does not record the cost of a *replacement* product at all.

Meanwhile `summariseGoodsCost` reads plain `order.items` — `orderForFinancialsInclude` is `{ items: true, ... }` with no adjustment join — so it computes goods cost from the **original** product's cost snapshot at the **original** quantity.

So after any approved adjustment on a supermarket order, `subtotalMinor` reflects the new reality and `goodsCostMinor` reflects the old one. The margin is wrong by the difference, and it is split three ways.

This matters specifically because **variable-weight items are the normal case at a supermarket** — meat, produce, cheese. Every one of those orders will have an adjustment. Once §4.1 is fixed by entering cost prices, this becomes the next-largest source of silent drift, and it is a code fix rather than a data fix.

Concretely: a customer orders 1 kg of tomatoes at 12.00; the packer weighs 1.3 kg and proposes 15.60. The customer approves. Subtotal becomes 15.60. Goods cost stays at the 1 kg cost. Margin is overstated by 30% of the cost of tomatoes, and the supermarket is short-changed on every such line.

Also worth noting: `recomputeOrderPricingAfterAdjustment` writes `totalMinor: Math.max(0, subtotal + fee - discount)`. If a discount ever exceeded the new lower subtotal plus fee, that clamp would make `totalMinor` disagree with the distribution, `assertReconciles` would throw, and **the driver could not mark the order delivered** (the §2.9 failure mode). Offer percentages are capped at 100 (`offers.dto.ts:57`), so I could not construct a case that reaches it — recording it as [LIKELY unreachable] rather than a live bug.

### 4.3 MEDIUM — nine terminal orders have no financial record, and nothing detects that [VERIFIED]

```sql
SELECT count(*) FROM "Order" o LEFT JOIN "OrderFinancialRecord" r ON r."orderId" = o.id
WHERE o.status IN ('DELIVERED','DELIVERY_FAILED') AND r.id IS NULL;
-- 9
```

Eight `DELIVERED` and one `DELIVERY_FAILED`, dated 2026-08-06 to 2026-08-14 — all before the accounting migration (2026-08-18). There is no backfill migration and no backfill script.

Going forward this cannot recur: I traced every path to a terminal order status. `allowedOrderTransitions` (`order.rules.ts`) permits `DELIVERED` and `DELIVERY_FAILED` **only** from `READY_FOR_PICKUP`, and the only code that performs that transition is `drivers.service.ts:updateDeliveryStatus`, which writes the financial record in the same transaction. Admin cancel is restricted to non-terminal statuses. So the invariant "terminal order implies financial record" holds for all new orders. [VERIFIED]

The real finding is the absence of a **detector**. There is no query, job, or dashboard tile that would tell you if this invariant ever broke again — through a future code path, a manual database fix, or a partially-applied migration. A single scheduled query counting terminal orders without records would close this, and it is cheap.

Note that `docs/progress.md` says "six pre-existing orders." The actual number is nine. (See §7.2.)

### 4.4 MEDIUM — partner payout balance check has a race [VERIFIED by reading, not exploited]

`accounting.service.ts:recordPartnerSettlement` (lines 806-820):

```ts
const [earned, paid] = await Promise.all([
  tx.partnerEarning.aggregate({ where: { payeeKey }, _sum: { amountMinor: true } }),
  tx.partnerSettlement.aggregate({ where: { payeeKey }, _sum: { amountMinor: true } })
]);
const outstanding = (earned._sum.amountMinor ?? 0) - (paid._sum.amountMinor ?? 0);
if (input.amountMinor > outstanding) throw ...;
```

This is a read-then-write under PostgreSQL's default `READ COMMITTED` isolation. Two concurrent payouts to the same payee each read the same `outstanding`, each pass the check, and both insert. Nothing at the database level prevents over-payment — the only unique constraint is on `reference`, and two genuine payouts have different references.

Real-world likelihood is low: this is a two-or-three-person admin operation, not a public endpoint. But the consequence is real money paid twice, and the fix is cheap — either raise the transaction to `Serializable` (the codebase already has a `serializableTransaction` helper in `auth.service.ts`) or take a row lock on the payee's account first.

### 4.5 LOW — cash shortfalls are recorded but never resolved [VERIFIED]

`recordCashSettlement` handles a short handover correctly and thoughtfully: it allocates only as far as the counted money goes (`Math.min(countedAmountMinor, expectedAmountMinor)`), records the `discrepancyMinor`, and leaves the remainder outstanding against the driver. The CAS on `settledAmountMinor` means two receivers cannot double-settle the same custody row.

What is missing is the *next step*. There is no way to write off a persistent shortfall — no deduction from driver earnings, no bad-debt path, no ageing report beyond `oldestOutstandingAt`. A driver who is 200 ILS short stays 200 ILS short in the system forever unless someone hand-writes a `FinancialAdjustment` (for which there is no UI). For a cash business this will come up, probably in month one.

Relatedly: `defaultLossAbsorberByFault` deliberately maps a **driver**-fault failed delivery to `PLATFORM` rather than `DRIVER`. The comment explains this well — charging a driver for a failed delivery is a decision about a person's pay and should be a human's explicit act, not a default that fires when a reason code is picked from a list. I agree with the reasoning. But the human's act requires that missing adjustment UI, so in practice **the platform silently absorbs every failed delivery.**

### 4.6 LOW — an adjustment permits only one entry per payee [VERIFIED]

`recordAdjustment` writes every entry with `component: "ADJUSTMENT"`. The uniqueness guard is `(sourceType, sourceId, payeeKey, component)`. So a single adjustment carrying two lines for the same payee violates that index and surfaces as an unhandled `P2002` — a 500, not a clear validation error. Merge entries by payee before writing, or catch and explain.

### 4.7 LOW — `ledgerImbalanceMinor` becomes useless after the first adjustment [VERIFIED]

`getOverview` computes `ledgerImbalanceMinor = cashCollected − approvedOperatingCosts − totalEarned`, described in the code as "anything other than zero here means the ledger has drifted."

Subscription charges net to zero across the ledger, so they are fine. But an `ADJUSTMENT` entry that does not net to zero — which is most corrections, since the point is usually to move money to one party — will shift this figure permanently. The health indicator then reads non-zero forever and stops being a signal. It needs to exclude adjustment entries, or carry a separate expected-offset.

### 4.8 Correct-but-worth-knowing

- **Customer-supplied delivery coordinates set the delivery fee.** `calculateOrderQuote` computes distance from `input.deliveryLatitude/Longitude`, which the client sends freely — they are not validated against a saved address. A customer could send coordinates next to the store to pay the 10.00 minimum and give a distant address in the text field. The driver would notice; the system would not. Low impact at one-city scale, but it is an unpriced hole.
- **Stock is not restored on `DELIVERY_FAILED`.** Restoration happens on reject, customer cancel, and admin cancel, but not on a failed delivery — arguably correct, since the goods physically left the premises. Flagging it as an unhandled operational decision rather than a defect: if the driver brings the goods back, someone must adjust stock by hand.
- **`resolveRateSetForOrder` prefers the stamped rate set** and only falls back to a date lookup for orders predating stamping — and even then it looks up by the order's own `createdAt`, never by today's date. Correct.
- **Order arithmetic invariants hold in the live data.** I checked: `merchandiseDiscountMinor + deliveryDiscountMinor = discountMinor` on all 20 orders, and `totalMinor = subtotal + deliveryFee + serviceFee − discount` on all 20. No drift.
---

## 5. Missing operational infrastructure

The distinction that matters here is **documented vs. running**. `docs/operations-runbook.md` is a genuinely good runbook — it specifies alert thresholds, backup cadence, restore drills, and incident response. But it describes procedures a human must set up, and **none of them are currently set up**. Documentation is not infrastructure.

I have sorted these by whether they would actually hurt at your scale (one supermarket, ~33,000 population, cash-only) rather than by best practice.

### 5.1 Would hurt at launch scale

| Gap | Status | Why it hurts here |
|---|---|---|
| **SMS/OTP delivery** | Absent (§2.1) | No customers can register. Hard blocker. |
| **Push notification delivery** | Absent (§2.2) | Store and drivers miss orders. Product does not function. |
| **Permanent hosting + TLS + DNS** | Absent (ngrok) | Every APK dies when the tunnel rotates. |
| **Automated database backups** | Script exists, **no scheduler** | `npm run db:backup` is a manual command. A dropped container or corrupted volume loses every order and every ledger row, and cash-on-delivery reconciliation cannot be reconstructed from anywhere else. This is the highest-consequence gap after the money bug. |
| **Any scheduled job at all** | Absent | `@nestjs/schedule` is not a dependency (verified — zero matches in `apps/api/package.json`). See 5.2. |
| **Error monitoring destination** | Bridge exists, **no endpoint** | `ErrorReporterService` posts sanitized 5xx events to `ERROR_TRACKING_WEBHOOK_URL`, which production *requires*. Like the OTP webhook, that service does not exist. You would be flying blind on server errors, or forced to stand up a receiver just to boot. |
| **Log persistence** | Absent | Structured JSON to stdout only. A container restart loses history. At minimum configure Docker's json-file driver with rotation, or ship to a hosted log service. |
| **Uptime check** | Absent | `/health/live` and `/health/ready` exist and are correct; nothing polls them. A free external monitor (UptimeRobot, Better Stack) closes this in ten minutes. |

### 5.2 The scheduled-jobs gap, specifically

There is **no scheduler in the project**. Consequences, in order of impact:

1. **No automated backups** — as above.
2. **Monthly subscription billing is manual.** `POST /admin/accounting/subscriptions/generate` exists, is idempotent (unique on `businessId, periodYear, periodMonth`, and a duplicate is caught and counted as skipped), and is safe to re-run. But something has to call it, and there is no UI button either (§3.4). `docs/progress.md` discloses this honestly. At launch this affects zero businesses — JOVO MARKET is a supermarket, and only `businessType: RESTAURANT` businesses are billed — so it is **deferrable until restaurants launch**.
3. **No cleanup of expired rows.** `RefreshSession`, `PhoneVerificationChallenge`, and `PasswordResetToken` accumulate forever. Each has an `expiresAt` index, so they are cheap to purge, and nothing does. At your volume this is years away from mattering — but `PhoneVerificationChallenge` grows with every OTP request including failed ones, so an SMS-abuse burst (§6.5) would also be a table-growth event.
4. **No stale-order detection.** An order stuck in `READY_FOR_PICKUP` because no driver claimed it will sit there silently and forever (§3.2).
5. **No financial-integrity check.** Nothing periodically runs the §4.3 query, or counts `costDataComplete = false` records (which would have caught §4.1 on day one).

**Recommendation:** you do not need a job framework. A single host cron entry calling `npm run db:backup`, plus one more calling a small integrity-check script, covers items 1 and 5 — the two that actually bite. Add `@nestjs/schedule` later if you want the rest in-process.

### 5.3 Present and genuinely good

Credit where it is due — these are built and working:

- **Health endpoints** — `/health/live` (process) and `/health/ready` (process + `SELECT 1`) are properly separated, throttle-exempt, and wired into the Dockerfile `HEALTHCHECK` and the compose `depends_on: service_healthy` gate.
- **Prometheus metrics** at `/api/v1/metrics`, protected by a constant-time comparison against `MONITORING_TOKEN`, and returning 404 (not 401) when no token is configured — which correctly avoids advertising the endpoint's existence.
- **Structured JSON logging** with request IDs propagated end to end, and recursive redaction of `authorization`, `cookie`, `password`, `token`, `secret`, `otp`, and anything matching those patterns. Request bodies and query strings are deliberately never logged.
- **Rate limiting** at two layers — nginx (`20r/s` per IP, burst 40) and the app throttler, with tighter per-route limits on auth endpoints (5/min on OTP request, 10/min on login).
- **Backup and restore scripts** that are better than most: `pg_dump` custom-format archives with SHA-256 sidecars, retention handling, a `--verify-only` mode, and a restore command that *refuses to use `DATABASE_URL`* and demands the target database name as explicit confirmation. Genuinely thoughtful.
- **A hardened production container**: non-root user, read-only filesystem, `cap_drop: ALL`, `no-new-privileges`, tmpfs for `/tmp`, one-shot migration service gated before the API starts.
- **A strong nginx config**: HSTS, a real CSP, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` disabling camera/mic/geolocation, TLS 1.2+, 256 KB body limit.
- **Environment validation that fails closed.** `validateEnvironment` refuses to start production with a wildcard CORS origin, a non-HTTPS origin, a secret under 32 characters, a placeholder string in any secret, reused secrets, the development OTP provider, a missing error-tracking URL, or a monitoring token under 32 characters. This is the single best piece of operational defence in the project — most production incidents of the "we forgot to set X" class are impossible here.

### 5.4 Premature at your scale — do not build these yet

- Redis-backed distributed rate limiting (needed only at 2+ replicas)
- Read replicas, connection pooling beyond Prisma's default, query caching
- APM / distributed tracing
- Multi-region, blue-green deploys, autoscaling
- A message queue or event bus
- SLO dashboards

One supermarket in a 33,000-person area is, at a guess, tens of orders a day. A single small VPS with a managed Postgres will carry that with enormous headroom. Spend the effort on §5.1 instead.

---

## 6. Security review

The recent audit's fixes are in place and I could not find a way around them. What follows is what is left.

### 6.1 What I checked and found correct [VERIFIED]

- **Every controller is guarded.** I enumerated all 22 `@Controller` classes. Public-by-design: `auth` (throttled per-route), `drivers/register`, `restaurants` (browse + register), `supermarkets`, `health`, `metrics` (token-gated). Every other controller applies `JwtAuthGuard` + `RolesGuard`, and every administrative one adds `PermissionsGuard`. No route is accidentally open.
- **Authorization is per-business, not global.** `AuthorizationService.hasPermission` requires that a business-scoped permission come from *that specific business's* membership — a grant in business A never satisfies a request against business B. `resolveMemberBusinessId` refuses (409) rather than guessing when a user belongs to several businesses.
- **The WebSocket enforces the same rules as REST.** `handleOrderSubscribe` re-checks ownership before joining an `order:<id>` room: customers must own the order, business users must be an active member of the order's business, drivers must be the assigned driver. A permission model enforced only on REST would leak through the socket, and this one does not.
- **Sessions are database-backed.** `JwtAuthGuard` looks up the `RefreshSession` on every request and re-checks `revokedAt`, `expiresAt`, `tokenVersion`, `isActive`, and `phoneVerifiedAt`. Revocation is immediate rather than waiting out a token TTL. Costs one query per request; entirely affordable here.
- **Password reset revokes everything.** Increments `tokenVersion` *and* revokes all refresh sessions in the same transaction.
- **Refresh rotation is atomic.** `updateMany` guarded on `revokedAt: null`; if the CAS loses, the whole refresh is rejected. Token reuse cannot mint a second live session.
- **Crypto is right.** Argon2id with sane parameters (19 MiB, t=2, p=1), OTPs hashed with HMAC-SHA256 under a secret *separate* from the JWT secrets, refresh and reset tokens stored as SHA-256 hashes, constant-time comparison via `timingSafeEqual` with a hex-format guard.
- **No injection surface.** All database access goes through Prisma's query builder. The only raw SQL in the entire API is `SELECT 1` in the health check. Zero string-interpolated queries. [VERIFIED by grep]
- **No secrets in the repository.** `.env` and `.env.*` are gitignored (with explicit exceptions for the two `.example` files), `git ls-files` shows no tracked env file, and a regex scan for embedded credentials across tracked files found nothing.
- **Errors do not leak internals.** `AllExceptionsFilter` maps anything non-`HttpException` to a flat `INTERNAL_SERVER_ERROR` with no stack, no message passthrough, no details.
- **Prices are computed server-side.** The client sends `menuItemId` and `quantity`; the server reads the price. A tampered client cannot set its own prices.
- **Public views do not leak cost prices.** `toPublicItemView` omits `costPriceMinor` entirely; it appears only in `adminGetRestaurantMenu` and the authenticated business catalogue. I checked this specifically because leaked cost prices would expose your margins. [VERIFIED]

### 6.2 MEDIUM — the admin SPA stores tokens in `localStorage`, and the docs say otherwise [VERIFIED]

`apps/admin/src/api.ts` lines 170-185 use `localStorage` for both the access token and the refresh token.

`docs/security-review.md` states: *"web tokens use sessionStorage, are cleared when the tab session ends."* That is true of the **mobile web build** (`apps/mobile/src/core/session.ts:96-106` uses `sessionStorage`) but **false of the admin SPA**, which is the surface with the most privileged users.

Two consequences: an admin's refresh token survives browser restarts on a shared or unattended machine, and any XSS in the admin app yields a 30-day refresh token rather than a 15-minute access token. The nginx CSP (`script-src 'self'`) is a strong mitigation and there is no obvious XSS sink — but the doc/reality gap means nobody is currently *aware* of the exposure.

Move the admin app to `sessionStorage` to match both the documentation and the mobile web build.

### 6.3 MEDIUM — user enumeration on two endpoints [VERIFIED]

- `POST /auth/customer/signup/request-code` throws `PHONE_ALREADY_REGISTERED` (409) for a registered number (`auth.service.ts:63`).
- `POST /auth/password/forgot/request-code` throws `ACCOUNT_NOT_FOUND` (404) for an unregistered number (`auth.service.ts:242`).

Between them, an attacker can determine whether any Palestinian mobile number holds an account. `login` is correctly generic (`INVALID_CREDENTIALS`), so the effort went in — these two were missed.

Impact at your scale is genuinely low (the population of interest is small and the data is not especially sensitive), but the signup path is unauthenticated and rate-limited only at 5/min per IP, so it is enumerable at pace. Standard fix: return the same "if an account exists, a code was sent" response either way.

### 6.4 MEDIUM — self-registered drivers and businesses are marked phone-verified without verifying [VERIFIED]

Four code paths set `phoneVerifiedAt: new Date()` with no OTP challenge:

| Path | File | Public? |
|---|---|---|
| Driver self-registration | `drivers.service.ts:78` | **yes** |
| Business self-registration | `restaurants.service.ts:67` | **yes** |
| Business staff creation | `business-staff.service.ts:85` | no (authenticated) |
| Admin-created admin | `admin.service.ts:156` | no (authenticated) |

The last two are reasonable — a trusted person onboards someone and hands over a password. The first two are public endpoints, and `docs/security-review.md` explicitly accepts this risk on the grounds that such accounts cannot become operationally active until an admin approves them. That reasoning holds for *access*.

What it misses: `User.phone` is **globally unique across all roles**. So anyone can burn a phone number by registering it as a driver — and the legitimate owner of that number can then never sign up as a customer, because signup will report the number as already registered. It is a cheap denial-of-registration vector, rate-limited only at 5/min per IP, and there is no admin tooling to release a squatted number.

For a launch in one town it is unlikely to be exercised. Worth knowing it exists.

### 6.5 MEDIUM — no cap on OTP requests per phone number (SMS cost exposure) [VERIFIED]

`issueOtp` enforces a 60-second per-phone resend cooldown (database-backed, correct) and a 5-attempt verification cap. What it does **not** enforce is a ceiling on total codes per number per day.

Once a paid SMS provider is wired up (§2.1), an attacker can request one code every 60 seconds against an unlimited set of numbers, indefinitely. Each one costs you money. The per-IP throttle (5/min) slows a single source but not a distributed one, and the cost is asymmetric — cents per message against you, nothing against them.

**Add a daily per-phone cap and a global daily send ceiling before the SMS provider goes live, not after the first bill.** This is one of the few findings here where the cost of being wrong is unbounded.

### 6.6 LOW — a dev-only string is returned to production clients [VERIFIED]

`auth.service.ts:406` returns, unconditionally:

```
"A verification code was created. Check the backend terminal in development."
```

I traced its consumers: the mobile app receives it in `OtpRequestResult` but **does not render it** (only the password-reset success message is shown to a user). So this is an odd string in an API response, not something a customer sees. Cosmetic, but it will look wrong to anyone inspecting the API.

### 6.7 LOW — the security review predates the entire accounting layer [VERIFIED]

`docs/security-review.md` is dated **2026-08-06**. The accounting layer landed **2026-08-18** (migration `20260818150121`), and business staff management, operating costs, and cash settlement came with the Phase 15 work after that.

So the following have never appeared in a documented security review: `admin-accounting.controller.ts` (14 endpoints, including `RECEIVE_DRIVER_CASH` and `MANAGE_SETTLEMENTS`), `business-accounting.controller.ts`, `business-staff.controller.ts`, and the whole `BusinessMember`/`Role` permission model.

I read these paths in this audit and found their authorization correct. But the project's own security-review document no longer describes the project's actual attack surface, and its "Accepted or external risks" list has not been revisited against the money-handling endpoints.

### 6.8 LOW — audit log records staff phone numbers [VERIFIED]

`business-staff.service.ts:99` writes `metadata: { roleKey, phone }` into `AuditLog`. Personal data in an append-only log with no retention policy. Minor, and arguably justified for an audit trail, but worth a conscious decision rather than an accident.

### 6.9 LOW — account deletion leaves delivery addresses behind [VERIFIED]

`users.service.ts:deleteMyAccount` anonymises the `User` row properly — name becomes "Deleted account", phone becomes `deleted-<uuid>`, email nulled, password hash blanked, `tokenVersion` incremented, sessions revoked, addresses and push tokens deleted.

It deliberately keeps `Order` rows (correct — they are financial records, and the schema uses `onDelete: Restrict` to enforce that). But those orders still carry `deliveryAddressLine`, `deliveryLatitude`, `deliveryLongitude`, and `customerNote` — the person's home address and exact coordinates, retained indefinitely after they asked to be deleted.

I read `docs/privacy-policy.md` to check this. It says data is kept as long as needed for operations, order settlement, disputes, and accounting obligations, "then deleted or anonymised according to the approved retention schedule" (`ثم تُحذف أو تُجهّل وفق جدول الحفظ المعتمد`). Retaining order amounts is defensible under that wording — but **no retention schedule exists anywhere in this repository**, and nothing ever deletes or coarsens the address fields. The policy points at a document that has not been written.

A reasonable middle ground: keep the financial amounts indefinitely, and coarsen or redact `deliveryAddressLine`, coordinates, and `customerNote` on orders past a stated retention period. Then write the schedule the policy already promises.
---

## 7. Technical debt and documentation discrepancies

### 7.1 Technical debt that will slow future work

**a) 2,785 lines of hand-written Prisma test doubles** [VERIFIED]

```
apps/api/src/orders/testing/fake-prisma.ts             630
apps/api/src/restaurants/testing/fake-prisma.ts        584
apps/api/src/drivers/testing/fake-prisma.ts            474
apps/api/src/admin/testing/fake-prisma.ts              313
apps/api/src/users/testing/fake-prisma.ts              233
apps/api/src/accounting/testing/fake-accounting-prisma.ts  216
apps/api/src/auth/testing/fake-prisma.ts               255
apps/api/src/notifications/testing/fake-prisma.ts       58
apps/api/src/realtime/testing/fake-realtime-gateway.ts   22
```

These re-implement Prisma's query semantics by hand — `where` matching, `include` resolution, `updateMany` counts. This is the single largest maintenance liability in the codebase. Two specific risks:

- **A test can pass against a fake whose behaviour differs from PostgreSQL.** A `updateMany` CAS that the fake counts differently from the real engine would give a false green. The e2e suite covers the critical money paths against real Postgres, which mitigates this substantially — but only for the paths e2e touches.
- **Every schema change means updating up to eight hand-written fakes.** That is real friction on every future feature.

I would not rewrite these now. But if the fakes ever start costing more than they save, `testcontainers` or a per-suite throwaway schema is the standard exit.

**b) The same concept implemented two ways: business resolution** [VERIFIED]

Two mechanisms resolve "which business is this caller acting on":

- `AuthorizationService.soleBusinessId(context)` — used by `PermissionsGuard`, reads from the already-resolved authorization context, returns `null` on ambiguity.
- `resolveMemberBusinessId(client, userId)` — used by services, does its own database query, throws 404 or 409.

They agree today and both are correct. But it is two queries per request for the same fact, and two places to change if multi-business accounts ever become real. The guard already stashes the answer on `request.businessId`; services could read that instead of re-querying.

**c) The `Restaurant` table holds supermarkets** [VERIFIED]

One table, discriminated by `businessType`. `docs/architecture.md` documents this deliberately, and the accounting layer correctly refuses to force the two verticals through one formula. But the naming is now actively misleading: a supermarket's staff endpoints live under `/restaurant/me/*`, and `RESTAURANT_ORDERING_ENABLED` gates restaurants while `Restaurant` rows are what a supermarket is stored in. Every new developer will lose an hour to this. Renaming is a large, risky migration — my recommendation is **do not rename**, but do add a one-paragraph orientation note at the top of `schema.prisma`.

**d) Notification fan-out is N+1** [VERIFIED]

`createBusinessNotification` loops over members calling `createNotification` one at a time — one `INSERT` and one socket emit per member, inside the order-creation transaction. At 3-5 staff this is invisible. At 30 it lengthens the transaction that also holds inventory row locks. A `createMany` plus a single emit loop after commit would be strictly better whenever someone touches this file.

**e) `listCashSettlements` and `listOperatingCosts` are N+1 by construction** [VERIFIED]

Both fetch up to 200-300 ids and then call `this.getCashSettlement(id)` / `this.getOperatingCost(id)` per row — each of which issues its own query with includes, plus a `resolvePayeeNames` round trip. That is potentially 600+ queries to render one admin list. Irrelevant at launch volume; it will become the first slow page you notice.

**f) Tests that pass without verifying much**

Most tests here are good — the accounting suite in particular is written as worked examples with arithmetic spelled out, which is exactly right. Two weak spots:

- **`@wasel/admin` has 3 tests, all for the token-refresh coordinator** (§1). The accounting screens that record cash handovers and partner payouts have no tests at all.
- **`route-permissions.test.ts` does not cover the accounting controllers.** It locks the decorator wiring for nine controllers but omits `AdminAccountingController` and `BusinessAccountingController` — the two with the most financially sensitive permissions (`RECEIVE_DRIVER_CASH`, `MANAGE_SETTLEMENTS`, `APPROVE_OPERATING_COSTS`). The decorators are present and correct today; nothing would fail if someone removed one. **This is a five-line fix and I would do it.**

**g) Areas where a future change would likely break something unnoticed**

- Adding a supermarket product without a cost price (§4.1) — no test, no guard, no alert.
- Changing `calculatePromotionDiscounts` — the discount split feeds `splitDiscountByFunder`, which feeds a CHECK constraint. A change that made funded parts stop summing to the total would fail at *delivery time*, not at order time, and present as a driver unable to close a job.
- Adding a new `EarningComponent` — the sign and payee CHECK constraints are enumerated in SQL. A new component added to the Prisma enum without a matching migration would be silently unconstrained.
- Adding a permission — `SystemRolesService` deliberately never rewrites existing business roles, so a new permission needs a data migration to reach existing roles. `docs/progress.md` flags this from experience.

### 7.2 Documentation vs. reality

I checked the claims rather than taking them on trust. Most hold up — `docs/progress.md` is unusually honest, and explicitly discloses the missing subscription scheduler, the unreconciled legacy orders, and the cost-price flagging behaviour. These are the discrepancies I found:

| # | Claim | Reality | Where |
|---|---|---|---|
| 1 | "web tokens use sessionStorage, are cleared when the tab session ends" | True for mobile web; **the admin SPA uses `localStorage`** | `docs/security-review.md` vs `apps/admin/src/api.ts:170-185` |
| 2 | "Nothing recomputes the **six** pre-existing orders" | **Nine** terminal orders have no financial record | `docs/progress.md` vs database query |
| 3 | "the reconciliation check would refuse **two** of them" | **Four** delivered orders carry a non-zero service fee | `docs/progress.md` vs database query |
| 4 | Security review covers the API's auth and authorization surface | Dated **2026-08-06**, predates the entire accounting layer (2026-08-18), business staff, and operating costs | `docs/security-review.md` |
| 5 | Legal docs describe the product | `privacy-policy.md`, `terms-of-service.md`, and `store-listing.md` all still say **"TasawaQ"**, and the privacy policy describes restaurants throughout, never a supermarket | `docs/` — 22 occurrences across 6 files |
| 6 | Privacy policy: data deleted or anonymised "according to the approved retention schedule" | **No retention schedule exists** anywhere in the repository, and order delivery addresses survive account deletion indefinitely (§6.9) | `docs/privacy-policy.md` |
| 7 | `.env.production.example` documents production configuration | Omits `RESTAURANT_ORDERING_ENABLED` entirely. Safe (defaults false) but undocumented, so the launch flip is not discoverable from the production template | `.env.production.example` |

Note on #5: the **mobile app** is correctly branded — `app.json` has `name: "JOVO"`, `slug: "jovo"`, `package: "com.jovo.app"`, and user-facing Arabic strings say "جوفو". The `tasawaq` strings in `structured-logger.ts`, `metrics.service.ts`, `health.controller.ts`, and the i18n *key* `home.tasawaqWideOffer` (whose value reads "جوفو") are internal identifiers and harmless.

**But the admin panel is not correctly branded.** `apps/admin/src/i18n/locales/en.json:59` and `ar.json:59` both set `layout.brandTitle` to **"TasawaQ Ops"**, and `Layout.tsx:69` renders it as the console's header — including the page `<title>` at line 84. So the platform admin, and any JOVO MARKET owner or staff member who logs in, sees the old brand name at the top of every screen. In the business shell it is partly masked (the header falls back to the business's own name when one is set), but the platform-admin view and the browser tab title show "TasawaQ Ops" unconditionally.

That is a two-string fix in two locale files, but it is user-facing rather than internal, so add it to the launch list alongside the legal documents.

---

## 8. What to do before launch, in order

Ordered by *consequence if skipped*, not by effort. I have marked rough effort so you can sequence around the long-lead items.

### MUST — do not take a real customer order until these are done

**1. Enter cost prices for all six JOVO MARKET products.** *(10 minutes)*
Highest consequence-to-effort ratio in this entire document. Until this is done, every supermarket order silently pays JOVO MARKET roughly 45% of what it is owed and overpays the two platform owners, and the ledger's own self-check reports everything as balanced. Do this before the first real order, not after. §4.1

**2. Start production from a clean database.** *(1 hour)*
Fresh database, `prisma migrate deploy`, never `prisma db seed`. Create the first admin by hand with a real password. Do not carry forward the current dev database — it contains an ADMIN account whose password (`Test@12345`) is committed to this repository, plus 20 test orders, 4 smoke-test drivers, and two junk businesses. §2.4

**3. Stand up SMS/OTP delivery.** *(days to weeks — start today)*
Longest lead time in the project. Vendor selection, sender-ID registration, a deployed webhook bridge, a token. Without it no customer can register and the API will not start in production mode. Begin this before anything else on the list, because everything else can proceed in parallel and this cannot. §2.1

**4. Get permanent hosting with a stable HTTPS hostname.** *(1-2 days)*
DNS, TLS certificate with auto-renewal, a managed PostgreSQL instance (the production compose file deliberately excludes the database — you must provision it). Build the customer APK only *after* the hostname is final, because the API URL is compiled into the bundle. §2.5

**5. Set the timezone.** *(5 minutes)*
`ENV TZ=Asia/Hebron` in the `Dockerfile` and the production compose file. Then set JOVO MARKET's opening hours and confirm the store opens and closes at the right local time. Currently harmless only because opening hours are unset — the moment you set them on a UTC server they are 2-3 hours wrong. §2.3

**6. Schedule database backups and verify one restore.** *(2 hours)*
The scripts are already written and good. A host cron entry running `npm run db:backup`, copies to off-host storage, and **one actual restore drill** into a throwaway database. For a cash-on-delivery business, the ledger is the only record of who owes whom — it cannot be reconstructed from anywhere else. §5.1

**7. Rotate every secret and configure production environment.** *(1 hour)*
New `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `OTP_HASH_SECRET`, `MONITORING_TOKEN` — all distinct, all 32+ characters, none containing a placeholder string. `validateEnvironment` enforces all of this at boot, so a mistake here fails loudly rather than silently. Then run `npm run release:check -- --env-file=.env.production`.

**8. Update the three legal documents.** *(2 hours + legal review)*
`privacy-policy.md`, `terms-of-service.md`, `store-listing.md` still say "TasawaQ" and describe restaurants rather than a supermarket. These are published at public URLs and entered into store listings; a policy naming the wrong product is a store-review rejection and a legal exposure. Add the operator's legal name, address, and support contact.

While you are at it, fix `layout.brandTitle` in `apps/admin/src/i18n/locales/{en,ar}.json` — the admin console header and browser tab still read **"TasawaQ Ops"**, which every JOVO MARKET staff member will see on every screen. Two strings. §7.2

### SHOULD — within the first weeks of operating

**9. Ship push notifications.** *(2-3 days)*
The tokens are already collected and the mobile side is fully wired. What is missing is a sender in the API — an Expo push call in `notification.util.ts` after the transaction commits, plus receipt handling to deactivate dead tokens. Until then the store must keep the admin dashboard open with the sound on, and drivers must poll manually. I have this as SHOULD rather than MUST only because a single supermarket with a dedicated tablet can operate without it for a few weeks. It is the first thing that will hurt as volume grows. §2.2

**10. Fix the fulfillment-adjustment cost snapshot.** *(half a day)*
Once cost prices are entered (item 1), this becomes the next source of silent drift, and variable-weight items make it routine rather than rare. `recomputeOrderPricingAfterAdjustment` must also update `costPriceMinorSnapshot` — including the replacement product's cost when an item is substituted. §4.2

**11. Build the financial adjustment UI.** *(1-2 days)*
Financial history is immutable by database trigger, so a correction *requires* an adjustment, and today that means hand-writing `curl` with a bearer token. The first time a number is wrong in production — a cash shortfall, a mis-keyed price, a driver dispute — you will need this under time pressure. Pair it with the rate-set editor. §3.4, §4.5

**12. Add an integrity-check job.** *(half a day)*
One scheduled script, three queries: terminal orders with no financial record (§4.3), financial records with `costDataComplete = false` (would have caught §4.1 on day one), and cash custody older than N days still outstanding. Email or log the result. Cheap, and it converts a class of silent drift into something you find out about.

**13. Cap OTP sends per phone per day, and globally.** *(2 hours)*
Do this *before* the paid SMS provider goes live. The current 60-second cooldown does not stop sustained abuse across many numbers, and the cost is asymmetric and unbounded. §6.5

**14. Set up error monitoring and an uptime check.** *(2 hours)*
Production requires `ERROR_TRACKING_WEBHOOK_URL` to boot, so you need *something* there regardless. A free external HTTP monitor on `/api/v1/health/ready` closes the other half. §5.1

**15. Move admin tokens to `sessionStorage`.** *(15 minutes)*
Matches the documentation and the mobile web build. Reduces the blast radius of any future admin XSS from a 30-day refresh token to a 15-minute access token. §6.2

**16. Add the two missing accounting controllers to `route-permissions.test.ts`.** *(15 minutes)*
Locks the permission decorators on the endpoints that move money. §7.1f

**17. Solve catalogue entry.** *(varies — scope it early)*
You are about to enter a supermarket catalogue through a one-product-at-a-time form, with no bulk import and no image hosting. This is probably the largest *time* cost between now and launch, and it is invisible in the code. Decide now whether to build a CSV importer (a day or two) or accept the manual entry. Also decide where product images will live. §3.3

### CAN WAIT — real, but not at this scale

- **Subscription billing automation** (§5.2) — only bills `businessType: RESTAURANT`, and restaurants are gated off. Irrelevant until the restaurant vertical launches.
- **Driver dispatch, timeouts, reassignment** (§3.2) — a handful of drivers and a WhatsApp group is a legitimate v1 dispatch system.
- **User-enumeration fixes** (§6.3) and **phone-squatting** (§6.4) — real, low impact in one town.
- **Expired-row cleanup jobs** (§5.2) — years away from mattering.
- **Redis-backed rate limiting** (§2.6) — needed at 2+ replicas, not at 1.
- **N+1 query cleanups** (§7.1d, §7.1e) — will not be noticeable at launch volume.
- **Partner-payout race** (§4.4) — an admin-only path with two or three operators. Fix it when you touch that file.
- **Data export** (§3.4) — build it when your accountant asks, which will tell you the format they want.
- **Everything in §5.4** — genuinely premature.

---

## 9. Closing assessment

The engineering here is well above what a project at this stage usually looks like. The database-level financial guarantees in particular — unique indexes as double-count prevention, CHECK constraints encoding business rules, append-only triggers, versioned immutable rate sets, entitlement and custody kept as separate facts — are the kind of thing most teams add after their first bad month. Verifying them against a real PostgreSQL instance rather than a mock is the right instinct, and it worked: all 22 e2e assertions pass.

The risk profile is not "is the code good." It is that **a well-built system is one configuration away from being wrong, and this one has several of those pending**: an empty cost-price column that silently redirects roughly half the supermarket's revenue, a timezone that is correct on your laptop and wrong on a server, an SMS provider that must exist before a single customer can register, and a notification system that stores addresses and never posts to them.

None of these are hard to fix. All of them are easy to miss, because the system reports itself as healthy while every one of them is true.

Start with the cost prices. It is ten minutes and it is currently costing you money on every order.

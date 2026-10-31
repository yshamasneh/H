# Financial integrity audit — run 2 (`store-remediation-2`, report-only)

**Rule kept:** no formula, percentage, fee, commission, earning or settlement rule was changed. `apps/api/src/accounting/**`, `orders/pricing.ts` and the settlement code were not edited.

**Evidence base (run 2):** API unit suite 728 pass / 0 fail; PostgreSQL 16 e2e suite **103/103 passed** (`npm run test:e2e`, throwaway local database), including `accounting.e2e`, `order-idempotency.e2e`, `driver-settlement-reset.e2e`, `order-packing.e2e`, `sale-offers.e2e` and the new `account-deletion-obligations.e2e` and `demo-accounts.e2e`. `scripts/check-financial-integrity.mjs` was executed **against that local test database only** (clean; it holds almost no data after the suites clean up, so this proves the script runs, not that production is clean). Production was not queried.

## Run-2 code that sits next to money (all read-only towards financial rows)

| Change | Financial effect | Evidence |
|---|---|---|
| Demo orders (`Order.isDemo`) | `PATCH /driver/me/deliveries/:id/status` refuses DELIVERED and FAILED for a demo order **before** any financial code runs, so no `OrderFinancialRecord`, `DriverCashCustody` or `PartnerEarning` can be written for it. Real orders: unchanged code path. | `drivers/drivers.service.ts` `updateDeliveryStatus` guard; `integration/demo-accounts.e2e.test.ts` asserts 0 financial rows and 0 custody rows for the demo order. |
| Guest delivery-area route | Reads `DELIVERY_MAX_DISTANCE_METERS` with the same fallback the quote uses (`defaultDeliveryPricing.maximumDistanceMeters`); exposes no fee. | `restaurants/restaurants.service.ts` `getSupermarketDeliveryArea`; `orders/orders.service.ts:1218` |
| Driver deletion tests | Insert fixed-amount custody/earning rows in a test database only; verify they survive deletion unchanged and still link to the anonymised driver. | `integration/account-deletion-obligations.e2e.test.ts` |

## Findings status

- **F1, F2, F3 (LOW)**: still open, unchanged (see run 1 below). Proposed tests stand.
- **F4–F7 (INFO)**: re-verified by the e2e run above.
- **F8**: deletion now also covered on PostgreSQL with real custody/earnings rows (6/6).

## New observations (run 2)

| ID | Severity | Observation | Evidence | Proposed test (no change made) |
|---|---|---|---|---|
| F9 | LOW | **Analytics and dashboards count demo orders.** `Order.isDemo` is not filtered in revenue/order counts. Demo orders never complete, so they cannot reach revenue, but they appear in "orders today" and cancellation rates. | `admin/admin.service.ts` `getDashboard`; `analytics/*` | Analytics e2e: a cancelled demo order is excluded from counts once a filter is added (owner decision). |
| F10 | LOW | **A demo delivery left in ON_THE_WAY keeps the demo driver "busy"** (blocks claiming the next demo order and their own deletion) until an admin cancels the order. No money impact. | `drivers/dispatch.util.ts` busy check; `users/users.service.ts` `readDriverBlockers` | Procedure in `reviewer-access-guide.md` §3 (admin cancels after review). |
| F11 | INFO | **Order totals are always server-computed**; the client's `expectedTotalMinor` is only compared (409 on mismatch). Re-verified by `orders.service.test.ts` "order totals match server-computed subtotal, fees, and total" and `order-idempotency.e2e`. | `orders/orders.service.ts:105-120` | — |
| F12 | INFO | **Order and delivery transitions are compare-and-set** (`updateMany` with the expected current status, `count !== 1` → 409), so two concurrent actors cannot both move the same order. Delivery claim is the same pattern (`DELIVERY_ALREADY_CLAIMED`). | `orders/orders.service.ts` around `changed.count !== 1`; `drivers/drivers.service.ts` `acceptDelivery` | Covered by a unit test only (`drivers/drivers.service.test.ts`, `DELIVERY_ALREADY_CLAIMED`). Proposed: a PostgreSQL e2e firing two simultaneous accepts and asserting exactly one 201 and one 409. |

## Still not run

`npm run check:financial` against **production** (owner, read-only, documented in the script header).

---

# Financial integrity audit — store remediation run 1 (report-only, kept for history)

**Rule:** financial code is read-only in this run. No formula, percentage, fee, commission or settlement rule was changed.

**Scope:** checkout totals, delivery fee, driver earnings, cash custody and settlement, order state transitions, idempotency and transactions.

**Evidence base**

- The code on `store-remediation-1`.
- The API unit suite: 736 tests, 725 passed, 11 database tests skipped in the unit run.
- The PostgreSQL e2e suite: 82 out of 82 passed against a throwaway local database. It includes `accounting.e2e`, `order-idempotency.e2e`, `driver-settlement-reset.e2e`, `order-packing.e2e` and `sale-offers.e2e`.

**What touched financial data in this run:** only the new account-deletion code, and it only **reads**:

- active deliveries;
- `DriverCashCustody.status`;
- the payee balance `sum(PartnerEarning) − sum(PartnerSettlement)` for `DRIVER:<id>`, which is exactly the formula `AccountingService.recordPartnerSettlement` uses (`accounting.service.ts:816-821`).

Orders, custody, earnings and settlements are never written or deleted; this is asserted in `account-deletion.test.ts` (financial snapshot unchanged).

## Findings

| ID | Severity | Finding | Evidence | Risk | Proposed test or fix (for owner decision) |
|---|---|---|---|---|---|
| F1 | LOW | **The quote and the post-packing recompute calculate the total differently.** The quote computes `subtotal + deliveryFee − discount` with no clamp. The recompute after a fulfilment adjustment uses `Math.max(0, subtotal + deliveryFee − discount)`. | `apps/api/src/orders/orders.service.ts` (quote ≈ line 1104 `totalMinor: subtotalMinor + fees.deliveryFeeMinor - promotion.discountMinor`; recompute line 701) | If a promotion ever produced a discount larger than subtotal plus fee, the quote would produce a negative total, which `Order_totalMinor_check` rejects (500), while the recompute would silently clamp to 0 and break the identity `total = subtotal + fee − discount`. `calculatePromotionDiscounts` likely caps the discount, but that was not verified here. | A property test: for random offers and items, `discountMinor ≤ subtotal + deliveryFee` and both paths give the same total. If confirmed safe, drop the clamp or add it to both paths together. |
| F2 | LOW | **The recompute ignores `serviceFeeMinor`.** | `orders.service.ts:701` | Legacy orders created when a service fee existed (`serviceFeeMinor > 0`) would lose the fee from `totalMinor` if a fulfilment adjustment were approved after the fact. New orders always have 0. | Unit test: recompute on an order with `serviceFeeMinor > 0` keeps it in the total. A data check: `count(*) where serviceFeeMinor > 0 and status not in (DELIVERED, CANCELLED, FAILED)`. |
| F3 | LOW | **The total identity is not a database invariant.** CHECK constraints only require each component to be `>= 0`. | migrations: `Order_*_check` | A future code path could store an inconsistent total. | Either a CHECK `"totalMinor" = "subtotalMinor" + "deliveryFeeMinor" + "serviceFeeMinor" - "discountMinor"` (only after F1 and F2 are resolved and existing rows are verified), or a fourth question in `scripts/check-financial-integrity.mjs`. |
| F4 | INFO | **Idempotent order placement.** A unique `(customerId, idempotencyKey)` is checked and covered by e2e. | `schema.prisma` `Order @@unique([customerId, idempotencyKey])`; `order-idempotency.e2e` | — | — |
| F5 | INFO | **The client can't move the price.** The client sends `expectedDeliveryFeeMinor` and `expectedTotalMinor`, the server recomputes, and a mismatch is refused with 409 `ORDER_PRICE_CHANGED`. | `orders.service.ts:105-108` | — | — |
| F6 | INFO | **Over-settlement is impossible at the database level.** `settledAmountMinor` is never above `collectedAmountMinor` (CHECK), each earning is credited once by a unique index, and payouts above the outstanding balance are refused. | `schema.prisma` comments on `DriverCashCustody` and `PartnerEarning`; `accounting.service.ts:816-828` | — | — |
| F7 | INFO | **Customer cancellation follows the transition table.** It is allowed only while `allowedOrderTransitions[status]` includes CANCELLED, which in practice means before the store responds. Admin cancellation has its own status list. | `orders.service.ts:794-857` | — | — |
| F8 | LOW | **Account deletion and money.** A customer deletion leaves orders intact (the `Restrict` foreign key) and they stay linked to the anonymised user id, so accounting reports keep working. Driver deletion is scheduled while cash custody is open or the earnings balance is non-zero. **The store owner cannot self-delete**, which protects the `Restaurant.ownerUserId` and settlement link. | `users.service.ts`, `account-deletion.rules.ts` | A pending driver deletion still lets the driver accept new jobs, which can keep it pending. That is conservative, not harmful. | Owner decision: should a pending deletion stop new delivery claims? (Listed in `owner-action-items.md`.) |

## Not run

`npm run check:financial` (the production integrity detector) was not run: it needs the production database, and this run may not touch production data. The owner can run it as documented in the script header.

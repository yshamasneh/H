# Financial integrity audit — store remediation run 1 (report-only)

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

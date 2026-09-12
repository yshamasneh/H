# JOVO load-test results

Scope: JOVO MARKET (supermarket-only) core customer flow — login → browse supermarkets → open
catalog → quote (cart review) → place order — plus light admin/driver read load. Target: local
dev only.

## Environment

- Host: 20 logical CPUs, Windows. API, k6, and Postgres all on the same machine (so absolute rps
  numbers are conservative — the load generator competes with the app for CPU).
- API: `node apps/api/dist/main.js` (compiled), `NODE_ENV=development`, single process (no
  clustering).
- DB: PostgreSQL 17 (`tasawaq-postgres`), `max_connections=100`.
- Tool: k6 v1.3.0. Script: `customer-flow.js`, 30s per level, one shared authenticated session.
- Load-test-only overrides: global rate limit raised (`RATE_LIMIT_LIMIT`) and seeded product stock
  bumped to 1e8 so neither the throttler nor stock exhaustion masks the app tier.

## Finding before any fix: login is (correctly) rate-limited

Login is throttled to **10 requests / 60s / IP** (`@Throttle` on `POST /auth/login`) — a working
anti-brute-force control. An early script logged in per-VU from one IP and hit this immediately.
Resolved in the harness by authenticating once and reusing the session (what a real client does),
which is the right way to load-test everything *behind* login. Not a bug — recorded as a strength.

---

## Baseline (before fix) — pg pool at the driver default of 10

`customer-flow.js`, 30s per level, place-order every iteration.

| VUs | req/s | p95 | p99 | max | error % | orders placed |
|----:|------:|----:|----:|----:|--------:|--------------:|
| 10  | 452   | 80ms   | 114ms  | 267ms  | 0.00% | 3405 |
| 50  | 433   | 212ms  | 287ms  | 563ms  | 0.00% | 3298 |
| 100 | 321   | 589ms  | 750ms  | 1253ms | 0.00% | 2467 |
| 250 | 361   | 1440ms | 1758ms | 2070ms | 0.07% | 2858 |

Per-step p95 (ms):

| VUs | browse | catalog | quote | place order |
|----:|-------:|--------:|------:|------------:|
| 10  | 7   | 12  | 16  | 109 |
| 50  | 67  | 127 | 185 | 269 |
| 100 | 450 | 391 | 568 | 707 |
| 250 | 1175| 673 | 623 | 1736 |

### Analysis

- **Throughput plateaus at ~430–450 req/s and does not rise with concurrency** — it actually falls
  to ~320–360 req/s at 100–250 VUs while latency climbs roughly linearly. Classic saturation past
  the knee.
- **The knee is between 10 and 50 VUs.**
- **Every endpoint degrades uniformly** — even `browse supermarkets`, a single indexed SELECT, goes
  from 7ms (p95) to 1175ms. A slow query or N+1 would hit one endpoint, not all of them equally.
  Uniform degradation across the whole surface = a **shared-resource cap**.
- Postgres was never stressed (`max_connections=100`, only ~1–10 in use). The cap was on the app
  side: the **`@prisma/adapter-pg` pool was left at the `pg` driver default of `max: 10`**, so with
  20 CPUs and 100 available DB connections the app still allowed only 10 concurrent DB operations;
  everything else queued for a connection. Error rate stayed ~0 because requests queued rather than
  failed — they just got slow.

**Root cause: DB connection pool capped at 10 (driver default), not tuned to the host/DB.**
See the fixes and re-tests below.

---

## Fix 1 — make the DB connection pool configurable (default 20)

`PrismaService` now passes `max` (and an optional acquisition timeout) to the `pg` pool, from the
validated `DATABASE_POOL_MAX` env var (default 20, was the driver's 10). See
`apps/api/src/prisma/prisma.service.ts` and `apps/api/src/config/environment.ts`; regression tests
in `environment.test.ts`.

Re-run with `DATABASE_POOL_MAX=50`, per-step p95 at 50 VUs — the **read path is no longer
starved**:

| step        | pool=10 (before) | pool=50 (after) |
|-------------|-----------------:|----------------:|
| browse      | 67ms  | 12ms |
| catalog     | 127ms | 21ms |
| quote       | 185ms | 23ms |
| place order | 269ms | 1425ms |

Widening the pool **shifted the bottleneck**: with only 10 connections the read requests queued,
which throttled the overall rate and, as a side effect, kept order concurrency (and so order-row
contention) low. With 50 connections the reads fly, more orders hit the DB at once, and *order
placement* becomes the new limiter — see Fix 2 and the catalog analysis.

## Fix 2 — run the "new order" notification after the order transaction commits

`OrdersService.createOrder` reserved stock with a compare-and-swap `UPDATE` on the product row,
whose **row lock is held until the transaction commits**. That lock previously also covered the
business-notification work (a `businessMember` lookup + one insert per member). Moving the
notification to *after* commit shortens the critical section and is also more correct: a placed
order must never roll back because a notification failed. See `createOrder` and the regression test
"an order is still placed and stock reserved when the post-commit notification fails".

## Analysis — order placement is per-product-row lock contention (amplified by a tiny catalog)

The test originally ordered from only the **5 seeded products**, so every order contended on 5 rows.
Re-seeding the catalog to **205 products** (so the flow spreads orders across the 50 the catalog
returns) — the same build, same VUs — order latency drops sharply:

| VUs | place-order p95, 5 products | place-order p95, 50 products | error % (50 prod) |
|----:|----------------------------:|-----------------------------:|------------------:|
| 10  | 111ms  | 89ms  | 0.00% |
| 50  | 1425ms | **537ms** | 0.00% |
| 100 | 2144ms | 944ms | 0.00% |
| 250 | 2659ms | 1729ms | 0.00% |

Order tail latency fell ~2.7x at 50 VUs and the tail failures at 250 VUs vanished. This confirms the
remaining order bottleneck is **per-product-row lock contention during checkout**, which the
5-product test catalog concentrated ~10–40x. A production JOVO MARKET has hundreds of SKUs (bulk
importer exists), spreading it much further — so this is largely a test artifact, not a production
defect. A future optimisation, if a single product ever becomes that hot, is to acquire the stock
lock as late as possible in the order transaction (reserve just before commit); not done here to
avoid a risky reorder of financial-critical code for a load level far beyond launch needs.

## Final picture (after Fix 1 + Fix 2, realistic 50-product catalog)

| VUs | req/s | overall p95 | overall p99 | error % | orders placed (30s) |
|----:|------:|------------:|------------:|--------:|--------------------:|
| 10  | 415 | 70ms   | 91ms   | 0.00% | 3125 |
| 50  | 401 | 405ms  | 565ms  | 0.00% | 3033 |
| 100 | 323 | 763ms  | 967ms  | 0.00% | 2470 |
| 250 | 348 | 1547ms | 1756ms | 0.00% | 2723 |

- **Sustained ~400 req/s / ~100 orders/s with 0% errors**, degrading gracefully (higher latency, no
  failures) as concurrency climbs well past any launch-realistic level. JOVO MARKET's initial
  single-city launch will see a tiny fraction of this.
- The remaining plateau is the **single-process ceiling**: one Node instance (one event-loop core)
  plus Postgres plus the k6 generator all share this one machine. The scale-out fix is horizontal —
  run several API instances behind the load balancer (each with a pool sized so the sum stays under
  Postgres `max_connections`). That is a deployment change, not a code defect.

## Fix 3 — make the interactive-transaction timeout configurable (default 5s → 10s)

The ~0.1% order failures at the 250-VU peak were not application logic: the API log showed 20
`A query cannot be executed on an expired transaction` errors. Prisma's default interactive
transaction timeout is **5000ms**, and under hot-product contention a few order transactions queued
on the row lock and ran ~5.2s, so Prisma aborted them and the checkout hard-failed. `PrismaService`
now sets a configurable `transactionOptions.timeout` (default **10s**) and `maxWait` (default 5s),
from validated env vars (`DATABASE_TRANSACTION_TIMEOUT_MS` / `DATABASE_TRANSACTION_MAX_WAIT_MS`).

Re-run at a constant 250 VUs for 45s after the fix: **0 expired-transaction errors** (was 20),
order p95 1.17s, max latency 1.75s — comfortably under the ceiling, so no checkout is aborted for
being slow. (A constant-250 burst still shows a couple percent of client-side connection failures
at t=0 from slamming 250 sockets onto localhost at once — a load-generator artifact, no server error
logged; the gradual `mixed-ramp` shows 0.10%.)

## Combined ramp with admin + driver reads (`mixed-ramp.js`, after both fixes)

One 3m30s run: customer flow ramping 10→50→100→250 VUs while 3 admin VUs poll the order list and 3
driver VUs poll active + available deliveries throughout.

- **16,086 orders placed**, `customer_errors` **0.10%** (17/16103 — a few order retries at the
  250-VU peak), overall `http_req_failed` **0.02%**, checks 99.96% succeeded.
- **Admin order list**: avg 206ms, p95 1.13s, **0 errors** (892 reads).
- **Driver active-delivery fetch**: avg 112ms, p95 760ms, **0 errors** (871 reads).
- The admin/driver read paths never errored — they just slow down in step with the customer write
  load, as expected on a single shared instance.

### Degradation point (summary for the brief)
- **Knee ≈ 50 VUs.** Below that, p95 < ~100ms. Throughput saturates ~400–450 req/s and does not rise
  with more VUs; past the knee, latency grows roughly linearly while error rate stays ~0 (requests
  queue, they don't fail) until very high concurrency.
- No DB connection-pool exhaustion after Fix 1; no timeouts; Postgres never near its 100-connection
  limit.

# Load-test & hardening progress log

Running log of what was tested, what was fixed, and what's still open. Newest first.

## 2026-09-12

### Done
- Stood up local dev (Postgres `tasawaq-postgres`, migrations incl. the new P2 one, seed, compiled
  API) and installed k6 v1.3.0 locally under `load-tests/.bin/` (not committed).
- Built the k6 harness: `customer-flow.js` (parametrised per-level), `mixed-ramp.js`
  (10→50→100→250 ramp + light admin/driver reads), `run-levels.sh`, README.
- Ran the ramp. Baseline numbers + analysis in `RESULTS.md`.
- **Finding (strength):** login is rate-limited to 10/min/IP (anti-brute-force) — confirmed working;
  harness now authenticates once and reuses the session to test the app tier behind login.
- **Bottleneck found:** the `@prisma/adapter-pg` connection pool was at the driver default
  `max: 10`, capping the whole app at 10 concurrent DB ops on a 20-CPU host with a 100-connection
  Postgres. Throughput plateaued ~450 req/s and every endpoint degraded uniformly under load.

### Fixed
- **Fix 1 — DB connection pool.** `PrismaService` now sets the `pg` pool `max` from a validated
  `DATABASE_POOL_MAX` (default 20, was the driver's 10) + optional acquisition timeout. Regression
  tests in `environment.test.ts`. Re-run: read path no longer starved (catalog p95 @50 VUs
  127ms→21ms). This shifted the bottleneck to order placement.
- **Fix 2 — notification out of the order transaction.** The stock-reservation row lock is held
  until commit; the "new order" notification (a member lookup + inserts) used to run inside that
  window. Moved it post-commit — shorter critical section + more correct (a notification failure no
  longer rolls back a placed order). Regression test added.
- **Diagnosed order-row contention** (per-product-row lock, amplified by the 5-product test
  catalog). Proved by re-seeding 205 products: order p95 @50 VUs 1425ms→537ms, 0% errors. Documented
  as largely test-amplified; a real catalog spreads it. RESULTS.md has the before/after.

### Open / not yet done
- Order lock-window micro-opt (reserve stock just before commit) — noted as a future option, not
  done (risk vs. reward on financial code for load beyond launch needs).
- Horizontal scaling (multiple API instances) for throughput beyond the single-process ceiling —
  deployment concern, not code.
- Part 3: expand test coverage on critical paths (auth, checkout, order transitions, P1–P3 admin
  flows, COD, permission bypass).

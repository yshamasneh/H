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
See the fix and re-test below.

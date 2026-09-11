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

### In progress
- Fixing the connection-pool cap (make it configurable + a sensible default) and re-running to
  confirm improvement.

### Open / not yet done
- Re-run after the pool fix (below) and record before/after.
- Investigate whether order placement (a transaction holding a connection) is the next bottleneck
  after the pool is widened.
- Part 3: expand test coverage on critical paths (auth, checkout, order transitions, P1–P3 admin
  flows, COD, permission bypass).

# JOVO load tests (k6)

Load tests for the JOVO MARKET (supermarket-only) core flows. **Target local/dev only — never
production.**

## What's here

- `customer-flow.js` — the core customer flow (login → browse supermarkets → open catalog → quote →
  place order), parametrised by env vars (`VUS`, `DURATION`, `BASE_URL`, `PLACE_ORDER_RATIO`,
  `THINK_MS`, `SUMMARY_OUT`). Used for clean per-level numbers.
- `mixed-ramp.js` — one repeatable run: the customer flow ramping **10 → 50 → 100 → 250** VUs, plus a
  light constant load on the admin order list and the driver active-delivery fetch.
- `run-levels.sh` — runs `customer-flow.js` at 10/50/100/250 VUs and saves a JSON summary per level.
- `RESULTS.md` — captured results and analysis.
- `PROGRESS.md` — running log of what was tested / fixed / still open.

## Prerequisites

1. **k6 binary.** Not committed. Download once into `load-tests/.bin/`:
   ```powershell
   $ver="v1.3.0"
   Invoke-WebRequest "https://github.com/grafana/k6/releases/download/$ver/k6-$ver-windows-amd64.zip" -OutFile "$env:TEMP\k6.zip"
   Expand-Archive "$env:TEMP\k6.zip" "$env:TEMP\k6x" -Force
   Copy-Item (gci "$env:TEMP\k6x" -Recurse -Filter k6.exe).FullName "load-tests\.bin\k6.exe"
   ```
   (Or install k6 globally and call `k6` instead of the local path.)
2. **Local API + Postgres + seed data.** Start Postgres (`docker compose up -d db` or the existing
   `tasawaq-postgres` container), then:
   ```bash
   npm run prisma:deploy && npm run prisma:seed && npm run build -w @wasel/api
   ```
3. **Run the API with the rate limiter raised** so a single-IP load test measures the app tier, not
   the throttler (default is 400 req/min/IP). This override is load-test-only:
   ```bash
   cd apps/api && RATE_LIMIT_LIMIT=100000000 NODE_ENV=development node dist/main.js
   ```
4. **Bump seeded stock** so order placement doesn't exhaust the 5 seeded products mid-run:
   ```sql
   UPDATE "MenuItem" SET "stockQuantity" = 100000000 WHERE "stockQuantity" IS NOT NULL;
   ```

## Run

```bash
# per-level (clean numbers):
BASE_URL=http://localhost:3000/api/v1 bash load-tests/run-levels.sh
# all-in-one ramp with admin/driver reads:
BASE_URL=http://localhost:3000/api/v1 load-tests/.bin/k6.exe run load-tests/mixed-ramp.js
```

Seeded customer used by the scripts: `+970590000000` / `Test@12345` (see `apps/api/prisma/seed.ts`).

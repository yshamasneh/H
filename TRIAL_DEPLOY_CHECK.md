## 2026-09-26 — Trigram-search migration applied to Trial

Ops action, no application code change. Migration
`apps/api/prisma/migrations/20260926114347_add_menu_item_trigram_search`
(`pg_trgm` extension, `jovo_normalize_arabic_text()`, GIN trigram index on
`MenuItem.name`) is now live on the Trial database
(`jovo-market-db-shamasneh.postgres.database.azure.com` / `jovo`), and the
Trial API is running the commit that contains the trigram-search service code.

**Used the documented process** (`deploy.ps1`'s migration step / the same
commands `.github/workflows/deploy-trial-api.yml` runs): `docker build
--target migration -t jovo-migrate .` then `docker run --rm -e
DATABASE_URL=<trial> jovo-migrate`.

**Found and fixed a real blocker first.** A prior attempt to apply this same
migration to Trial had already failed and was sitting stuck in
`_prisma_migrations` (`applied_steps_count: 0`, no `finished_at`) — this is
almost certainly why the CI deploy workflow for that push never reached its
"deploy image" step, and why Trial was still serving the previous commit.
Root cause: Azure Postgres Flexible Server's `azure.extensions` allow-list
was empty, so `CREATE EXTENSION pg_trgm` was rejected
(`extension "pg_trgm" is not allow-listed for users in Azure Database for
PostgreSQL`). The failed transaction had rolled back cleanly — nothing else
in the DB was touched (verified: only `plpgsql` was installed beforehand).

Fix, in order:
1. `az postgres flexible-server parameter set --resource-group jovo-trial
   --server-name jovo-market-db-shamasneh --name azure.extensions --value
   pg_trgm` — dynamic parameter, no restart needed. Nothing else was on the
   allow-list, so this was purely additive.
2. `docker run --rm -e DATABASE_URL=<trial> jovo-migrate npx prisma migrate
   resolve --rolled-back 20260926114347_add_menu_item_trigram_search` (run
   with `-w /app/apps/api`, the image's actual schema location) to clear the
   stuck failed-migration record.
3. Re-ran the migration (step above) — applied cleanly this time.
4. Also built and deployed the **runtime** image for the same commit
   (`docker build --target runtime`, push to ACR, `az webapp sitecontainers
   update`) so the live API would actually run the trigram-search code for
   the smoke test below, rather than just having the DB side ready. This is
   the same thing the CI workflow does on every push to this branch, and
   that workflow will keep doing it on the next push — this was only done
   by hand here to verify end-to-end within this task.

**Verified on Trial (not just locally):**
- `SELECT extname, extversion FROM pg_extension WHERE extname='pg_trgm'` → `pg_trgm 1.6`.
- `jovo_normalize_arabic_text` function present and correct on real data:
  `jovo_normalize_arabic_text('أَحْمَد إبراهيم آلة مرآة')` → `احمد ابراهيم اله مراه`.
- `MenuItem_name_normalized_trgm_idx` GIN index present, on the expected expression.
- `/api/v1/health/ready` reports the new commit and `database: connected`.
- **Smoke test against the real live catalog** (JOVO MARKET, `GET
  /api/v1/supermarkets/{id}/catalog?search=...`), using real seeded Arabic
  product names, not synthetic fixtures:
  - Typo `حلبب` (a garbled "حليب"/milk) → correctly returns all 5 real milk
    products ("الجبريني حليب طازج1ل", "ارويد حليب جوزهند 1ل", etc.), which a
    plain substring search would have missed entirely.
  - Alef-variant `أرز` (hamza-alef "rice") → correctly finds "الوليمة ارز
    بسمتي 1كغم", stored with the bare alef (ارز) — real cross-alef-form
    matching, not a contrived test case.

No file diff was required for the migration/deploy itself; this note and
the ACR image push/App Service container update are the record of it.

---

# Trial Deployment Readiness (Dev Mode, Azure)

**Target:** JOVO API on Azure App Service (Docker) + Azure Database for PostgreSQL
Flexible Server. **Mode:** `NODE_ENV=development` (internal trial, not a real launch).
**Branch:** `agent/phase-15-and-jovo-brand` @ `05d495e`. **Date:** 2026-08-29.
Production-only requirements (real SMS provider, error-tracking webhook, strict CORS,
secret-placeholder checks) are intentionally **out of scope** — none apply in dev mode.

---

## Verdict

**Ready with small fixes.** The code boots cleanly in dev mode on nothing more than a
`DATABASE_URL` and three JWT/OTP secrets (verified by executing the validator), the API
build produces a working `dist/main.js`, and nothing in the server hardcodes localhost or
an ngrok/dev host. There are exactly **three things you must get right in the Azure config**
or it won't work, and none are code changes: (1) **override `NODE_ENV=development`** as an
App Service setting, because the Docker image bakes in `NODE_ENV=production` and that flips
on all the strict production requirements; (2) **apply the database migrations out-of-band**
(the runtime image can't self-migrate), or every request 500s on missing tables; and (3) put
**`?sslmode=require`** in the `DATABASE_URL`, because Azure Postgres refuses non-TLS
connections. Do those three, set the App Service settings below, and it will run for a trial
today.

---

## Minimal `.env` for this trial (App Service → Configuration → Application settings)

```
NODE_ENV=development                 # CRITICAL: overrides the image's baked-in "production"
DATABASE_URL=postgresql://jovoadmin:YOUR_DB_PASSWORD@YOUR-SRV.postgres.database.azure.com:5432/jovo?sslmode=require
JWT_ACCESS_SECRET=trial-access-secret-please-use-32-plus-chars-01
JWT_REFRESH_SECRET=trial-refresh-secret-please-use-32-plus-chars-2
OTP_HASH_SECRET=trial-otp-secret-please-use-32-plus-chars-03xyz
WEBSITES_PORT=3000                   # tells Azure which container port to route to (matches EXPOSE 3000)
LOG_LEVEL=debug                      # keep at debug/log/verbose so the dev OTP code is printed
```

Notes:
- The three secrets must each be **≥32 characters and all different from each other** — that
  is the only rule the validator enforces in dev mode (placeholder text like `trial-...` is
  fine in dev; it is only rejected in production). Different values, not the same string.
- Nothing else is required to boot. `CORS_ORIGIN` defaults to `*`, `REQUIRE_HTTPS` defaults to
  `false`, `OTP_PROVIDER` defaults to `development`, and no error-tracking/monitoring vars are
  required when `NODE_ENV` is not `production` (all verified by running the validator).
- Optional: add `RESTAURANT_ORDERING_ENABLED=true` only if you want to test the restaurant
  vertical — it defaults to `false` (supermarket-only), so the seeded demo *restaurant* is
  hidden from customers until you flip it. The seeded *supermarket* (JOVO MARKET) works either way.

---

## Blockers (would actually break the trial deploy)

- **The image runs as `NODE_ENV=production` unless you override it.** `Dockerfile:23` sets
  `ENV NODE_ENV=production` in the runtime stage. I ran the exact minimal env above under
  `NODE_ENV=production` and it was **rejected** at boot (`CORS_ORIGIN must contain explicit
  HTTPS origins in production`) — and it would further demand an OTP webhook, error-tracking
  webhook, and a 32-char monitoring token, none of which exist for a trial. **Fix:** set
  `NODE_ENV=development` as an App Service application setting (App Service env vars override
  the Dockerfile `ENV`). Confirmed the same env **passes** under `NODE_ENV=development`.

- **Migrations are not applied by the container — you must run them yourself, first.** The
  runtime image copies only `dist`, `package.json`, and pruned `node_modules`
  (`Dockerfile:29-31`); it contains **no `prisma/` folder and no Prisma CLI** (a devDependency,
  removed by `npm prune --omit=dev`). The app's only startup DB action is `$connect()`
  (`apps/api/src/prisma/prisma.service.ts:13-15`) — it does **not** migrate. If you skip this,
  the app boots and connects but every query hits missing tables. **Fix (simplest for a trial):**
  from your workstation, point at the Azure DB and run the migrations before/at deploy:
  ```
  # temporarily allow your client IP in the Flexible Server firewall, then:
  DATABASE_URL="postgresql://jovoadmin:PWD@YOUR-SRV.postgres.database.azure.com:5432/jovo?sslmode=require" \
    npm run prisma:deploy -w @wasel/api
  ```
  (`prisma.config.ts:13` reads `DATABASE_URL` from the environment.) 24 migrations apply; I
  validated the schema locally (`npm run prisma:validate` → valid) and CI applies these same
  migrations cleanly to a fresh `postgres:17`.

- **`DATABASE_URL` must carry an `sslmode`, or the connection is refused.** Azure Postgres
  Flexible Server requires TLS. I tested how `@prisma/adapter-pg` → node-postgres interprets the
  URL: **no `sslmode`** → `ssl: undefined` (plaintext → Azure rejects → boot fails at
  `$connect`); **`?sslmode=require`** → verifies against Node's CA bundle, which matches Azure
  Flexible Server's public DigiCert cert → **works**; **`?sslmode=no-verify`** →
  `{rejectUnauthorized:false}` → encrypted, no cert check (bulletproof fallback). **Fix:** use
  `?sslmode=require`; if you ever see a cert-chain error (e.g. Single Server or a private cert),
  switch to `?sslmode=no-verify`.

---

## Worth fixing first but won't block

- **Enable WebSockets on the App Service.** Azure App Service ships with WebSockets **off** by
  default; the app uses Socket.IO for live order/notification updates. With it off, the app still
  works fully over REST (realtime is only a "go re-fetch" signal), but live updates won't push.
  Turn on Configuration → General settings → **Web sockets: On** if you want to test realtime.

- **Keep `LOG_LEVEL` at `log`/`debug`/`verbose`.** The development OTP code is emitted at `log`
  level (`apps/api/src/auth/otp.provider.ts:20`). If you set `LOG_LEVEL=warn`/`error`, testers
  won't see the OTP in the logs. Default in dev is `debug`, so leaving it unset is fine.

- **Set `WEBSITES_PORT=3000` explicitly.** The app listens on `PORT` (default 3000) at
  `0.0.0.0` (`apps/api/src/main.ts:77-78`) and the image `EXPOSE`s 3000. Azure usually detects
  the exposed port, but setting `WEBSITES_PORT=3000` removes any ambiguity. (If Azure injects its
  own `PORT`, the app honors it automatically — no code change needed.)

- **Point the App Service health check at `/api/v1/health/ready`.** It runs a real `SELECT 1`,
  so it also tells you if the DB wiring is wrong. (`/api/v1/health/live` is process-only; the
  container `HEALTHCHECK` already uses it.)

- **New-since-last-audit, trial-relevant:** two additive migrations
  (`20260820120000_add_order_idempotency_key`, `20260827000000_fulfillment_adjustment_cost_snapshot`)
  and two new **optional** env vars with defaults (`OTP_MAX_PER_PHONE_PER_DAY`,
  `OTP_MAX_GLOBAL_PER_DAY`). None require action for a trial. The `npm audit` high-sev finding
  from the production report is in the Prisma **CLI** (devDependency, pruned from the image) — it
  does not affect the running trial.

---

## How to get the OTP code during testing

Two options, fastest first:

1. **Skip OTP entirely — use a seeded account.** All seeded users are already phone-verified, and
   login is phone + password (no OTP). Seed the trial DB once (safe in dev mode; blocked in
   production by `seed.ts:10-12`):
   ```
   DATABASE_URL="postgresql://...azure...?sslmode=require" npm run prisma:seed -w @wasel/api
   ```
   Then sign in with (all password **`Test@12345`**):
   - Customer: **`+970590000000`**
   - Platform admin: **`+970590000001`**
   - JOVO MARKET (supermarket) owner: **`+970590000004`**
   - Demo driver (approved): **`+970590000003`**
   - Demo restaurant owner: `+970590000002` (only visible to customers if you set
     `RESTAURANT_ORDERING_ENABLED=true`)

2. **For a real new signup / password reset**, the dev OTP provider logs the code to stdout as
   `[DEV OTP] <PURPOSE> <phone> => <code>`. On Azure: enable **App Service logs** (Monitoring →
   App Service logs → filesystem), then watch **Log stream** in the portal, or run
   `az webapp log tail -g <resource-group> -n <app-name>` and look for `DEV OTP`.

---

## Verified working (commands run / code read)

- **Dev-mode boot needs only DB + 3 secrets.** Ran `validateEnvironment` with just
  `NODE_ENV=development`, `DATABASE_URL`, and three distinct 32-char secrets → **accepted**;
  resolved `OTP_PROVIDER=development`, `CORS_ORIGIN="*"`, `REQUIRE_HTTPS=false`,
  `RESTAURANT_ORDERING_ENABLED=false`. The identical env under `NODE_ENV=production` → **rejected**.
- **Postgres SSL behavior** parsed via `pg-connection-string` (what the adapter uses): `require`
  → verify against CA bundle (works with Azure Flexible Server), `no-verify` → skip verify, none
  → no SSL (Azure rejects). See "Blockers" for the table of outcomes.
- **API build is clean.** `npm run build -w @wasel/api` (prisma generate + tsc) → **exit 0**,
  `apps/api/dist/main.js` produced. `npm run typecheck` across all three workspaces → **exit 0**.
- **Unit tests green.** `npm test -w @wasel/api` → **348 pass, 0 fail, 3 skipped** (the skips are
  the opt-in DB e2e tests).
- **Schema + migrations sound.** `npm run prisma:validate` → valid; 24 migrations with monotonic
  timestamps; the runtime image was inspected and confirmed to carry no migrations/CLI.
- **No hardcoded dev hosts in the shipping server.** Grep for `localhost|127.0.0.1|ngrok|10.0.2.2`
  hit only e2e tests and the two client apps' dev fallbacks — never the API runtime code. The
  mobile client's only build-time host input is `EXPO_PUBLIC_API_URL`.

---

## Mobile app pointing at Azure

`EXPO_PUBLIC_API_URL` is the **only** thing to change. An `https://<app>.azurewebsites.net` URL
satisfies the mobile client's production HTTPS guard (`apps/mobile/src/core/api.ts:360-361`, which
only requires the value to start with `https://`). For an Expo **dev** build (`__DEV__`), the guard
is skipped entirely and any URL works. Nothing else in the mobile bundle hardcodes a host — the
localhost/`10.0.2.2` values are dev fallbacks used only when `EXPO_PUBLIC_API_URL` is unset. (Set
CORS is not an issue for the native app; Expo-web/admin get `CORS_ORIGIN=*` in dev.)

---

## Assumptions made

- **Azure Database for PostgreSQL Flexible Server** (public-CA cert), so `sslmode=require`
  verifies successfully. On Single Server or with a private/custom cert, use `sslmode=no-verify`.
- You deploy the existing `Dockerfile` **`runtime`** target as the container image and set config
  via App Service application settings (which override the image's `ENV`).
- The trial uses the **supermarket (JOVO MARKET)** flow out of the box; restaurants stay gated
  unless you set `RESTAURANT_ORDERING_ENABLED=true`.
- The **admin SPA** (`apps/admin`) is optional and not part of this API/mobile trial; if you host
  it, set `VITE_API_URL` to the Azure URL at build time (it has the same HTTPS guard,
  `apps/admin/src/api.ts:6`).
- **I could not run `docker build` or connect to a live Postgres in this environment** (no Docker
  daemon available). Docker-build success is inferred from a clean local API build plus the
  image's simple copy steps; DB/migration behavior is inferred from `pg-connection-string`
  parsing, local schema validation, and CI's fresh-Postgres `migrate deploy` + e2e run. Do one
  real boot against the Azure DB (watch `/api/v1/health/ready` return 200) as the final smoke test.

# Deployment Readiness Report

**Target:** JOVO (React Native + NestJS/Prisma + PostgreSQL)
**Branch audited:** `agent/phase-15-and-jovo-brand` @ `05d495e`
**Date:** 2026-08-29
**Auditor scope:** go/no-go verification of current, actual status. Every claim
below is backed by a `file:line` reference or a command I actually ran. I did
not deploy, push, or touch any remote/production service.

---

## Verdict

**Not ready — but the blockers are overwhelmingly *external provisioning* and two
small repo fixes, not code defects.** The codebase itself is genuinely
production-hardened: environment validation fails closed (verified by running it),
the container topology is non-root/read-only/cap-dropped with correct restart and
health gating, HTTPS is enforced on all three surfaces, the timezone bug is fixed,
migrations are ordered and valid, and 348/351 unit tests pass with a clean
typecheck across all three workspaces. What is missing is the stuff that lives
outside Git: **no real SMS/OTP delivery service exists** (the app cannot serve a
single customer, and will not even boot in production, without one), **no permanent
hosting / managed PostgreSQL is provisioned**, **backups are scripted but never
scheduled and never restore-tested**, and **the published legal/store documents still
say "TasawaQ" and describe a restaurant business the app is not launching as.** In
addition, the CI pipeline's own final gate (`npm audit`) is currently red. None of
these are hard to close, but a real customer order cannot be taken until they are.

---

## Blockers (must fix before going live)

- **No real SMS/OTP delivery service.** The app-side adapter is real and *required*
  in production — `validateEnvironment` refuses to boot unless `OTP_PROVIDER=webhook`
  with an HTTPS `OTP_WEBHOOK_URL` + 32‑char `OTP_WEBHOOK_TOKEN`
  (`apps/api/src/config/environment.ts:33-39`), and `WebhookOtpProvider` really does
  POST `{phone,purpose,code}` to that URL (`apps/api/src/auth/otp.provider.ts:31-64`).
  But **the webhook receiver and the SMS/WhatsApp gateway behind it do not exist in
  this repo** — only the development terminal-print provider is implemented. Without a
  deployed receiver, no customer can register and production will not start.
  *What's needed:* choose a provider, register a sender ID, deploy the webhook bridge,
  set the three env vars. Longest lead time in the project — start first.

- **No permanent hosting, TLS hostname, or managed PostgreSQL.** `docker-compose.production.yml`
  deliberately excludes the database (it must be provisioned externally), and the API
  URL is compiled into the mobile bundle (`apps/mobile/src/core/api.ts:352-362`), so the
  final HTTPS hostname must exist before the customer APK is built. *Evidence:* no DB
  service in the compose file (only `migrate`, `api`, `web`); `EXPO_PUBLIC_API_URL` and
  the TLS cert paths are hard-required at compose parse time
  (`docker-compose.production.yml:44,52-53`).

- **`ERROR_TRACKING_WEBHOOK_URL` is required to boot but has no receiver.** Production
  refuses to start without it (`environment.ts:41-48`), yet like the OTP webhook the
  destination is an operator-provided service that does not exist yet. You must stand up
  *something* at that URL just to boot. (§5.1 of `AUDIT_FULL.md`.)

- **Legal & store documents are wrong on both brand and product.** `docs/privacy-policy.md`,
  `docs/terms-of-service.md`, and `docs/store-listing.md` still say **"TasawaQ"**
  (`store-listing.md:7-8,13`, `terms-of-service.md:1,5`, `privacy-policy.md:1,5`) **and
  describe a restaurant/food business** — e.g. the store short description reads
  "اطلب وجبتك، تابع تجهيزها" ("order your meal, track its preparation",
  `store-listing.md:8`) and the privacy policy describes order data as "المطعم والأصناف"
  ("the restaurant and the items", `privacy-policy.md:10`). The app is launching as
  **JOVO MARKET, supermarket-only**, with restaurants gated off
  (`RESTAURANT_ORDERING_ENABLED=false`, `.env.production.example:13`). A policy that names
  the wrong operator and the wrong vertical is a store-review rejection and a legal
  exposure. *(The admin console branding was already fixed — see "Already verified ready".)*

- **Backups are scripted and documented but not scheduled, and no restore has ever been
  verified.** `scripts/backup-database.mjs` is a solid `pg_dump` custom-format backup with
  SHA-256 sidecars and retention pruning, and `docs/operations-runbook.md:46-68` tells the
  operator to schedule it daily and run a quarterly restore drill — but **nothing in the
  repo actually schedules it** (no crontab, systemd timer, or scheduled Action anywhere),
  and the launch-checklist box "Daily off-host backup job succeeded and an isolated restore
  drill was signed off" is **unchecked** (`docs/launch-checklist.md:17`). For a cash-on-
  delivery ledger this is the highest-consequence operational gap: it is the only record of
  who owes whom. *What's needed:* one host cron entry + one actual restore drill into a
  throwaway DB.

- **Rotate every secret and start from a clean database.** Operational, and cannot be
  verified from the repo, but must not be skipped: the seed hardcodes the admin password
  `Test@12345` (`apps/api/prisma/seed.ts:24`), so the dev database must not be carried into
  production. The seed itself is correctly blocked in production (`seed.ts:10-12`), and
  `validateEnvironment` will reject reused/placeholder/short secrets at boot (verified —
  see below), so a mistake here fails loudly rather than silently.

---

## Should-fix-soon (won't block launch but will hurt fast)

- **CI's own final gate is red.** The last CI step is
  `npm audit --omit=dev --workspace @wasel/api --audit-level=high` (`.github/workflows/ci.yml:60`).
  I ran that exact command: **exit code 1, 3 high-severity advisories** (`deepmerge-ts@7.1.5`
  stack-exhaustion, GHSA-ggr8-5vv4-36mx, pulled through `prisma@7.9.1 → @prisma/config`).
  Because `prisma` is a *devDependency* and the runtime image runs `npm prune --omit=dev`
  (`Dockerfile:20`), the vulnerable package is **not in the deployed artifact** — so nothing
  vulnerable ships — but the release gate the team defined ("API production audit",
  `docs/launch-checklist.md:8`) does **not currently pass**. Resolve by bumping Prisma to a
  patched line or pinning `deepmerge-ts`; do not blindly `npm audit fix --force` (it proposes
  a Prisma *downgrade* to 6.12.0).

- **CI does not run on the branch being deployed.** `on.push.branches` is
  `[main, agent/customer-phone-auth]` (`ci.yml:5`); the deploy branch is
  `agent/phase-15-and-jovo-brand`. A direct push here triggers no pipeline (a PR still would,
  though it would fail at the audit gate above). Add the deploy branch to the trigger list.

- **Push notifications are stored but never sent.** `PushToken` rows are registered/unregistered
  (`apps/api/src/users/users.service.ts:88-100`) and `createNotification` only writes a DB row
  and emits an in-app socket event (`apps/api/src/notifications/notification.util.ts:25-49`).
  **No code anywhere reads a push token to send a device push.** Until an Expo/APNs/FCM sender is
  added, the store must keep the admin dashboard open with sound on, and drivers must poll.
  Fine for one supermarket with a dedicated tablet; the first thing that hurts as volume grows.

- **Integrity-check and subscription jobs exist but nothing runs them.** `npm run check:financial`
  (`scripts/check-financial-integrity.mjs`) and the monthly subscription endpoint are both real
  and safe to re-run, but there is no scheduler in the project. Add the integrity check to the
  same cron as the backup.

- **No uptime monitor.** `/api/v1/health/live` and `/health/ready` exist and are correct
  (wired into the Dockerfile `HEALTHCHECK`, `Dockerfile:34-35`), but nothing external polls them.
  A free HTTP monitor closes this in ten minutes.

- **`TRUST_PROXY=1` assumes exactly one proxy hop (nginx only).** Correct for the current compose
  topology (`docker-compose.production.yml`), but if a CDN/Cloudflare is placed in front, bump it
  to 2 or client IPs (and rate limiting) will be wrong.

- **Cosmetic internal drift (`tasawaq`/`wasel`).** Backup filenames (`backup-database.mjs:16`),
  Swagger title (`main.ts:69`, dev-only), metrics/log identifiers, mobile storage keys
  (`wasel_access_token`, etc.), and the npm package names (`@wasel/*`) still use the old names.
  All internal, none user-facing, none a blocker — worth a cleanup pass eventually.

---

## Already verified ready

- **Environment validation fails closed — verified by execution.** I called
  `validateEnvironment` directly with a full production config and 10 mutations. It accepted the
  valid config and threw on: placeholder secret, missing secret, reused secret, dev OTP provider,
  wildcard CORS, non-HTTPS CORS, missing error-tracking URL, short monitoring token, dev-password
  in `DATABASE_URL`, and missing `DATABASE_URL`. Every failure fired.
- **Every prod-required env var is documented.** `.env.production.example` documents all vars the
  validator/compose require (DB, three secrets, CORS, OTP webhook trio, error-tracking pair,
  monitoring token, TZ, TLS paths, `EXPO_PUBLIC_API_URL`), including `RESTAURANT_ORDERING_ENABLED`
  (`.env.production.example:13`) which the prior audit flagged as undocumented — now fixed.
  (`PUBLIC_APP_URL` is listed but unused in code/compose — harmless.)
- **No committed secrets.** `.env`/`.env.*` are gitignored with explicit `.example` exceptions
  (`.gitignore`); `git ls-files` shows only the two example files; a regex scan of tracked
  non-example/non-test files for hardcoded secret assignments found nothing.
- **Timezone is set** in both the Dockerfile (`ENV TZ=Asia/Hebron`, `Dockerfile:27`) and the
  production compose (`TZ: ${TZ:-Asia/Hebron}`, `docker-compose.production.yml:22`). This closes the
  prior audit's MUST #5; store opening/closing hours are evaluated against wall-clock local time.
- **Seed is blocked in production** (`apps/api/prisma/seed.ts:10-12`).
- **Migrations are ordered and valid.** `npm run prisma:validate` → "schema is valid"; 24 migrations
  with monotonic timestamps (the prior ordering bug is fixed). Fresh-DB `prisma migrate deploy` runs
  in CI against `postgres:17` (`ci.yml:53`); I could not re-run it locally (no Docker daemon here).
- **Container topology is hardened.** Non-root (`USER node`), `read_only: true`, `cap_drop: ALL`,
  `no-new-privileges`, tmpfs `/tmp`, `restart: unless-stopped`, migration one-shot gated before API
  (`depends_on: service_completed_successfully`), web gated on API `service_healthy`, DB external,
  only the web edge publishes 80/443, TLS mounted read-only
  (`docker-compose.production.yml:12-57`).
- **HTTPS enforced on every surface.** API request middleware honours `REQUIRE_HTTPS`
  (`main.ts:43-49`); nginx does a 308 HTTP→HTTPS redirect + HSTS + strict CSP + TLS 1.2/1.3
  (`deploy/nginx/default.conf:13-34`); mobile production builds throw without an HTTPS
  `EXPO_PUBLIC_API_URL` (`apps/mobile/src/core/api.ts:360-361`); Android cleartext + backup disabled
  (`apps/mobile/app.json:26-27`).
- **Swagger is absent in production** (`main.ts:67`).
- **Rate limiting / CORS / trust-proxy are consistent** with the single-nginx-hop topology and are
  validated at boot (explicit HTTPS origins only in prod).
- **Typecheck + unit tests are green on this branch.** `npm run typecheck` (all three workspaces)
  exit 0; `npm test -w @wasel/api` → **348 pass, 0 fail, 3 skipped (opt-in DB e2e), 351 total.**
- **Prior audit's money bug is closed in code.** `MenuService` refuses a supermarket product with no
  cost price and `calculateOrderQuote` refuses to *sell* one (fail-closed); the fulfillment-adjustment
  cost snapshot is fixed (migration `20260827000000_fulfillment_adjustment_cost_snapshot`); admin
  overview warns on `costDataComplete=false`. All from commit `05d495e`, covered by
  `apps/api/src/accounting/goods-cost.test.ts`.

---

## Checklist status vs. prior audit (`AUDIT_FULL.md` §8)

*Note: `AUDIT_FULL.md` was committed in the same commit (`05d495e`) that fixed several of its own
findings, so its MUST/SHOULD prose is partly stale relative to the code. Statuses below re-verify
against the current tree, not the document's claims.*

| # | Item | Status | Evidence |
|---|------|--------|----------|
| MUST 1 | Cost prices / close the supermarket margin bug | **Done (code) / operational (data)** | Fail-closed guards in `MenuService` + `calculateOrderQuote`; `goods-cost.test.ts`; commit `05d495e`. Entering costs for the live catalogue remains an operational step at data-load. |
| MUST 2 | Start from a clean database | **Not done (operational, unverifiable)** | Seed blocked in prod (`seed.ts:10-12`); dev seed hardcodes `Test@12345` (`seed.ts:24`). Must provision fresh DB. |
| MUST 3 | Stand up SMS/OTP delivery | **Not done — BLOCKER** | Adapter real & required (`environment.ts:33-39`, `otp.provider.ts:31-64`); no receiver/gateway in repo. |
| MUST 4 | Permanent hosting + HTTPS + managed Postgres | **Not done (operational)** | DB excluded from compose by design; mobile bundles the API URL (`api.ts:352-362`). |
| MUST 5 | Set the timezone | **Done** | `Dockerfile:27`, `docker-compose.production.yml:22`. |
| MUST 6 | Schedule backups + verify one restore | **Not done (operational)** | Script good (`backup-database.mjs`); runbook says schedule it (`operations-runbook.md:46-68`); no scheduler in repo; drill unchecked (`launch-checklist.md:17`). |
| MUST 7 | Rotate secrets + configure prod env | **Not done (operational; enforced at boot)** | `validateEnvironment` rejects placeholders/reuse/short (verified by execution). |
| MUST 8 | Update legal docs + admin brandTitle | **Partially done** | Admin brand fixed → "JOVO Ops" (`apps/admin/src/i18n/locales/en.json:59`, `ar.json:59`). Legal/store docs still "TasawaQ" + restaurant vertical (`store-listing.md:7-8`, `privacy-policy.md:1,5,10`, `terms-of-service.md:1`). |
| SHOULD 9 | Ship push notifications | **Not done** | Tokens stored only; no sender (`notification.util.ts:25-49`, `users.service.ts:88-100`). |
| SHOULD 10 | Fix fulfillment-adjustment cost snapshot | **Done** | Migration `20260827000000_...`; commit `05d495e`. |
| SHOULD 11 | Build financial adjustment UI | **Not done** | No admin adjustment UI in recent commits; corrections still require raw API calls. |
| SHOULD 12 | Add integrity-check job | **Partially done** | Script exists (`scripts/check-financial-integrity.mjs`, `npm run check:financial`); nothing schedules it. |
| SHOULD 13 | Cap OTP sends per phone/day + globally | **Done** | `environment.ts` defaults + enforcement `auth.service.ts:432-441` (`OTP_DAILY_LIMIT_REACHED`). |
| SHOULD 14 | Error monitoring + uptime check | **Not done (operational)** | Error webhook required to boot but no receiver; nothing polls health endpoints. |
| SHOULD 15 | Admin tokens → sessionStorage | **Done** | `apps/admin/src/api.ts:181,189,190`. |
| SHOULD 16 | Accounting controllers in route-permissions test | **Done** | `route-permissions.test.ts` (+41 in `05d495e`). |
| SHOULD 17 | Solve catalogue entry | **Not done (product/operational)** | One-product-at-a-time form; no bulk import / image hosting. |

---

## Assumptions made

- **Hosting topology is a single nginx reverse proxy in front of the API** (as the production compose
  file describes), so `TRUST_PROXY=1` and the nginx rate-limit config are correct. If a CDN/Cloudflare
  is added, `TRUST_PROXY` must increase and this should be re-checked.
- **The launch vertical is JOVO MARKET (supermarket only)**, restaurants gated off
  (`RESTAURANT_ORDERING_ENABLED=false`). The legal/store finding is scored against that; if restaurants
  launch too, the docs need both verticals.
- **Fresh-DB migration apply and the DB-backed e2e suite are trusted from CI, not re-run locally** — no
  Docker daemon is available in this audit environment. CI runs `prisma migrate deploy` + `test:e2e`
  against `postgres:17` (`ci.yml:53,59`); schema validity and migration ordering were verified locally.
- **"Operational, cannot verify" items** (clean DB, secret rotation, hosting, backup scheduling, restore
  drill, external monitoring receivers) are judged against repo readiness and documentation, since they
  cannot be confirmed done without touching production — which this audit does not do.
- **Node 24 locally vs. Node 22 in CI/Docker** — I ran typecheck/tests on the local Node 24; CI and the
  runtime image pin Node 22 (`Dockerfile`, `ci.yml:49`). No version-specific failures observed.

# JOVO on Railway

JOVO's API also runs on Railway, in the Railway project **jovo**, next to the Azure trial (which is
unchanged and keeps deploying from GitHub). This page records exactly what exists there and how
to operate it. It contains no secret values: those live only in Railway variables.

Set up on 2026-10-26 from branch `agent/phase-15-and-jovo-brand` at commit `4456ce1`.

## What runs where

| | Azure trial (unchanged) | Railway (`jovo` project, `production` environment) |
|---|---|---|
| API | App Service `jovo-market-api` | service **api**, 1 replica |
| Database | Flexible Server `jovo-market-db-shamasneh` | service **Postgres** (PostgreSQL 18.6, 5 GB volume `postgres-volume`) |
| Public URL | `*.azurewebsites.net` | https://api-production-7ac7.up.railway.app and **https://api.jovops.com** (after DNS) |
| Deploys | GitHub Actions on every push to this branch | **only** `railway up` from a workstation (Railway is not connected to GitHub) |
| Data | trial data | a clean database: schema only, no seed, no users |

The push-notification worker runs inside the API process (`PUSH_WORKER_ENABLED`, on by default),
so there is no separate worker service. Keep the API at **one replica**: two replicas would run
two push workers against the same queue.

### Railway resources

| Resource | Name | ID |
|---|---|---|
| Project | jovo | `0156eafa-a6d9-4c11-b780-0e75ffae87db` |
| Environment | production | `63a25f97-26b6-4a56-8eb4-940b8ac8fbb1` |
| Service | Postgres (template image `ghcr.io/railwayapp-templates/postgres-ssl:18`) | `580900c3-2d26-442b-bbff-e77969e2f913` |
| Volume | postgres-volume, mounted at `/var/lib/postgresql/data` | `204efa04-0648-412a-ad7a-0092d6f33345` |
| TCP proxy | none. The old public proxy (`fc1559ef-…`) was deleted on 2026-10-27, so Postgres is private-network only | — |
| Service | api (empty service, deployed with `railway up`) | `323885ea-08a0-4c9d-a56f-394e052e62be` |
| Service | backup (cron `0 1 * * *` UTC, restart policy never, deployed with `railway up`) | `c868533d-a775-48b7-bea1-a33d7478f1fd` |
| Domain | `api-production-7ac7.up.railway.app` → port 3000 | generated |
| Custom domain | `api.jovops.com` → port 3000 | `b5710c26-a512-41ac-9bbc-dfb6587a9e79` |

No bucket has been created yet (see [Image storage](#image-storage)).

## The api service

### Build and deploy settings

Set on the service itself through Railway's API (`serviceInstanceUpdate`), not through a
`railway.json`: Railway's config-as-code files are deprecated and stop working on 2026-12-01.

| Setting | Value |
|---|---|
| Dockerfile | `deploy/railway/Dockerfile` (also `RAILWAY_DOCKERFILE_PATH`) |
| Pre-deploy command | `npx --no-install prisma migrate deploy` |
| Health check | `/api/v1/health/ready`, 120 s timeout |
| Restart policy | on failure, up to 5 retries |
| Serverless sleep | off |
| Start command | none: the image's `node dist/main.js` |

`deploy/railway/Dockerfile` mirrors the root `Dockerfile`'s `runtime` stage (Railway cannot
build a `--target`), plus the Prisma schema, migrations and config. **Migrations run once per
deploy, as the pre-deploy step, before traffic moves to the new container**; they never run when a
container starts or restarts. A failing migration stops the deploy, and the previous deployment
keeps serving. If you change a shared stage in the root `Dockerfile`, make the same change in
`deploy/railway/Dockerfile`.

### Variables

Mode: the same non-production mode as the Azure trial (`NODE_ENV=development`, see
`TRIAL_DEPLOY_CHECK.md`), until a real SMS provider exists.

| Variable | Value |
|---|---|
| `NODE_ENV` | `development` |
| `DEPLOYMENT_ENV` | `trial` (marks it as deployed: the dev-OTP provider logs a warning at boot) |
| `OTP_PROVIDER` | `development`: codes go to the log only (needed for signup/reset, not for login) |
| `DATABASE_URL` | reference `${{Postgres.DATABASE_URL}}` (private network) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `OTP_HASH_SECRET`, `MONITORING_TOKEN` | 48 random bytes each (base64url), generated with Node `crypto.randomBytes` and piped straight into Railway; never displayed |
| `PORT` | `3000` |
| `TRUST_PROXY` | `1`: Railway's edge proxy is the only hop, which holds while the Cloudflare record stays **DNS only** |
| `CORS_ORIGIN` | `https://jovo-admin.vercel.app,https://h-admin-gray.vercel.app` |
| `ROUTING_ENABLED` | `false` (no OSRM) |
| `LOG_LEVEL` | `log` |
| `RAILWAY_DOCKERFILE_PATH` | `deploy/railway/Dockerfile` |
| `GIT_SHA` | the commit being deployed; reported by `/health` as `commit` |

Left at their defaults, and closed on purpose until there is a reason to open them:

- `PUBLIC_RESTAURANT_REGISTRATION_ENABLED` (default `false` on any deployed environment):
  `POST /api/v1/restaurants/register` answers `403 RESTAURANT_REGISTRATION_CLOSED`. Self-registration
  creates an owner account marked phone-verified without sending any code, so it stays closed at
  least until TweetSMS works. Stores are created by a Super Admin from the dashboard meanwhile.
- `SWAGGER_ENABLED` (default `false` on any deployed environment, refused with `NODE_ENV=production`):
  `/api/docs` is not served.

"Deployed" is `DEPLOYMENT_ENV=trial|production`, Azure App Service's own variables, or
`NODE_ENV=production` (`isDeployedEnvironment`, config/environment.ts). Both flags are open by default
only on a developer machine. **The Azure trial counts as deployed too**: after its next deploy from
GitHub it also closes both, unless the two variables are set to `true` in its App Service settings.

Also left at their defaults: `RESTAURANT_ORDERING_ENABLED=false`, `REQUIRE_HTTPS=false` (Railway already
redirects HTTP to HTTPS), the rate-limit, pool, OTP, push and delivery-fee settings.

**Not set yet:**

- `OTP_PROVIDER=tweetsms` with `TWEETSMS_API_KEY`, `TWEETSMS_SENDER`: waiting for the TweetSMS
  account (`docs/tweetsms-otp-readiness.md`). Then also set `OTP_REQUIRE_REAL_PROVIDER=true`.
- Image storage: `IMAGE_STORAGE_DRIVER=s3` plus the `S3_*` variables, or the `AZURE_STORAGE_*`
  ones. Until then image uploads answer `503 IMAGE_STORAGE_UNAVAILABLE`; external image URLs
  still work.
- `ERROR_TRACKING_WEBHOOK_URL` / `ERROR_TRACKING_TOKEN` or `APPLICATIONINSIGHTS_CONNECTION_STRING`:
  optional now, required for `NODE_ENV=production`.
- Any further `CORS_ORIGIN` origins (for example a future `https://admin.jovops.com`).

To read variables without printing secrets:

```bash
railway variable list --service api --json | node -e "const v=JSON.parse(require('fs').readFileSync(0));for(const k of Object.keys(v).sort())console.log(k,/SECRET|TOKEN|DATABASE_URL|PASSWORD|KEY/.test(k)?'<hidden>':v[k])"
```

To set a secret without it reaching your shell history or the terminal:

```bash
node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64url'))" \
  | railway variable set NAME --stdin --service api --skip-deploys >/dev/null
```

### Login protection

`POST /api/v1/auth/login` is throttled per IP (10 a minute), and per account by
`auth/login-attempt-limiter.ts`:

- the same phone from the same IP: 5 free failures, then that IP waits 1 s, 2 s, 4 s... up to
  15 minutes before it may try that phone again (`429 LOGIN_TEMPORARILY_BLOCKED`, `retryAfterSeconds`);
- the same phone from many IPs: after 10 failures every attempt is answered more slowly (up to 4 s),
  but still answered, so the real owner, on their own connection, is never locked out.

Counters forget a phone 15 minutes after its last failure and reset on a successful login. They live
in the API's memory, which is correct for the single replica this service runs.

## Redeploy

From the repository root, on a clean checkout of the commit you mean to ship:

```bash
railway status                       # must say Project: jovo
railway variable set "GIT_SHA=$(git rev-parse HEAD)" --service api --skip-deploys
railway up --service api --ci        # uploads this folder, builds, runs migrations, deploys
curl -fsS https://api.jovops.com/api/v1/health/ready   # "commit" must equal git rev-parse HEAD
```

`railway up` uploads the working tree as it is on disk, uncommitted changes included, minus
`.railwayignore` (which excludes `.env*`, `backups/`, `secrets/`, `node_modules`, the product
images and everything of `apps/admin` and `apps/mobile` except their `package.json`). A build takes
about 10 minutes, most of it `npm ci` and pushing the image.

Roll back: `railway deployment list --service api`, then redeploy an earlier deployment from the
dashboard (Hobby keeps old images for 72 hours). A rollback does not undo migrations, so restore
the database from a backup if a migration has to be reversed.

Pushing to GitHub does **not** deploy Railway. It does deploy the Azure trial
(`.github/workflows/deploy-trial-api.yml`).

## Custom domain: api.jovops.com

Add these two records in Cloudflare (zone `jovops.com`), both with proxy status **DNS only**
(grey cloud):

| Type | Name | Content |
|---|---|---|
| CNAME | `api` | `whk39fbr.up.railway.app` |
| TXT | `_railway-verify.api` | `railway-verify=4b65e618438c0116d0636ab63303e3f89292ce3c811d9756735a0f16a846dd57` |

Railway then issues the certificate itself. Check progress with
`railway domain status api.jovops.com --service api`.

Keep it DNS only. If you later switch on the Cloudflare proxy (orange cloud), set Cloudflare SSL to
**Full (strict)** and `TRUST_PROXY=2`, because there are then two proxies in front of the API.

Client settings for this backend (both apps add `/api/v1` themselves):

- admin (Vercel): `VITE_API_URL=https://api.jovops.com`
- mobile (EAS / `apps/mobile/.env.production`): `EXPO_PUBLIC_API_URL=https://api.jovops.com`

The mobile URL is compiled into the bundle, so it takes a new build. `apps/mobile/.env.production`
still points at an ngrok address today.

## Image storage

The API picks its image store with `IMAGE_STORAGE_DRIVER`:

- `azure` (default): Azure Blob, unchanged; what the Azure trial uses.
- `s3`: any S3-compatible store (`apps/api/src/uploads/s3-image-storage.service.ts`). A private
  upload bucket (`S3_UPLOAD_BUCKET`) receives presigned PUTs; `complete` checks type, size and
  magic bytes, then copies the object into the public bucket (`S3_PUBLIC_BUCKET`), whose objects
  must be reachable at the permanent, unsigned `S3_PUBLIC_BASE_URL`. Settings: `.env.example`.

Railway Buckets **cannot** serve objects publicly ("Public buckets are currently not supported"),
and the app refuses signed or expiring image URLs. Choosing how images are served is still open:

| Option | How images are served | Cost (≈31 MB today) | Code needed | Trade-offs |
|---|---|---|---|---|
| **A. Cloudflare R2** public bucket on `images.jovops.com` | Cloudflare CDN, permanent URLs | free tier (10 GB, no egress fees) | none: `IMAGE_STORAGE_DRIVER=s3` | outside Railway; the zone is already on Cloudflare |
| B. Railway Bucket + API redirect | `https://api.jovops.com/api/v1/images/<name>` answers 302 to a short-lived presigned GET | $0.015/GB-month; bucket egress free | a small public route plus tests | two requests per image; the stored URL is permanent, the presigned one never stored |
| C. Railway Bucket + API stream | the API reads the object and streams it | as B, plus service egress $0.05/GB and API CPU/RAM | a small public route plus tests | simplest for clients; every image byte passes through the single API replica |
| D. Railway volume | a service serves files from its disk | $0.15/GB-month | a file route | one service per volume, 5 GB cap on Hobby, no backups on Hobby, blocks replicas; not recommended |

Whichever is picked, the S3 driver stays provider-neutral, so moving between R2 and a Railway
Bucket later is a variables change plus copying the objects.

### Bulk-loading the existing pictures

`npm run upload:catalogue-images --workspace @wasel/api -- ...` (`apps/api/prisma/upload-catalogue-images.ts`)
uploads the local pictures named in a mapping CSV (`sku,image_path,...`) straight into the public
bucket under content-addressed names, and writes a copy of the product CSV with `imageUrl` filled
in. It defaults to a dry run and needs the store's id, so: create the supermarket, dry-run, re-run
with `--upload`, then `npm run import:products -- --restaurant-id <id> --file <output.csv>`.
Today `products/products_image_mapping.csv` maps 130 of the 4,236 files in `products/product_images`.

## Backups

**Railway's own backups are not available on this plan.** Railway's API answers *"Manual backups
and backup schedules are only available for Pro workspaces"*. Even on Pro they are kept with the
volume and can only be restored into the same project, and Railway Buckets have no backups at
all. So JOVO's backups are its own, and live outside Railway and outside any laptop.

### Daily backup: the `backup` cron service

Code: `deploy/railway/backup/` (its own image and lockfile, not part of the npm workspaces).

1. It runs once a day on a Railway cron schedule (UTC), inside project jovo, and exits.
2. It connects over Railway's **private network** to `${{Postgres.RAILWAY_PRIVATE_DOMAIN}}` as the
   role `jovo_backup`. That role is read-only (`pg_read_all_data`, `default_transaction_read_only`,
   no write grants, not a superuser, at most 3 connections).
3. It counts every table's rows and dumps the database from **the same snapshot** (`pg_dump
   --snapshot`), so the counts describe exactly what is in the dump.
4. Dump and manifest (counts, size, SHA-256, versions) are both encrypted with the **age public
   key** in `BACKUP_AGE_RECIPIENTS`. The private key stays with the owner, offline. Neither Railway
   nor the bucket can read a backup.
5. Both files are uploaded under new names, `jovo/YYYY/MM/jovo-<timestamp>.dump.age` and
   `.manifest.json.age`, to an **external** S3-compatible bucket. The key used can only write to that
   one bucket.
6. healthchecks.io is pinged at start, on success (with a short summary) and on failure (with
   the reason, credentials redacted). A missed day alerts by email.

Retention is **30 days**, enforced by the bucket's own lifecycle rule. The backup key cannot delete,
so a stolen key cannot wipe the history either.

Variables on the `backup` service:

| Variable | Value | Who sets it |
|---|---|---|
| `BACKUP_PGHOST` | `${{Postgres.RAILWAY_PRIVATE_DOMAIN}}` | set by script |
| `BACKUP_PGPORT` | `5432` | set by script |
| `BACKUP_PGDATABASE` | `${{Postgres.PGDATABASE}}` | set by script |
| `BACKUP_PGUSER` | `jovo_backup` | set by script |
| `BACKUP_PGPASSWORD` | random, set by `create-backup-role.mjs` straight into Railway | set by script, never shown |
| `BACKUP_AGE_RECIPIENTS` | the owner's age **public** key (`age1...`) | set from the owner's public key |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`, `BACKUP_S3_BUCKET` | the backup bucket | set from names the owner gives |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | the write-only key | **the owner, in the dashboard** |
| `BACKUP_HEALTHCHECK_URL` | the healthchecks.io ping URL | the owner, in the dashboard (the URL is a credential of sorts) |

Create or rotate the role (it prints nothing secret):

```bash
node deploy/railway/backup/create-backup-role.mjs
```

Deploy the job: `railway up deploy/railway/backup --path-as-root --service backup --ci`. Its
service settings are `dockerfilePath: Dockerfile`, `restartPolicyType: NEVER` and `cronSchedule:
"0 1 * * *"` (set with `serviceInstanceUpdate`). A deploy does not start a run while a schedule
is set. To run one now, use the dashboard's *Run now*, or
`railway api 'mutation { deploymentInstanceExecutionCreate(input: { serviceInstanceId: "<id>" }) }'`.

Live since 2026-10-27, with the bucket on **Backblaze B2** (`eu-central-003`, private, lifecycle
`jovo/` hide after 30 days and delete 1 day later) and the check `jovo-db-backup` on
healthchecks.io. Each run logs one summary line and whether each ping was delivered, never the
ping URL:

```
healthcheck start ping delivered
ok jovo/2026/10/jovo-2026-10-27T21-47-28-487Z.dump.age tables=41 rows=49 users=0 restaurants=0 orders=0 bytes=173476 seconds=7
healthcheck success ping delivered
```

The `users=` / `restaurants=` / `orders=` counts let you check the database's state from the logs
alone, now that it has no public endpoint. B2 shows a keyID (25 hex characters) and an
applicationKey (31 characters, starting with `K`). The keyID goes in `BACKUP_S3_ACCESS_KEY_ID`.

### Restore and restore test

Both run on the owner's machine, in the backup image, with a bucket key that can **read**
(not the backup service's write-only key) and the age identity file. Build once:
`docker build -t jovo-backup deploy/railway/backup`.

```bash
# Prove the newest backup restores: wipes and refills a scratch database, compares every table's count.
docker run --rm -v C:/path/to/age-keys:/keys:ro --env-file read-key.env \
  -e RESTORE_TEST_DATABASE_URL=postgresql://postgres:PASSWORD@host.docker.internal:5434/restore_scratch \
  jovo-backup node restore-test.mjs --identity=/keys/jovo-backup.agekey

# A real restore (destructive for the target, needs --confirm-restore=<db name>).
docker run --rm -v C:/path/to/age-keys:/keys:ro --env-file read-key.env \
  -e RESTORE_DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DB \
  jovo-backup node restore.mjs --identity=/keys/jovo-backup.agekey --confirm-restore=DB [--key=jovo/2026/10/...dump.age]
```

`read-key.env` holds `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID` and
`BACKUP_S3_SECRET_ACCESS_KEY` for a **read** key. Keep it next to the age identity, never in Git.
Run the restore test at least monthly, and after any schema-changing release.

Rehearsed locally on 2026-10-27 against throwaway services:
- **Backup:** ran as the read-only role (it can read; an insert or delete is refused even after it turns read-only off) and sent both pings.
- **Restore test:** passed for two different backups, with every count matching, and failed correctly on a tampered manifest (`Landmark: expected 37, restored 36`).
- **Failure path:** a wrong password produced a `/fail` ping that did not contain the password.

### The Postgres TCP proxy

**Closed on 2026-10-27**, after the cron service had completed a scheduled run over the private
network with both pings delivered. The API was healthy afterwards, and the old address
(`mainline.proxy.rlwy.net:30633`) no longer reaches PostgreSQL.

To rotate the backup role's password, or for any other admin task from outside Railway, open a
temporary proxy and close it again afterwards:
`railway tcp-proxy create --service Postgres --port 5432`, then
`node deploy/railway/backup/create-backup-role.mjs`, then
`railway tcp-proxy delete <id> --service Postgres --yes`.

`scripts/offsite-backup.mjs` (a laptop-run dump) stays in the repository as a manual fallback. It
also needs a temporary proxy.

## Cost

Railway Hobby: $5/month, which includes $5 of usage. Measured idle footprint: API ≈195 MB RAM,
Postgres ≈42 MB, CPU near zero. That comes to about **$3/month** of usage (RAM $10/GB-month,
CPU $20/vCPU-month, volume $0.15/GB-month, egress $0.05/GB), inside the included $5. Usage above
$5 is billed on top. Check it in the dashboard (Workspace → Usage).

## Switching to NODE_ENV=production

When TweetSMS works and image storage is configured:

1. Set `OTP_PROVIDER=tweetsms`, `TWEETSMS_API_KEY`, `TWEETSMS_SENDER`, `OTP_REQUIRE_REAL_PROVIDER=true`.
2. Set the image storage variables for the chosen driver.
3. Set `ERROR_TRACKING_WEBHOOK_URL` + `ERROR_TRACKING_TOKEN` (or App Insights).
4. Make sure `CORS_ORIGIN` lists only exact HTTPS origins.
5. Set `NODE_ENV=production` and `DEPLOYMENT_ENV=production` last. `REQUIRE_HTTPS` and HSTS then
   turn on by default. The API refuses to boot if anything above is missing, and the previous
   deployment keeps serving.

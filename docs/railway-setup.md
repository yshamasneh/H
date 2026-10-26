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
| TCP proxy | Postgres, `mainline.proxy.rlwy.net:30633` → 5432 (for off-site backups) | `fc1559ef-c777-4a0d-8f7f-eb2204bf1fa6` |
| Service | api (empty service, deployed with `railway up`) | `323885ea-08a0-4c9d-a56f-394e052e62be` |
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

Left at their defaults: `RESTAURANT_ORDERING_ENABLED=false`, `REQUIRE_HTTPS=false` (Railway already
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
all. So the off-site backup below is the only backup.

`scripts/offsite-backup.mjs` (daily):

1. dumps the database through the Postgres TCP proxy with `pg_dump` (custom format, SHA-256
   sidecar, `BACKUP_RETENTION_DAYS` pruning, default 14) into `<BACKUP_DIRECTORY>/database`;
2. re-reads the new archive with `pg_restore --list`;
3. if `BACKUP_S3_*` is set, mirrors the public image bucket into `<BACKUP_DIRECTORY>/images`
   (new and changed objects only; nothing local is ever deleted).

`pg_dump` must be version 18 or newer. Without a local install, set `PG_DOCKER_IMAGE=postgres:18`
and the tools run in a throwaway container (Docker Desktop must be running).

The URL is assembled from the Postgres service's variables:
`postgresql://PGUSER:PGPASSWORD@RAILWAY_TCP_PROXY_DOMAIN:RAILWAY_TCP_PROXY_PORT/PGDATABASE?sslmode=require`.
Keep it in a file only you can read, outside the repository, never in Git.

Example daily task on this Windows PC (Task Scheduler, 03:00, run whether logged on or not), with
`C:\JovoBackups\backup.env` holding `BACKUP_DATABASE_URL=...`, `BACKUP_DIRECTORY=D:\JovoBackups`,
`PG_DOCKER_IMAGE=postgres:18` and, once a bucket exists, the `BACKUP_S3_*` values:

```powershell
$action = New-ScheduledTaskAction -Execute "node.exe" `
  -Argument "--env-file=C:\JovoBackups\backup.env C:\Users\hp\H\scripts\offsite-backup.mjs" `
  -WorkingDirectory "C:\Users\hp\H"
Register-ScheduledTask -TaskName "JOVO off-site backup" -Action $action `
  -Trigger (New-ScheduledTaskTrigger -Daily -At 3am)
```

Copy `BACKUP_DIRECTORY` somewhere that is not this PC (an external disk, or an encrypted copy in
cloud storage): the dumps contain customers' phone numbers and addresses.

### Restore (tested 2026-10-26)

```bash
RESTORE_DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/TARGET_DB PG_DOCKER_IMAGE=postgres:18 \
  node scripts/restore-database.mjs --file=D:/JovoBackups/database/tasawaq-<timestamp>.dump --confirm-restore=TARGET_DB
```

The restore refuses to run unless `--confirm-restore` names the target database. It only reads
`RESTORE_DATABASE_URL`, never `DATABASE_URL`. Tested by dumping the Railway database through the
TCP proxy and restoring into a scratch `postgres:18` container: all 40 migrations, 41 tables, the
`pg_trgm` extension, `jovo_normalize_arabic_text` and the 9 immutability triggers came back,
`prisma migrate status` reported the schema up to date, and the API image started against the
copy with `/health/ready` reporting `database: connected`.

To restore Railway itself: restore into a new database first, check it, then point
`DATABASE_URL` at it or restore into the Railway database during a maintenance window.

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

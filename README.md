# TasawaQ

TasawaQ is a React Native food-delivery app with a NestJS API, PostgreSQL, and Prisma. Customer authentication uses a verified `+970` or `+972` phone number and password. Customers can browse approved, open restaurants and their menus. The Android app is an Expo development build; Expo Go is not required.

## Stack

- Expo SDK 54, React Native 0.81.5, and React 19
- Native Android development build with the existing TasawaQ splash and logo
- NestJS 11 and TypeScript
- An in-app React Native administration dashboard routed automatically for `ADMIN` accounts
- Socket.IO realtime layer (order/delivery status changes, admin dashboard live updates, in-app notifications)
- PostgreSQL 17 in Docker Compose with a persistent named volume
- Prisma 7
- Argon2id password hashing, HMAC-protected OTPs, HTTPS production OTP delivery, JWT access tokens, and rotating refresh sessions

## Prerequisites

- Node.js 22 or newer and npm
- Docker Desktop with the Compose plugin
- Android Studio, Android SDK, and an Android emulator (only for native Android development)

## Run the complete project on the web

After the one-time `npm install` and `.env` setup described below, this is the only command needed:

```powershell
npm.cmd run web
```

The command starts PostgreSQL in Docker, waits for it to become healthy, generates Prisma Client, applies migrations, loads idempotent demo data, and then starts the API and shared role-aware application:

- Cross-platform customer, restaurant, driver, and admin app: `http://localhost:8081`
- API and Swagger documentation: `http://localhost:3000/api/docs`

Press `Ctrl+C` once to stop the application services. The PostgreSQL container and its persistent data remain available for the next run.

## Install and configure

```powershell
npm install
Copy-Item .env.example .env
```

Set private development values in `.env` for `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and `OTP_HASH_SECRET`. Use random values of at least 32 characters. Keep `.env` local; it is ignored by Git. The checked-in `.env.example` contains placeholders only.

The default database URL is:

```text
postgresql://tasawaq:tasawaq_dev_password@localhost:5432/tasawaq?schema=public
```

## PostgreSQL and Prisma (manual commands)

Start PostgreSQL and check its health:

```powershell
npm run db:up
docker compose ps
```

Generate Prisma Client, apply the checked-in migration, and seed the local customer:

```powershell
npm run prisma:generate
npm run prisma:deploy
npm run prisma:seed
```

When intentionally changing `schema.prisma` during development, create a new migration with:

```powershell
npm run prisma:migrate
```

Validate the schema or inspect local data:

```powershell
npm run prisma:validate
npm run prisma:studio
```

You can also use PostgreSQL directly:

```powershell
docker compose exec db psql -U tasawaq -d tasawaq
```

Useful `psql` commands are `\dt` to list tables, `SELECT phone, role FROM "User";` to inspect safe user fields, and `\q` to quit.

Stop PostgreSQL without deleting its data:

```powershell
npm run db:down
```

The `tasawaq_postgres_data` named volume is retained by that command. Do not add `--volumes` unless you intentionally want to erase the local database.

## Run the NestJS API manually

PostgreSQL must be healthy and migrations must be applied first.

```powershell
npm run dev:api
```

The API is available at `http://localhost:3000/api/v1`, its health endpoint is `http://localhost:3000/api/v1/health`, and development Swagger documentation is at `http://localhost:3000/api/docs`.

### Development OTP

With `NODE_ENV=development` and `OTP_PROVIDER=development`, signup and password-reset codes appear only in the NestJS terminal:

```text
[DEV OTP] CUSTOMER_SIGNUP +970591234567 => 483921
[DEV OTP] PASSWORD_RESET +970591234567 => 746285
```

No SMS or WhatsApp message is sent in development. The code is never returned by the API, stored as plaintext, or logged by the mobile app. Production refuses this provider and uses the authenticated `OTP_PROVIDER=webhook` adapter documented in `.env.production.example`; the operator connects that HTTPS bridge to the approved WhatsApp Business or SMS vendor.

## Run the Android development build

Start an Android emulator in Android Studio, then run:

```powershell
$env:JAVA_HOME="$env:ProgramFiles\Android\Android Studio\jbr"
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
npm run android
```

This compiles and installs the native development build. It does not use Expo Go. In VS Code, the preserved equivalent is **Terminal > Run Task > Run TasawaQ on Android**.

For later JavaScript-only changes, keep the installed development build and start Metro with:

```powershell
npm run dev:mobile
```

The preserved VS Code task is **Start TasawaQ Metro**. In Android Studio, open `apps/mobile/android`, select an emulator, run the `app` configuration, and keep Metro running separately.

The Android emulator reaches the host API through `http://10.0.2.2:3000`. A physical device needs the computer's LAN address:

```powershell
$env:EXPO_PUBLIC_API_URL="http://YOUR_COMPUTER_LAN_IP:3000"
npm run dev:mobile
```

## Legacy admin web client

`apps/admin` is preserved temporarily as the previous Vite implementation for reference, but it is not started by the unified command. The supported administration interface now lives inside the shared Expo application at `http://localhost:8081`; signing in with an `ADMIN` account opens it automatically.

## Local development accounts

These accounts are for local development only:

```text
Full name: test
Phone: +970590000000
Password: Test@12345
Role: CUSTOMER

Full name: admin
Phone: +970590000001
Password: Test@12345
Role: ADMIN

Full name: Demo Restaurant Owner
Phone: +970590000002
Password: Test@12345
Role: RESTAURANT

Full name: Demo Driver
Phone: +970590000003
Password: Test@12345
Role: DRIVER (approved)
```

The seed hashes the password and uses an idempotent upsert. Running `npm run prisma:seed` repeatedly does not create duplicates and never sends an OTP.

## Customer authentication flows

Signup collects a full name, one of the two supported country codes, a local phone number, and matching strong passwords. The API normalizes the phone, rejects existing users, stores the pending password only as an Argon2id hash, and creates the customer only after a valid signup OTP. Successful verification logs the customer in and opens Customer Home.

Login normalizes the phone, checks an active verified PostgreSQL user, returns access and refresh tokens, and routes by the server-provided role. The customer home screen shows only the customer's name, normalized phone, role, and logout action.

Forgot Password creates a reset OTP only for an existing account. An unknown number receives `ACCOUNT_NOT_FOUND`, and the app offers Customer Sign Up with the phone prefilled. A valid reset OTP produces a short-lived, single-use reset token. Changing the password consumes that token and revokes existing refresh sessions.

## Restaurants and menus

A restaurant owner registers with `POST /api/v1/restaurants/register` (phone, password, restaurant name, and address); this creates a `RESTAURANT`-role account and a restaurant in `PENDING` status, no OTP required. The owner logs in with the same phone/password Login screen the app already has, then manages their profile and menu through the `/api/v1/restaurant/me/...` endpoints. A restaurant only appears to customers once an `ADMIN` approves it with `POST /api/v1/admin/restaurants/:id/approve`.

The shared Expo app routes customers, restaurant owners, drivers, and administrators to role-specific screens and runs from the same source on web, iOS, and Android. Restaurant profile and menu-write endpoints are currently available through the API; the restaurant-owner interface currently focuses on incoming-order management.

## Project structure

```text
apps/
  api/                         NestJS API, Prisma schema, migrations, and seed data
  admin/                       Preserved legacy Vite admin client (not started by the unified command)
  mobile/                      Shared Expo app for web, iOS, and Android
    src/core/                  API client, session storage, phone handling, realtime socket
    src/features/auth/         Shared authentication screens
    src/features/customer/     Restaurant catalog, cart, checkout, and customer orders
    src/features/restaurant/   Restaurant-owner order workflow
    src/features/driver/       Driver availability and delivery workflow
    src/features/admin/        In-app admin dashboard and management workflows
    src/features/shared/       Cross-role screens such as notifications
    src/navigation/            Typed role-aware navigation state
scripts/start-web.mjs          One-command local web orchestrator
scripts/backup-database.mjs    Custom-format PostgreSQL backup + SHA-256 + retention
scripts/restore-database.mjs   Verify/restore command with explicit destructive confirmation
docker-compose.yml             PostgreSQL development service and persistent volume
docker-compose.production.yml  TLS web/API production deployment (external PostgreSQL)
```

## Phase 8 production release

Phase 8 adds strict production environment validation, an HTTPS OTP bridge, structured/redacted logging, protected Prometheus metrics, error tracking, separate liveness/readiness probes, TLS reverse proxying, hardened non-root/read-only API containers, backup/restore tooling, CI/CodeQL/Dependabot, mobile release configuration, a 1024×1024 store icon, and the legal/store/operations package.

Create the real deployment file and replace every placeholder:

```powershell
Copy-Item .env.production.example .env.production
npm run release:check -- --env-file=.env.production
npm run prod:config
npm run prod:up
```

`DATABASE_URL` points to an external production PostgreSQL service; the production Compose file deliberately does not own or delete the database. The migration container completes before the API starts, and the web container terminates TLS and proxies REST/WebSocket traffic.

Operational and release material:

- `docs/security-review.md` — findings, controls, and accepted/external risks.
- `docs/operations-runbook.md` — deploy, monitoring, backup/restore, rollback, and incident procedures.
- `docs/launch-checklist.md` — technical, four-role, legal, closed-test, and go/no-go gates.
- `docs/privacy-policy.md` and `docs/terms-of-service.md` — Arabic operator-review drafts.
- `docs/store-listing.md` — Arabic/English metadata, privacy declarations, review-account guidance, and visual-asset inventory.

The code/configuration portion of Phase 8 is complete. Public launch still requires operator-owned DNS/TLS, selected provider endpoints, legal identity/sign-off, store accounts, release signing, screenshots from staging, and recorded Android closed-test/TestFlight approval; those cannot be manufactured safely from repository code.

## Checks

```powershell
npm test
npm run lint
npm run typecheck
npm run build
npm run prisma:validate
npx expo-doctor@latest apps/mobile
```

The API tests cover phone normalization, signup/OTP protections, duplicate and concurrent signup, login, forgot-password behavior, purpose isolation, single-use reset tokens, and old/new password behavior. Mobile tests cover authentication navigation and phone-prefill transitions.

`npm audit --omit=dev --workspace @wasel/api` reports no API production vulnerabilities. The repository-level audit currently reports advisories in Expo SDK 54's CLI/config dependency tree; npm's automatic remedy is a breaking upgrade to Expo 57. That upgrade was not forced because this project intentionally preserves its validated Expo 54/native Android configuration.

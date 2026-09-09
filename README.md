# TasawaQ

TasawaQ is a React Native restaurant and supermarket delivery app with a NestJS API, PostgreSQL, and Prisma. Customer authentication uses a verified `+970` or `+972` phone number and password. Customers can browse approved restaurants or supermarkets, search grocery catalogs, and place cash-on-delivery orders. The Android app is an Expo development build; Expo Go is not required.

## Stack

- Expo SDK 54, React Native 0.81.5, and React 19
- Native Android development build with the existing TasawaQ splash and logo
- NestJS 11 and TypeScript
- An in-app React Native administration dashboard routed automatically for `ADMIN` accounts
- Socket.IO realtime layer (order/delivery status changes, admin dashboard live updates, in-app notifications)
- PostgreSQL 17 in Docker Compose with a persistent named volume
- Prisma 7
- Admin-controlled product, order, delivery-percentage, and free-delivery offers
- Supermarket departments, product search/details, reviewed substitutions, variable-weight cash totals, and inventory procurement
- On-demand customer/store location capture with server-authoritative distance pricing and a 5 ILS default minimum
- Argon2id password hashing, HMAC-protected OTPs, HTTPS production OTP delivery, JWT access tokens, and rotating refresh sessions

## Phase 10 delivery pricing and offers

Only cash on delivery is supported. At checkout, the customer explicitly chooses their current location, receives a server-calculated quote, and sees the cash due before placing the order. The default delivery rule is 5.00 ILS for the first 3 km plus 1.50 ILS for each additional started kilometer, with a 25 km maximum; operators can change these values through the documented environment variables without a code deployment.

Administrators manage all promotions from the in-app **Offers** page. Product and whole-order offers compete for the best merchandise discount, while the best delivery offer can be combined with that winner. The server rechecks schedules, minimum subtotals, caps, restaurant/item scope, menu prices, and distance when the order is placed. Restaurants cannot create their own offers.

## Phase 11 online supermarket

Restaurants and supermarkets share the proven account, approval, cash-order, delivery-pricing, promotion, driver, and notification pipeline, while `BusinessType` keeps their public catalogs separate. Customers get a dedicated supermarket list, department filters, product/brand/SKU search, featured products, a product-detail page, selling-unit and stock visibility, and a per-line “allow similar replacement” preference.

Supermarket owners use the same store workspace to manage departments and products, including brand, SKU, selling unit, optional tracked stock, featured state, price, image, and availability. Order creation reserves tracked inventory atomically; a rejected or cancelled order restores it. A null stock value intentionally means inventory is not tracked, while zero-stock products are hidden and cannot be ordered.

## Phases 12 and 13 grocery operations

During fulfillment, a supermarket can propose a customer-authorized replacement or enter the actual packed quantity for a variable-weight line. The customer approves or rejects each proposal before the store can accept the order. Approval updates the server-owned subtotal and cash-on-delivery total; all original, replacement, and packed-quantity reservations are reconciled transactionally and recorded in the stock ledger.

The supermarket workspace now includes barcode/SKU lookup, low/out-of-stock counters, reasoned manual adjustments, an immutable movement history, suppliers, draft purchase orders, and purchase receiving. Receiving a purchase increases tracked stock and writes both movement and audit records. Restaurant accounts cannot use these supermarket-only endpoints.

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

## Mobile OTA updates (EAS Update)

`apps/mobile/app.json` has `updates.enabled: true` and a `runtimeVersion` policy of `appVersion`,
so a build only accepts an OTA update published against the same `version` string as the build
itself — bump `version` (and the native build numbers) for any change that isn't JS-only.

`apps/mobile/eas.json`'s `preview` and `production` build profiles each declare an EAS
`"environment"` (`preview` / `production`) instead of hardcoding `EXPO_PUBLIC_API_URL` in the
file — a hardcoded dev tunnel URL (e.g. an ngrok host) goes dead the moment that tunnel session
ends, silently bricking every APK built from it afterward. Configure the real value once per
environment before building:

```powershell
eas env:create --environment preview --name EXPO_PUBLIC_API_URL --value https://your-preview-api.example.com --visibility plaintext
eas env:create --environment production --name EXPO_PUBLIC_API_URL --value https://app.example.com --visibility plaintext
```

Without it, the build fails fast (`Production builds require an HTTPS EXPO_PUBLIC_API_URL`,
`apps/mobile/src/core/api.ts`) instead of shipping an app that can never reach the API.

Publish an OTA update after a JS-only change:

```powershell
eas update --branch preview --message "Describe the change"
eas update --branch production --message "Describe the change"
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

Full name: Demo Supermarket Owner
Phone: +970590000004
Password: Test@12345
Role: RESTAURANT / SUPERMARKET owner (approved)
```

The seed hashes the password and uses an idempotent upsert. Running `npm run prisma:seed` repeatedly does not create duplicates and never sends an OTP.

## Customer authentication flows

Signup collects a full name, one of the two supported country codes, a local phone number, and matching strong passwords. The API normalizes the phone, rejects existing users, stores the pending password only as an Argon2id hash, and creates the customer only after a valid signup OTP. Successful verification logs the customer in and opens Customer Home.

Login normalizes the phone, checks an active verified PostgreSQL user, returns access and refresh tokens, and routes by the server-provided role. The customer home screen shows only the customer's name, normalized phone, role, and logout action.

Forgot Password creates a reset OTP only for an existing account. An unknown number receives `ACCOUNT_NOT_FOUND`, and the app offers Customer Sign Up with the phone prefilled. A valid reset OTP produces a short-lived, single-use reset token. Changing the password consumes that token and revokes existing refresh sessions.

## Stores and catalogs

A store owner registers with `POST /api/v1/restaurants/register` (phone, password, name, address, and `RESTAURANT` or `SUPERMARKET` business type); this creates a `RESTAURANT`-role owner account and a store in `PENDING` status, no OTP required. The owner logs in with the same phone/password Login screen, then manages the profile and menu/catalog through `/api/v1/restaurant/me/...`. A store only appears to customers once an `ADMIN` approves it with `POST /api/v1/admin/restaurants/:id/approve`.

The shared Expo app routes customers, restaurant owners, drivers, and administrators to role-specific screens and runs from the same source on web, iOS, and Android. Restaurant and driver applications are available from Login. Restaurant owners can prepare their profile, opening status, categories, items, prices, images, and availability in the in-app Restaurant Workspace while approval is pending; incoming-order operations remain a separate focused screen.

## Project structure

```text
apps/
  api/                         NestJS API, Prisma schema, migrations, and seed data
  admin/                       Preserved legacy Vite admin client (not started by the unified command)
  mobile/                      Shared Expo app for web, iOS, and Android
    src/core/                  API client, session storage, phone handling, realtime socket
    src/features/auth/         Shared authentication screens
    src/features/customer/     Restaurant catalog, cart, checkout, and customer orders
    src/features/restaurant/   Restaurant-owner profile, menu, and order workflows
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

## Phase 9 integration completion

Phase 9 closes the user-facing integration gaps left by the API-first restaurant and driver work. Login now links to restaurant and driver applications, successful applications return to a prefilled Login screen with an approval explanation, and restaurant owners have an in-app workspace for profile/open-status, category, and menu-item management.

Order-detail screens now emit the authorized Socket.IO `order.subscribe` message before listening for order and delivery changes. The payload remains only a refresh signal; REST is still the source of truth. A focused unit test verifies subscription/filter/cleanup behavior.

CI now runs a real PostgreSQL-backed HTTP E2E journey after migrations: restaurant registration and menu creation, admin approval, customer cash order, restaurant preparation, driver registration/approval/acceptance, delivery completion, and customer notification/order verification. Run the same test against a migrated disposable database with:

```powershell
npm run test:e2e
```

The agreed product roadmap keeps cash on delivery as the only payment method. Phase 10 completed location pricing and admin promotions; Phase 11 completes the first supermarket/catalog domain.

## Checks

```powershell
npm test
npm run test:e2e
npm run lint
npm run typecheck
npm run build
npm run prisma:validate
npx expo-doctor@latest apps/mobile
```

The API unit tests cover authentication, role boundaries, restaurant/menu, orders, delivery, admin, realtime, notifications, and production safety. Mobile tests cover authentication/navigation, cart rules, role-registration routes, restaurant management navigation, and authorized order-room subscriptions. The opt-in E2E test exercises the complete four-role HTTP/PostgreSQL journey.

`npm audit --omit=dev --workspace @wasel/api` reports no API production vulnerabilities. The repository-level audit currently reports advisories in Expo SDK 54's CLI/config dependency tree; npm's automatic remedy is a breaking upgrade to Expo 57. That upgrade was not forced because this project intentionally preserves its validated Expo 54/native Android configuration.

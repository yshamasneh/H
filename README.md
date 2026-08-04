# TasawaQ

TasawaQ is a React Native food-delivery app with a NestJS API, PostgreSQL, and Prisma. Customer authentication uses a verified `+970` or `+972` phone number and password. The Android app is an Expo development build; Expo Go is not required.

## Stack

- Expo SDK 54, React Native 0.81.5, and React 19
- Native Android development build with the existing TasawaQ splash and logo
- NestJS 11 and TypeScript
- PostgreSQL 17 in Docker Compose with a persistent named volume
- Prisma 7
- Argon2id password hashing, HMAC-protected development OTPs, JWT access tokens, and rotating refresh sessions

## Prerequisites

- Node.js 22 or newer and npm
- Docker Desktop with the Compose plugin
- Android Studio, Android SDK, and an Android emulator
- Windows PowerShell for the commands shown below

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

## PostgreSQL and Prisma

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

## Run the NestJS API

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

No SMS or WhatsApp message is sent. The code is never returned by the API, stored as plaintext, or logged by the mobile app. The API refuses to start with the development provider in production. A real WhatsApp Business or SMS provider must replace it before production.

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

## Local development customer

This account is for local development only:

```text
Full name: test
Phone: +970590000000
Password: Test@12345
Role: CUSTOMER
```

The seed hashes the password and uses an idempotent upsert. Running `npm run prisma:seed` repeatedly does not create duplicates and never sends an OTP.

## Customer authentication flows

Signup collects a full name, one of the two supported country codes, a local phone number, and matching strong passwords. The API normalizes the phone, rejects existing users, stores the pending password only as an Argon2id hash, and creates the customer only after a valid signup OTP. Successful verification logs the customer in and opens Customer Home.

Login normalizes the phone, checks an active verified PostgreSQL user, returns access and refresh tokens, and routes by the server-provided role. The customer home screen shows only the customer's name, normalized phone, role, and logout action.

Forgot Password creates a reset OTP only for an existing account. An unknown number receives `ACCOUNT_NOT_FOUND`, and the app offers Customer Sign Up with the phone prefilled. A valid reset OTP produces a short-lived, single-use reset token. Changing the password consumes that token and revokes existing refresh sessions.

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

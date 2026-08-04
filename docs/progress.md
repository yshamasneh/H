# Progress

## 2026-08-04

Completed:

- Replaced Express in-memory authentication with a validated NestJS API.
- Added Docker Compose PostgreSQL with health check and persistent named volume.
- Added Prisma schema, migration, generated client workflow, and idempotent customer seed.
- Implemented `+970`/`+972` normalization, Argon2id passwords, HMAC OTPs, rate limiting, OTP cooldown/expiry/attempt limits, and purpose isolation.
- Implemented verified customer signup, duplicate protection, login, refresh rotation, logout, current user, forgot password, one-time reset tokens, and refresh-session invalidation.
- Added Login, Customer Sign Up, Forgot Password, reusable OTP, New Password, and Customer Home screens with loading and error states.
- Preserved the TasawaQ logo, three-second splash, Expo development build, native Android project, and VS Code tasks.
- Replaced React Native's deprecated built-in safe-area view with Expo's compatible safe-area module.
- Added backend behavior tests and mobile navigation tests.
- Updated setup, database, development OTP, seed, native Android, and production-provider documentation.

Verified:

- PostgreSQL became healthy and accepted the checked-in migration.
- Running the seed twice left exactly one local test customer.
- The API connected to PostgreSQL and the seeded login worked.
- A live signup printed an OTP in the backend log and created no `User` before verification.
- OTP verification created exactly one active verified `CUSTOMER`.
- Repeating signup returned `PHONE_ALREADY_REGISTERED`, created no duplicate, and printed no new OTP.
- Existing-account password reset worked; reset-token reuse, old password, and old refresh token were rejected.
- Unknown-account forgot password returned `ACCOUNT_NOT_FOUND` without creating a user.
- Data remained after restarting both PostgreSQL and the API.
- Backend and mobile tests, lint, type checking, API build, Prisma generation, and Prisma validation passed.
- Expo Doctor passed 17/17 checks, Metro exported both native bundles, and Android `assembleDebug` completed successfully.
- The rebuilt development client was installed on an emulator; the splash, login, seeded PostgreSQL login, Customer Home, and Metro connection were visually verified without Expo Go.

Remaining production integration:

- Replace the development terminal OTP provider with an approved WhatsApp Business or SMS provider and production delivery/anti-enumeration policies.
- Plan a tested Expo SDK upgrade before production; the current repository audit reports transitive Expo SDK 54 CLI/config advisories whose npm-proposed fix is a breaking Expo 57 upgrade. The API production dependency audit is clean.

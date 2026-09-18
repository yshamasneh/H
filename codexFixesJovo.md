# JOVO — Targeted Code Fixes

> Repository: `yshamasneh/H`
> Branch: `agent/phase-15-and-jovo-brand`
> Starting commit: `cc939c4a881f50fcba678249bbc2cd038111abbb`
> Started: 2026-09-17 (Asia/Jerusalem)

## Credential investigation

- Status: completed without contacting the provider or testing the credential.
- `deploy.ps1`: exists locally; ignored by `.gitignore`; not tracked or staged.
- Secret type: PostgreSQL connection URL.
- Provider/service: Azure Database for PostgreSQL.
- Affected local file: `deploy.ps1` (ignored; not modified and must not be committed).
- Masked fingerprint: `sha256:17bf652d215e...` (the secret and password suffix are intentionally withheld).
- Intended configuration source: `DATABASE_URL` supplied by the deployment environment/secret manager.
- Current tracked tree: no exact credential or provider-host match.
- Git branches/tags/history: `deploy.ps1` has no reachable commit; no exact credential or provider-host match was found with `git log --all` pickaxe searches.
- Other tracked PostgreSQL URL literals are documented placeholders or CI/test values; none matches this Azure host.
- Provider-side action: credential validity was deliberately not tested. If this login is active, an authorized owner must reset the password for the referenced PostgreSQL role in Azure Database for PostgreSQL (Azure Portal administrator reset when applicable, otherwise `ALTER ROLE` through an authorized administrator), update `DATABASE_URL` in the secret manager, and retire the old password. No rotation was performed here.
- Recommended local replacement: obtain `DATABASE_URL` from the process environment, fail before any deployment step when it is absent, and never write the value to logs. Because the file is ignored/local-only, this change is not committed by this task.

## Fixes completed

- Credential investigation completed.
- Task 2 completed: logout now performs best-effort authenticated Push Token deactivation before session logout, always clears local push ownership and local credentials, and preserves the device opt-in for safe reassociation after the next authenticated login.
- Task 2 completed: login and online session restoration reconcile the installation token with the authenticated user. The backend's unique-token upsert atomically reassigns the single row; unregister remains scoped to `userId + token`, preserving other devices.
- Task 3 completed: both the live Expo notification-response listener and cold-start response API feed a deduplicating navigator that waits for session restoration, validates order payloads, verifies role-scoped API access, and opens the existing customer/business/admin order-detail route.
- Task 3 completed: malformed/unsupported/logged-out responses are ignored safely; inaccessible or deleted orders remain on the current screen and show a localized fallback; listeners are removed on cleanup.
- Task 4 completed: the Expo Mobile Admin store detail now requires a rejection reason, reports empty-input/API errors, blocks repeat actions while pending, sends the exact `{ reason }` DTO, clears the form, and reloads the store after success. Backend validation, audit logging, and owner notification behavior were unchanged.

## Files changed

- `codexFixesJovo.md` — progress record only.
- `apps/mobile/App.tsx` — login/session reconciliation and logout orchestration.
- `apps/mobile/src/core/push-notifications.ts` — separate device opt-in from account ownership.
- `apps/mobile/src/core/push-token-lifecycle.ts` — testable reconciliation/logout orchestration.
- `apps/mobile/src/core/push-token-lifecycle.test.ts` — lifecycle coverage.
- `apps/mobile/src/features/shared/settings-screen.tsx` — owner-aware toggle state and registration.
- `apps/api/src/users/testing/fake-prisma.ts` — faithful PushToken upsert/updateMany test double.
- `apps/api/src/users/users.service.test.ts` — account transfer/deduplication/authorization coverage.
- `apps/mobile/src/core/notification-navigation.ts` — validated response parsing, session queue, access check, role routing, deduplication, and listener attachment.
- `apps/mobile/src/core/notification-navigation.test.ts` — live/background, cold-start, auth wait, payload, role, duplicate, logout, fallback, and cleanup coverage.
- `apps/mobile/src/i18n/locales/en/common.json` and `ar/common.json` — inaccessible-order fallback copy.
- `apps/mobile/src/core/api.ts` — rejection client accepts, trims, and sends the required reason body.
- `apps/mobile/src/core/admin-api.ui.test.tsx` — request-contract regression test.
- `apps/mobile/src/features/admin/restaurants-screen.tsx` — rejection reason UI, validation, pending guard, errors, and refresh.
- `apps/mobile/src/i18n/locales/en/admin.json` and `ar/admin.json` — rejection field, validation, and action copy.
- Pre-existing `codexReviewJovo.md` remains untracked and will not be included in commits.

## Tests added

- 4 mobile lifecycle tests: authenticated reconciliation, disabled preference, offline unregister/logout cleanup, and unregister-before-session-revoke ordering.
- 2 backend service tests: A-to-B token reassignment with repeat-registration deduplication, and prevention of unrelated-user deactivation.
- 11 notification navigation tests covering live/background delivery, cold-start retrieval, session restoration, exact order ID, customer/business/admin routes, malformed/missing and unsupported payloads, duplicate suppression, logged-out behavior, inaccessible-order fallback, and listener cleanup.
- 1 Mobile Admin API contract test proving that the trimmed rejection reason reaches the POST JSON body.

## Commands and results

- Repository/branch/HEAD checks: pass; origin is `https://github.com/yshamasneh/H.git`, branch is correct.
- Initial `git status`: clean tracked tree; pre-existing untracked `codexReviewJovo.md` preserved.
- `AGENTS.md`: not present.
- Safe deploy-file classification and masked fingerprinting: pass.
- `git log --all -- deploy.ps1`: zero commits.
- Exact credential and provider-host pickaxe searches over all refs: zero commits.
- Current tracked-tree exact credential/provider-host scans: zero matches.
- Targeted mobile lifecycle test: 4 passed, 0 failed.
- Targeted API users-service test file: 13 passed, 0 failed (including 2 new Push Token tests).
- `git diff --check` before the Task 2 commit reported three Markdown hard-break spaces in this progress file; they are removed in the next tracked update. No source-code whitespace error was reported.
- Targeted notification-navigation test file: 11 passed, 0 failed.
- Targeted Mobile Admin rejection request test: 1 passed, 0 failed.
- Full repository typecheck: pass for Admin, API, and Mobile.
- Full repository test suite: 488 passed, 3 PostgreSQL-gated tests skipped, 0 failed. Existing React `act(...)` warnings from icon rendering remain non-failing and were not changed.
- Prisma schema validation: pass.
- Repository `lint`: pass; the current lint scripts are `tsc --noEmit`, not an independent ESLint check.
- Non-production builds: pass for Vite Admin, Nest/Prisma API, and Expo Web/iOS/Android export. Vite reported its existing large-chunk warning (624.68 kB), not a failure.
- Final build outputs were ignored; no generated artifact changed the tracked tree.
- `git diff --check` across all changes from the starting commit: pass.
- Final tracked-diff secret scan: zero private keys, credential-bearing database URLs, AWS keys, GitHub tokens, or JWT-shaped literals. Two Expo-token-shaped values are deterministic fake test fixtures (`shared-installation` / `owner-installation`), not real device tokens.
- Final pre-documentation `git status`: only this tracked progress file was modified; the pre-existing untracked `codexReviewJovo.md` remained untouched and unstaged.

## Commits

- Task 1: no commit, because the only affected script is ignored/local-only and no tracked configuration requires a change.
- Task 2: `7091c36a0964b51111fd34774959052beafd8f1c` (`Fix push token account isolation`).
- Task 3: `f179d61197cfa1f87290ad9b054c70120bae1c7b` (`Open orders from push notification taps`).
- Task 4: `47d14d6259f38428db2b18414792b3fe92a1e861` (`Fix mobile admin store rejection`).

## Deferred manual work

- Confirm with the authorized Azure/PostgreSQL owner whether the local credential is active; if active, perform the provider-side password reset described above and update the deployment secret manager.
- Do not add `deploy.ps1` to Git.
- Android real-device verification (deferred): install a credentialed release/internal build on a physical Android device; sign in as a customer with a known accessible order; background the app; send `ORDER_STATUS_CHANGED` with that order UUID and tap it; confirm the correct detail opens once. Repeat after force-stop/cold start, then with malformed data, an inaccessible order, and while logged out. Repeat for a RESTAURANT and ADMIN account using orders each role can access.
- iOS real-device verification (deferred): install a credentialed TestFlight/release build on a physical iPhone; grant notifications; repeat the foreground-to-background tap, terminated-app tap, malformed/inaccessible order, duplicate tap, logged-out, RESTAURANT, and ADMIN scenarios; confirm APNs delivery and that the listener is not duplicated after remount.

## Remaining issues

- No remaining code issue from Tasks 2–4.
- Deferred external/manual work is listed above.
- Final documentation commit, remote movement check, and normal push remain operational steps.

## Differences from the original readiness report

- The original report correctly identified a plaintext local PostgreSQL URL, but this focused investigation now establishes that it is Azure Database for PostgreSQL, is ignored and untracked, and neither the exact literal nor its provider host appears in reachable Git history.
- No evidence was found that the credential was ever committed. Its active/revoked state remains intentionally unverified because provider access is outside scope.
- The Mobile Admin rejection finding was confirmed exactly as reported: the old client signature omitted `reason` and produced no JSON body. No backend contract change was necessary.
- The original report's Push Token account-switch issue is now fixed by code and automated tests; real-device/provider verification remains deferred.
- The original report's missing notification-tap navigation is now implemented and automatically tested for live and cold-start paths; real Android/iOS delivery remains deferred.
- No attempt was made to address unrelated readiness findings (Expo Doctor configuration, dependency advisories, CI scope, branding, deployment, OTP provider, or infrastructure).

# Round 2 — Push reliability, Expo Doctor and readiness

## Task 1 — Push delivery reliability

### Root cause

- `createNotification` delegated directly to a fire-and-forget Expo sender after the database write. Network, timeout, and Expo 5xx failures were only logged, so there was no durable state to retry.
- Expo tickets were inspected only for immediate `DeviceNotRegistered`; ticket IDs were not stored and receipts were never polled.
- New-order notifications were written after the order transaction, so a committed order could exist with neither a notification nor a durable delivery job.

### Design chosen

- Added a small Prisma `PushDelivery` outbox with a stable unique key per notification/device and explicit `PENDING`, `PROCESSING`, `AWAITING_RECEIPT`, `DELIVERED`, `RETRYABLE_FAILED`, and `PERMANENT_FAILED` states.
- Notification creation now inserts per-active-device outbox rows in the same transaction. New-order notification/outbox creation is inside the order transaction; only socket emission is deferred until commit. Expo is contacted solely by the background worker after commit.
- The in-process worker uses compare-and-set row claims, 100-message Expo batches, bounded exponential backoff with jitter, request timeout, maximum send/receipt attempts, stale-claim recovery, ticket persistence, receipt polling, and graceful shutdown. Multiple API instances can safely poll the same table.
- Permanent malformed-token/payload failures are not retried. `DeviceNotRegistered` deactivates only the affected token. Token reassignment terminally closes unfinished jobs for the former owner before the token is activated for the new owner.
- Logs contain delivery IDs and sanitized error codes only. Prometheus output now exposes pending, delivered, retried, permanent-failure, and invalid-token metrics.

### Files changed

- Prisma: `apps/api/prisma/schema.prisma` and migration `20260918000000_add_push_delivery_outbox`.
- Delivery path: notification utility, Push sender/worker, realtime gateway/emitter, order creation, token registration, environment validation/examples, and metrics service.
- Tests/fakes: Push worker, orders, users, realtime, and affected domain Prisma doubles.

### Migration created

- `apps/api/prisma/migrations/20260918000000_add_push_delivery_outbox/migration.sql` creates the enum/table, unique deduplication key, due-work indexes, and cascading notification/token foreign keys. It does not alter or delete existing notification rows.
- Both Round 2 migrations were applied successfully with all prior migrations to a clean disposable PostgreSQL 16 database; Prisma schema validation also passed.

### Tests added

- Successful ticket and receipt delivery; provider timeout; transient 5xx followed by success; retry/backoff; maximum attempts; stale-processing recovery; concurrent worker claim exclusion; >100 batching; pending/later-success receipts; token-scoped `DeviceNotRegistered`; malformed-token permanence; sanitized logs.
- Order tests prove a committed order creates one pending outbox job, idempotent checkout does not duplicate it, and rollback leaves no order/notification/outbox row.
- Token-isolation regression now also proves unfinished jobs for account A are terminally closed before the installation is assigned to account B.

### Commands and results

- Targeted API tests across Push, orders, users, drivers, restaurants, realtime gateway/emitter: 178 tests, 177 passed initially; one fake-transaction reference bug was found and corrected.
- Targeted rerun for Push/orders/users/environment: 108 passed, 0 failed.
- Focused TypeScript check of modified production files: passed.
- `npm run prisma:validate --workspace @wasel/api`: passed.
- `git diff --check`: passed after removing two trailing blank lines.
- Tracked-diff credential scan: no real credential or connection-string literal; Expo-shaped values are generated/fixed test data only.

### Commit SHA

- `f479dfc7885f07c2be62f30319fe8c5da86ebe54` (`Add durable push delivery outbox`).

### Manual verification

- No real Expo request or physical-device delivery was performed. Production Expo/APNs/FCM credentials, Android/iOS background delivery, and provider dashboards remain deferred.
- Migration structure and the existing PostgreSQL E2E suite were verified against a disposable local container; provider delivery remains deferred.

## Task 2 — Expo Doctor compatibility

### Root cause

- `android.usesCleartextTraffic` is not a valid Expo SDK 54 app-config field at that location, so schema validation failed even though the intended value was secure.
- The installed `expo` and `expo-constants` packages were one patch behind the versions required by the current SDK 54 compatibility metadata.

### Design chosen

- Removed only the invalid app-config field. Android's modern platform default remains no cleartext traffic, and application code still rejects any non-HTTPS `EXPO_PUBLIC_API_URL` outside development.
- Kept Expo SDK 54 and used `expo install` to move only `expo` to `~54.0.37` and `expo-constants` to `~18.0.14`, updating the npm lockfile with their compatible transitive graph.
- Package name, bundle identifier, EAS project ID, app/build versions, release channels, permissions, and HTTPS runtime enforcement were preserved.

### Files changed

- `apps/mobile/app.json`.
- `apps/mobile/package.json`.
- `package-lock.json`.

### Migration created

- None.

### Tests added

- None; this task is configuration/dependency compatibility and is verified through Doctor, typecheck, existing tests, config introspection, and unsigned exports.

### Commands and results

- Before: `npx --yes expo-doctor@latest apps/mobile` reported `15/17`; failures were the invalid Android field plus patch mismatches (`expo` expected `~54.0.37`, found `54.0.36`; `expo-constants` expected `~18.0.14`, found `18.0.13`).
- After: the same Doctor command reported `17/17 checks passed`. Doctor also reports that the repository's pre-existing `appConfigFieldsNotSyncedCheck` opt-out remains disabled; no new exclusion was added.
- Mobile typecheck: passed.
- Mobile tests: 87 unit tests and 18 Jest UI tests passed; existing non-failing React `act(...)` warnings from icon rendering remain unchanged.
- `expo config --type public`: passed and confirmed the existing identifiers/version/EAS Update values were unchanged.
- `expo config --type introspect`: passed.
- Unsigned `expo export --platform all`: passed for Android, iOS, and Web.
- npm reported 27 existing dependency advisories during install; broad advisory remediation is explicitly outside this round and no `npm audit fix` was run.

### Commit SHA

- `191a1938909346cf76e34e20c823c1842612b90e` (`Align mobile app with Expo Doctor`).

### Manual verification

- Signed Android/iOS builds, EAS credentials, TestFlight, Google Play, and physical-device checks remain deferred by scope.

## Task 3 — Partner-account readiness

### Root cause

- Startup attempted to upsert three required accounting identities and swallowed any failure. The readiness endpoint checked only `SELECT 1`, so the API could accept traffic even though order completion/settlement would later fail while resolving a required payee.
- The exact invariant was implicit: `OWNER_A` and `OWNER_B` must each be an active, global `PLATFORM_OWNER`; `DELIVERY_OPS` must be an active, global `DELIVERY_OPS` account. Names and optional user links are mutable and are not readiness invariants.

### Design chosen

- Startup now validates and emits only sanitized structured issue codes; it no longer silently repairs existing financial reference rows.
- `/health/live` remains process-only. `/health/ready` checks PostgreSQL and freshly validates the three reference identities on every call, so it returns a generic 503 on missing/duplicate/inactive/wrong-kind/business-scoped data and automatically recovers after correction.
- A backward-safe data migration inserts missing identities with `ON CONFLICT (key) DO NOTHING`. Existing rows and all financial balances/earnings/settlements are untouched.
- `npm run reconcile:partners -- --dry-run` is the default non-mutating operator check. Explicit `--apply` creates missing identities only, in a transaction with `createMany(..., skipDuplicates: true)` and the existing unique key, so concurrent invocations cannot duplicate them. Inconsistent existing rows are reported, never overwritten.

### Files changed

- Accounting invariant/service/module files and focused service tests.
- Health controller/module and readiness tests.
- `apps/api/prisma/reconcile-partner-accounts.ts`, API/root package scripts, and the operations runbook.

### Migration created

- `apps/api/prisma/migrations/20260918010000_seed_required_partner_accounts/migration.sql` inserts only missing `OWNER_A`, `OWNER_B`, and `DELIVERY_OPS` identities. It creates no balance or ledger row and does not update an existing account.

### Tests added

- Valid set passes; missing, duplicate, wrong-kind, inactive, and business-scoped accounts fail.
- Liveness remains healthy while readiness fails for missing data or database unavailability.
- Readiness recovers on the next request after correction.
- Concurrent apply reconciliation creates one row per key; dry-run modifies nothing.
- API failures and structured logs omit account names, balances, raw database errors, and financial values.

### Commands and results

- Targeted partner/readiness/accounting/driver tests: 84 passed, 0 failed.
- Focused TypeScript check of the invariant, service, readiness controller, and command: passed.
- Prisma schema validation: passed.
- Clean PostgreSQL 16 validation: all 29 migrations applied, reconciliation dry-run returned ready with no missing identities, and the existing database E2E suite passed 22/22.

### Commit SHA

- `439e96331b85d099b13e49087b05dca0fef6b5f5` (`Gate readiness on partner accounts`).

### Manual verification

- No production account, balance, settlement, database, or provider was accessed or modified.

## Round 2 final verification

- Full repository typecheck: passed for Admin, API, and Mobile.
- Full repository tests: 501 passed, 3 PostgreSQL-gated tests skipped, 0 failed. The three gated tests were then run separately against clean PostgreSQL and all 22 nested E2E assertions passed.
- Prisma validation: passed.
- Repository lint: passed; as before, the repository's lint scripts invoke TypeScript checks rather than an independent ESLint configuration.
- Expo Doctor: `17/17 checks passed`; the pre-existing native-config sync-check opt-out remains explicitly reported by Doctor.
- Non-production builds: Admin Vite build, API Prisma/TypeScript build, and Android/iOS/Web Expo exports passed. Vite's existing 624.68 kB chunk warning is non-failing.
- Clean PostgreSQL: all 29 migrations, including both Round 2 migrations, applied successfully; partner dry-run was ready; database E2E passed. The first disposable database name was intentionally rejected by the existing E2E safety guard because it lacked the word `test`; the corrected clean database run passed. Both temporary containers were removed.
- Existing non-failing warnings retained: React icon-test `act(...)` warnings and `pg` query deprecation warnings inside database E2E.
- `git diff --check`: passed. Final tracked-diff scan found zero private keys, AWS/GitHub tokens, JWT literals, or credential-bearing connection strings. Nine Expo-shaped strings are generated/deterministic test fixtures only; no real Push Token is present.
- Generated build output remained ignored. Before this documentation commit, `git status` contained only this tracked progress file plus the pre-existing untracked `codexReviewJovo.md`, which remains untouched.
- Remote movement check found the branch unchanged at `ac572958db73d00f1a05bf4dadf553748c6cf97b` (local ahead 4, remote ahead 0). A normal, non-force push succeeded through `6719c50351459e97150a9914fa4783d35adf6fd6`.

## Round 2 deferred manual work

- Real Expo/APNs/FCM delivery, tickets/receipts from production credentials, physical Android/iPhone background and terminated-app behavior, and multi-device field verification.
- Signed EAS builds, TestFlight, Google Play internal testing, and store submission.
- Production/staging deployment, DNS/TLS, real OTP provider, Azure credential rotation, load/stress testing, and broad dependency-advisory remediation remain outside this round.

## Round 2 differences from the original readiness report

- Push delivery is no longer fire-and-forget: delivery state, retry, stale recovery, Expo tickets/receipts, token invalidation, metrics, and transactional new-order enqueueing now exist and are automatically tested.
- Expo Doctor moved from `15/17` to `17/17` on the same SDK major; the invalid Android field and the two patch mismatches were corrected.
- Financial reference data now gates readiness independently of liveness, with a safe dry-run/apply operator command and an idempotent migration. It no longer depends on a swallowed startup reconciliation attempt.
- These changes do not establish production or real-device readiness; all external/manual items above remain deferred.

# Round 3 — Dependencies, CI, legacy migrations and native config

## Task 1 — Production dependency-security triage

### Baseline

- `npm audit --omit=dev` at the workspace root reported 0 Critical, 22 High, 14 Moderate, and 0 Low affected package nodes (36 total). Of the High nodes, 7 were direct and 15 transitive; parent propagation means these are not 22 distinct advisories.
- High roots affected API/Nest (`multer`), API Prisma tooling (`mysql2`, `deepmerge-ts`), and Mobile Expo/Metro/config tooling (`fast-uri`, `js-yaml`, `postcss`, `@xmldom/xmldom`, and `image-size`). Paths, advisory IDs, patched versions, reachability, and mitigations are recorded in `docs/dependency-security-review.md`.

### Root cause or gap

- Compatible patched transitive releases existed but the lockfile retained earlier vulnerable versions. Three upstream packages pinned vulnerable exact versions and required narrowly scoped same-major overrides.
- Expo SDK 54's pinned Metro graph still requires `image-size@1`; Prisma 7.9/7.10 still pins `deepmerge-ts@7`. Their fixes require incompatible major dependency/framework changes and were deliberately not forced.

### Files changed

- `package.json`: same-major overrides for `multer@2.4.0`, `mysql2@3.24.4`, and `postcss@8.5.28`.
- `package-lock.json`: compatible updates for the overrides plus `fast-uri@3.1.8`, `qs@6.16.0`, `js-yaml@3.15.2/4.3.2`, and `@xmldom/xmldom@0.8.15/0.9.12`.
- `docs/dependency-security-review.md`: tracked baseline, every Critical/High path, reachability, remediation, and accepted risk.

### Tests performed

- API typecheck, 396 tests (393 passed, 3 database-gated skipped), API build, and Prisma validation: passed.
- Mobile typecheck, unit/UI tests, and unsigned all-platform Expo export: passed; existing non-failing React `act(...)` warnings remain.
- Expo Doctor: `17/17 checks passed` on the unchanged Expo SDK major.
- `git diff --check`: passed.

### Before/after result

- Before: 0 Critical / 22 High / 14 Moderate / 0 Low (36 total).
- After: 0 Critical / 11 High / 14 Moderate / 0 Low (25 total). The affected `multer`, `mysql2`, `postcss`, `fast-uri`, `qs`, XML, and YAML paths are gone; no direct framework major changed.

### Remaining risk

- Two High advisory roots remain: `image-size@1.2.1` in Metro build tooling and `deepmerge-ts@7.1.5` in Prisma config/CLI tooling. Both are outside application-controlled request paths, but they still require an upstream-compatible Expo/Metro or Prisma resolution and must not be represented as fixed.

### Commit SHA

- `bbb9c9d0e2cb4c1dea866865f49d933318032b57` (`Triage production dependency advisories`).

## Task 2 — GitHub Actions release gates

### Baseline

- The existing CI ran one monolithic PostgreSQL job plus container builds. Push filtering still targeted `agent/customer-phone-auth`, the production audit covered only the API workspace, there was no Expo Doctor or tracked-secret gate, action references were floating major tags, and a failure log was not retained.
- Clean migration deployment, partner dry-run, and PostgreSQL E2E already existed in the job, but they were not separated from unit/type/build work and did not gate the requested branch.

### Root cause or gap

- Release-branch coverage and security checks had not been updated with the current JOVO branch and Round 2 verification commands.
- A normal `npm audit --audit-level=high` cannot be a useful green gate while the three explicitly documented, tooling-only advisory roots remain upstream-blocked. A repository check now rejects every Critical and every High advisory except those exact reviewed URLs; a new High therefore fails CI.

### Files changed

- `.github/workflows/ci.yml`: five bounded jobs for quality/security, PostgreSQL, API/Admin builds, Expo Doctor/unsigned exports, and runtime container builds.
- `scripts/check-production-audit.mjs`: all-workspace production audit policy with an exact three-advisory allowlist documented in the security review.
- `scripts/scan-tracked-secrets.mjs`: high-confidence scan of tracked files that reports only file/line/rule and never prints a matched value.
- `package.json`: `security:audit:production` and `security:scan` commands.

### Tests performed

- Reproducible `npm ci`, Prisma generate/validate, both security commands, and `git diff --check`: passed.
- Production audit gate observed 0 Critical / 11 High / 14 Moderate / 0 Low nodes and exactly the three reviewed High advisory roots.
- Secret scan passed across 498 currently tracked files. Known example/documentation database URLs were classified as placeholders without printing their values.
- API, Admin, and unsigned Android/iOS/Web Mobile builds passed after a clean install; the existing Admin chunk-size warning remains non-failing.
- Workflow YAML parsed locally with `js-yaml`; `actionlint 1.7.7` passed in its pinned Docker image.

### Before/after result

- Before: no gate on `agent/phase-15-and-jovo-brand`; one duplicated monolithic job; API-only audit; no secret scan, Doctor gate, timeout, pinned action SHAs, or failure artifacts.
- After: pushes to `main`, `release/**`, and the target branch plus all pull requests run least-privilege, cancelable, timed jobs using lockfile installs. PostgreSQL 17 applies all migrations to a clean test database, validates partner readiness, and runs database E2E; independent jobs gate lint/types/unit tests/security, API/Admin builds, Expo Doctor/exports, and containers.

### Remaining risk

- Workflow syntax and shell semantics passed locally, but the first hosted run, service-container networking, cache behavior, and required-check selection must be confirmed in the GitHub Actions UI. No repository settings or branch protection were changed.
- CI uses only explicit disposable test values and receives no Production credentials on pull requests.

### Commit SHA

- `3673b49af8ad51949a32f3768122dbfe462bc215` (`Enforce release gates in GitHub Actions`).

### Hosted-run corrective follow-up

- The first pushed workflow run (`35307216998`) validated the database and quality/security jobs, but exposed npm's cross-platform optional-dependency lockfile bug: the Windows-generated lockfile omitted Rollup and Lightning CSS Linux binaries. Consequently the Admin, Mobile export, and Web image steps failed on Ubuntu even though the same builds passed on Windows.
- Root `optionalDependencies` now pin the exact Linux x64/glibc binaries matching the existing `rollup@4.62.4` and `lightningcss@1.33.0`; the lockfile contains their integrity/platform records. This is not a framework upgrade or an override. The now-redundant one-off Rollup install was removed from the Admin Dockerfile, so all consumers use reproducible `npm ci` alone.
- Verification after correction: Windows `npm ci`, Admin build, Mobile all-platform export, Expo Doctor `17/17`, Prisma validation, and production audit passed. Clean Linux Docker builds for Admin and Mobile Web passed using the final lockfile; production advisory counts remained 0 Critical / 11 High / 14 Moderate / 0 Low.
- Corrective commit SHA: `1262e2acf0cc780b5a0042b21abcfa3b25b29ac2` (`Make CI native dependencies reproducible`).
- Hosted workflow run `35308214741` then passed all five jobs on the corrective head: quality/security, PostgreSQL clean and legacy migration E2E, API/Admin builds, Expo Doctor/unsigned exports, and both runtime container builds.

## Task 3 — Migration test with representative legacy data

### Baseline

- Round 2 had proved all 29 migrations on an empty PostgreSQL database, but had not exercised the upgrade from the 27-migration pre-outbox/pre-reference-account schema with populated relational and financial data.

### Root cause or gap

- A clean-database migration cannot detect destructive defaults, historical backfills, changed relationships, duplicate fixed accounts, unexpected outbox creation, or balance changes against rows that already exist.

### Files changed

- `apps/api/prisma/test-legacy-migration-upgrade.ts`: isolated PostgreSQL upgrade harness with guarded database creation/drop and representative legacy fixtures.
- Root and API `package.json`: `test:migrations:legacy` commands.
- `.github/workflows/ci.yml`: the PostgreSQL job now runs the legacy upgrade test and retains its log on failure.

### Migration created

- None. This task tests the existing `20260918000000_add_push_delivery_outbox` and `20260918010000_seed_required_partner_accounts` migrations without changing them.

### Tests performed

- PostgreSQL 17 disposable-container run: passed. The harness applied 27 migrations through `20260911000000_add_store_show_location_to_customer`, inserted 18 representative rows, applied the final two migrations, and reran deployment with no pending migration.
- Fixtures cover users/session, supermarket and membership, category/product/stock movement, historical delivered order/item/status/delivery, notification/PushToken, an existing `OWNER_A`, financial record, and partner earning.
- Assertions passed for row counts, fixed IDs/relationships, PushToken uniqueness/ownership, unchanged 300-minor-unit legacy balance, preservation of the existing `OWNER_A` identity/name, exactly three valid required accounts, zero historical Push jobs, readiness, and idempotent redeploy.
- API typecheck and `actionlint 1.7.7`: passed. A production-mode invocation was rejected before database access. The disposable container and generated database were removed.

### Before/after result

- Before: clean-schema migration coverage only.
- After: automated populated-schema upgrade coverage from migration 27 to 29, included in the PostgreSQL CI gate through `npm run test:migrations:legacy`.

### Remaining risk

- The test uses synthetic representative rows, not Production data. It cannot model every historical data distribution; a separately authorized, sanitized staging clone rehearsal remains advisable before deployment.
- The harness intentionally accepts only a local PostgreSQL host and a source database whose name contains `test`; it creates and drops only its generated `jovo_legacy_test_*` database. It never drops the supplied source database.

### Commit SHA

- `5d509f567fea4c513cee4dda4a78cd2223c37547` (`Test migrations against legacy data`).

## Task 4 — Expo native configuration synchronization

### Baseline

- Expo Doctor reported `17/17`, but `expo.doctor.appConfigFieldsNotSyncedCheck` was disabled while a tracked Android project and app configuration both declared production-critical values.
- The project has a maintained `apps/mobile/android` project and no checked-in iOS project. Existing architecture notes and the Android post-prebuild script confirm that Android is intentionally hand-maintained while iOS uses Expo Continuous Native Generation.

### Root cause or gap

- The Doctor opt-out is intentional: a normal Android prebuild would undo deliberate release hardening by restoring debug signing, disabling resource/code shrinking, and enabling the development network inspector. Removing the opt-out would therefore misrepresent the ownership model rather than make it safer.
- The evaluated Expo configuration and Android native project agreed on identifiers, schemes, permissions, versioning, update URL/runtime, notification channel, and release hardening. One real drift was found: `updates.fallbackToCacheTimeout` evaluates to 30000 ms, while the Android manifest still used 0 ms.

### Files changed

- `apps/mobile/android/app/src/main/AndroidManifest.xml`: synchronized the Expo Updates launch wait to 30000 ms.
- `apps/mobile/scripts/check-native-config.cjs` and `apps/mobile/package.json`: added a fail-fast consistency check for identifiers, versions, schemes, permissions, Expo Updates/EAS values, release hardening, notification channel, and required native assets.
- `.github/workflows/ci.yml`: runs the native consistency check before Expo Doctor/export.
- `apps/mobile/NATIVE_CONFIGURATION.md`: documents the mixed ownership model, authoritative files, critical synchronization rules, and a safe temporary-prebuild comparison process.

### Tests performed

- Native consistency check: passed for `com.jovo.app`, version `0.13.0`/13, five granted and four blocked Android permissions.
- Expo public configuration and configuration introspection: evaluated successfully.
- Expo Doctor: `17/17 checks passed` with the intentional opt-out retained.
- Mobile typecheck, 87 unit tests, 18 UI tests, and unsigned Android/iOS/Web Expo exports: passed; existing non-failing React `act(...)` warnings remain.
- A direct Gradle `:app:assembleDebug` reached native C++ compilation but could not complete from this OneDrive workspace because a generated object path exceeded the Windows 260-character limit. This is an environment/path constraint, not a compile error in the changed configuration; the exact build must be repeated from a short path on Windows or on CI/Linux.

### Before/after result

- Before: the intentional opt-out had no executable guard, and Android's Expo Updates launch wait had drifted from the evaluated app configuration.
- After: the opt-out remains for the documented hand-maintained Android project, the known drift is corrected, and CI fails if critical declarative/native values diverge. iOS remains generated from app configuration and was verified by the unsigned Expo iOS export rather than a maintained native directory.

### Remaining risk

- A native Android Gradle build from a short filesystem path and an iOS native build on macOS still require CI or a suitable local host. No signed build, EAS credential, physical-device behavior, update-channel delivery, or store submission was exercised.
- The hand-maintained Android manifest intentionally pins the production update channel. Developers must use an explicit native flavor/override before treating a bare preview build as preview-channel equivalent.

### Commit SHA

- `b3a0e6510d11e496606dee0dd3772407bf605886` (`Guard Expo native configuration sync`).

## Round 3 final verification

- Full repository typecheck: passed for Admin, API, and Mobile.
- Full repository test suite: 501 passed, 3 PostgreSQL-gated tests skipped in the general run, and 0 failed. The gated tests then passed separately against PostgreSQL 17 with 22/22 nested assertions.
- Clean PostgreSQL 17: all 29 migrations applied, partner reconciliation dry-run returned ready, and the disposable database/container was removed after verification.
- Legacy upgrade: passed again from migration 27 to 29 with 18 representative rows preserved, no historical Push job, unchanged financial invariant, three valid required partner accounts, and an idempotent deployment rerun.
- Prisma schema validation and repository lint: passed. The repository lint commands remain TypeScript checks rather than a separate ESLint/Prettier migration, which is explicitly outside this round.
- Expo Doctor: `17/17 checks passed`; the intentional native-config sync opt-out is now documented and guarded by `check:native-config`.
- Builds: Admin Vite, API Prisma/TypeScript, and unsigned Android/iOS/Web Expo exports passed. The existing 624.68 kB Admin chunk warning remains non-failing.
- A direct Android Gradle debug build could not finish in the long OneDrive workspace because generated C++ output exceeded the Windows 260-character path limit. It must be confirmed from a short Windows checkout or GitHub/Linux; no code or configuration compilation error was reported before that filesystem failure.
- Final production dependency gate: 0 Critical / 11 High / 14 Moderate / 0 Low affected nodes, with only the three exact reviewed tooling advisory roots accepted. This is an explicit accepted-risk gate, not a claim of zero advisories.
- `actionlint 1.7.7`, the tracked-secret scan (503 files), native consistency check, committed-range `git diff --check`, and working-tree `git diff --check`: passed.
- Generated exports/build output remained ignored. `codexReviewJovo.md` remains the sole untracked file and was not read, changed, staged, or committed in this round.

## Round 3 remaining confirmation

- GitHub Actions run `35308214741` confirmed PostgreSQL service networking, clean/legacy migrations, E2E, lint, types, tests, audit, secret scan, Doctor, native consistency, API/Admin/Mobile builds, container builds, and failure propagation. Repository branch-protection settings were not changed or audited through the API.
- Repeat the native Android Gradle build from a short filesystem path and perform an iOS native build on macOS. Signed builds, EAS credentials, store submission, external services, physical devices, and deployment remain deferred as required.

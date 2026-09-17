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

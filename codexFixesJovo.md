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
- Notification navigation and Mobile Admin rejection remain in progress.

## Files changed

- `codexFixesJovo.md` — progress record only.
- `apps/mobile/App.tsx` — login/session reconciliation and logout orchestration.
- `apps/mobile/src/core/push-notifications.ts` — separate device opt-in from account ownership.
- `apps/mobile/src/core/push-token-lifecycle.ts` — testable reconciliation/logout orchestration.
- `apps/mobile/src/core/push-token-lifecycle.test.ts` — lifecycle coverage.
- `apps/mobile/src/features/shared/settings-screen.tsx` — owner-aware toggle state and registration.
- `apps/api/src/users/testing/fake-prisma.ts` — faithful PushToken upsert/updateMany test double.
- `apps/api/src/users/users.service.test.ts` — account transfer/deduplication/authorization coverage.
- Pre-existing `codexReviewJovo.md` remains untracked and will not be included in commits.

## Tests added

- 4 mobile lifecycle tests: authenticated reconciliation, disabled preference, offline unregister/logout cleanup, and unregister-before-session-revoke ordering.
- 2 backend service tests: A-to-B token reassignment with repeat-registration deduplication, and prevention of unrelated-user deactivation.

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
- `git diff --check` after Task 2: pass.

## Commits

- Task 1: no commit, because the only affected script is ignored/local-only and no tracked configuration requires a change.
- Task 2: pending commit creation; SHA will be recorded immediately after commit.

## Deferred manual work

- Confirm with the authorized Azure/PostgreSQL owner whether the local credential is active; if active, perform the provider-side password reset described above and update the deployment secret manager.
- Do not add `deploy.ps1` to Git.

## Remaining issues

- Task 3: notification-response navigation.
- Task 4: Mobile Admin business rejection body/reason.
- Final repository verification and normal push.

## Differences from the original readiness report

- The original report correctly identified a plaintext local PostgreSQL URL, but this focused investigation now establishes that it is Azure Database for PostgreSQL, is ignored and untracked, and neither the exact literal nor its provider host appears in reachable Git history.
- No evidence was found that the credential was ever committed. Its active/revoked state remains intentionally unverified because provider access is outside scope.

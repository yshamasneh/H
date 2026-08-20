# Full Pre-Launch QA & Testing Audit

## Role
You are acting as a senior QA engineer and security reviewer performing a **complete pre-launch audit** of this React Native + TypeScript food delivery / supermarket app before public release. The app has four roles: **customer**, **driver**, **restaurant admin**, and **super admin**.

## Operating rules (read first)
- Work **fully autonomously**. Do NOT stop to ask me questions, do NOT wait for confirmation, and do NOT ask for permission before running commands, reading files, or writing the report.
- If something is ambiguous or you're missing context (e.g. env vars, backend URL, test credentials), make the most reasonable assumption, proceed, and **document the assumption** in the report instead of asking.
- You are in a repo I already trust — read every file you need to. Run install, lint, type-check, and test commands directly.
- Do NOT push to git, do NOT open PRs, do NOT deploy anything, and do NOT touch production/remote services. Everything stays local.
- Only make code changes if you're writing missing automated tests (see step 4) or fixing a trivial, unambiguous bug you are highly confident about (e.g. missing null check causing an obvious crash) — and list every change you made at the end. Otherwise, default to reporting, not fixing.
- Your final deliverable is a single file: `QA_REPORT.md` at the repo root. Do not stop until it's written.

## Step 1 — Repo orientation
- Map the project structure: apps/packages, navigation structure, how the four roles (customer/driver/restaurant admin/admin) are separated in the codebase (separate navigators? route guards? separate apps?).
- Identify the backend: REST/GraphQL, auth provider, real-time layer (sockets/Firebase/etc.), and how API base URLs and secrets are configured (.env, config files).
- Note the state management approach (Redux/Zustand/Context/etc.) and how auth/session state persists.

## Step 2 — Static analysis & build health
- Run `npm install` (or yarn/pnpm — detect from lockfile) and record any install errors or peer-dependency warnings.
- Run TypeScript type-checking (`tsc --noEmit` or the project's equivalent script). List every type error with file:line.
- Run ESLint/Prettier if configured. List errors and meaningful warnings (skip pure style nits unless there are many).
- Run a dependency audit (`npm audit` or equivalent). Flag any high/critical vulnerabilities and any noticeably outdated core packages (React Native, navigation, auth libs).
- Check that both Android and iOS build configs are consistent (app.json/app.config, Info.plist, AndroidManifest.xml) — versioning, permissions declared vs. permissions actually used in code, app name/bundle id placeholders left unfilled.

## Step 3 — Automated test coverage
- Find existing test setup (Jest/RNTL/Detox/etc.) and run the full suite. Report pass/fail counts and any flaky-looking tests.
- Generate/inspect coverage. Identify which **critical flows are untested**, specifically:
  - Sign up / sign in / sign out / delete account
  - Cart → checkout → order placement
  - Order status transitions (placed → accepted → preparing → out for delivery → delivered/cancelled)
  - Driver: accepting an order, updating location/status
  - Restaurant admin: dashboard/analytics data correctness, business hours logic (opening/closing edge cases, timezone handling)
  - Address CRUD and "saved address" selection during checkout
  - RTL toggle affecting layout correctly across screens
- For the 3–5 most critical **untested** flows above, write real unit/integration tests (not placeholders) using the project's existing test framework and conventions, and confirm they pass.

## Step 4 — Manual code review (the core of this audit)
Go through the code (not just skimming) for each area below and log every real issue found, with file path + line number:

**Auth & session**
- Token storage: is anything sensitive (auth tokens, refresh tokens) stored in plain AsyncStorage instead of secure storage (Keychain/Keystore/SecureStore)?
- Token refresh / expiry handling — what happens on a 401 mid-session?
- Delete-account flow: does it actually delete/anonymize data, or just sign out? Any orphaned data left behind (addresses, saved cards, order history references)?

**Authorization / role separation**
- Can a customer-role user reach driver/restaurant-admin/admin screens or API calls by manipulating navigation or local state? Are role checks enforced, or only hidden in the UI?
- Are restaurant admins scoped to only their own restaurant's data (no way to query/edit another restaurant's orders or dashboard)?

**Data & API layer**
- Every network call: does it handle loading, error, empty, and timeout states? Look for screens that silently fail or show a blank screen on API error.
- Is there retry/backoff on transient network failures, or does one flaky request break the flow?
- Input validation on forms (phone numbers, addresses, prices/quantities) — client-side AND assume server-side needs to mirror it; flag anything that trusts client input without visible validation.
- Pagination/infinite-scroll edge cases (empty list, single item, exact page boundary).

**Order & payment flow**
- Race conditions: can a user double-tap "place order" and create duplicate orders? Is there idempotency protection?
- Cart state consistency across app restarts / backgrounding.
- If payment is integrated: are card/payment details ever logged, stored locally, or sent anywhere insecurely?

**Real-time / driver tracking**
- What happens if the socket/connection drops mid-delivery? Does the UI recover or get stuck?
- Battery/permission edge cases for background location on the driver app.

**RTL / i18n**
- Check RTL toggle across at least: navigation headers, forms, icons that imply direction (arrows/chevrons), numeric fields (prices, phone numbers), date formatting.
- Look for hardcoded English strings that won't flip with the Arabic/RTL toggle.

**Performance**
- Long lists (menus, order history) — are they using FlatList/virtualization or `.map()` inside ScrollView?
- Unnecessary re-renders (missing memoization on heavy list items, inline function/object props causing re-renders).
- Image loading — any unoptimized/uncompressed images or missing lazy loading for menu/product images.

**Crash & edge cases**
- Airplane mode / offline launch behavior.
- Empty states everywhere (empty cart, no orders yet, no saved addresses, restaurant with zero menu items).
- App backgrounding during checkout or an active order.
- Deep link / notification tap when the app is closed vs. backgrounded — does navigation land in the right place with the right auth state?

**Secrets & config**
- Search the repo for hardcoded API keys, tokens, or backend URLs that should be in env config instead.
- Confirm the production build config doesn't point at dev/staging URLs or include debug flags/logging that leak data.

## Step 5 — Accessibility (quick pass)
- Are interactive elements missing accessible labels (icon-only buttons, custom touchables)?
- Minimum tap target sizes on key CTAs (place order, accept order, etc.)
- Color contrast on primary CTAs against the app's palette.

## Step 6 — Write `QA_REPORT.md`
Structure the report exactly like this:

```markdown
# QA & Pre-Launch Audit Report

## Launch Readiness Verdict
[Go / Go with fixes / No-go] — one paragraph justifying it.

## Summary
- Total issues found: X (Critical: X, High: X, Medium: X, Low: X)
- Test suite status: pass/fail counts, coverage % if available
- Build status: Android / iOS

## Critical Issues (must fix before launch)
### [Issue title]
- File: `path/to/file.tsx:line`
- What's wrong:
- Why it matters:
- Suggested fix:

## High Priority
(same format)

## Medium Priority
(same format)

## Low Priority / Nice-to-have
(same format)

## Missing Test Coverage
- List of critical flows still untested after this audit, and why (e.g. needs backend mocking not currently set up)

## Tests Added During This Audit
- List of new test files/cases added, with what they cover

## Code Changes Made During This Audit
- List of any trivial fixes applied directly, with file:line and a one-line diff summary

## Assumptions Made
- Anything you guessed at instead of asking, and why
```

Every issue must have a real file:line reference — no vague "somewhere in the auth flow" entries. Be honest and specific; do not inflate the report with style nitpicks in the Critical/High sections. Begin now.

# TweetSMS OTP readiness

**Status: the code is ready for one controlled live test. SMS delivery through TweetSMS has not been
verified, because no request has ever been sent to the provider.**

Nothing in this work contacted tweetsms.ps. Every test runs against a stubbed `fetch`, and the
preflight script refuses to send. The trial messages on the account are untouched.

Last reviewed: 2026-09-30. Branch: `agent/phase-15-and-jovo-brand`.

> This document is a description of the code, not evidence about it. Where it makes a claim, the file
> and the test that hold that claim up are named, so the claim can be checked rather than believed.
> A previous revision of this document asserted two things the code did not do; §7 records what they
> were, because a readiness document that has been wrong once should say so.

---

## 1. What already existed

The OTP flow was complete and sound before this work; it had no real SMS provider behind it. In
`apps/api/src/auth`:

| Protection | Where | State |
| --- | --- | --- |
| Cryptographically secure code | `auth.service.ts` — `randomInt(0, 1_000_000)` from `node:crypto` | Pre-existing, unchanged. Six digits, zero-padded; no `Math.random` anywhere. |
| Codes never stored in the clear | `crypto.util.ts` — `hashOtp` = HMAC-SHA256 over `challengeId:phone:purpose:code`, keyed by `OTP_HASH_SECRET` | Pre-existing, unchanged. A database dump yields no usable codes, and a hash is bound to one challenge, number and purpose. |
| Constant-time comparison | `crypto.util.ts` — `safeEqualHex` via `timingSafeEqual` | Pre-existing, unchanged. |
| Expiry | `OTP_EXPIRATION_MINUTES`, default 5 | Pre-existing, unchanged. |
| Single use | `consumedAt`, set in the same Serializable transaction that creates the account or reset token | Pre-existing, unchanged. |
| Attempt limit | `OTP_MAX_ATTEMPTS`, default 5, per challenge | Pre-existing, unchanged. |
| Resend cooldown | `OTP_RESEND_COOLDOWN_SECONDS`, default 60, per number *and* purpose | Pre-existing. Now also applies after a failed send — see §2. |
| Daily send budgets | `OTP_MAX_PER_PHONE_PER_DAY` (10), `OTP_MAX_GLOBAL_PER_DAY` (2000), rolling 24h, across every purpose | Pre-existing. Now counts every provider attempt — see §2. |
| Request throttling | `auth.controller.ts` — `@Throttle` 5/min on both request-code endpoints, 10/min on verify | Pre-existing, unchanged. |
| Codes never returned to or logged by clients | Response bodies carry phone/expiry/cooldown only | Pre-existing, unchanged. |
| Provider abstraction | `otp.provider.ts` — the `OtpProvider` interface plus log-only and generic-webhook adapters | Pre-existing. The TweetSMS adapter plugs into this seam; no parallel system was built. |

## 2. What changed, and what each change actually guarantees

### The TweetSMS adapter — `apps/api/src/auth/tweetsms.provider.ts` (new)

POSTs `application/x-www-form-urlencoded` with `api_key`, `sender`, `message`, `to`.

- **A send is successful only on a 2xx response whose parseable JSON body carries the documented code
  `999` without an error status.** HTTP 200 alone is never success: a 200 with an HTML page, a
  different code, no code, a truncated body, or a JSON array are all failures.
  (`interpretTweetSmsResponse`; tests: "HTTP 200 with an unrecognized provider code…", "…HTML error
  page…", "truncated JSON, and a JSON array body…", "code 999 on a 500 response…")
- **One HTTP request per send. No retries, anywhere.** (`send`; asserted by
  `assert.equal(calls.length, 1)` in the timeout, 5xx and refusal tests.)
- The synthetic `message_id` / `data` / `cost` fields from the Postman AI examples are never read.
- Uncertain provider behaviour is a named setting, not a code path (§5).

### Conservative failure classification — finding 2

`OtpDeliveryOutcome` has two values, and **both are diagnostic only**:

- `REFUSED` — a rejection with specific provider evidence behind it.
- `UNCONFIRMED` — everything else.

Only **one** code is classified `REFUSED`: `-110`, the authentication failure actually observed
(`{"status":"error","code":-110,"msg":"User name and password Wrong"}`). It lives in a one-entry
`evidencedRefusals` map with the reasoning written next to it.

Everything else is `UNCONFIRMED`, including things an earlier revision claimed as proof that nothing
was queued:

| Response | Earlier | Now | Why |
| --- | --- | --- | --- |
| `code: -110` | REFUSED | REFUSED | The one observed rejection. Credentials the gateway will not authenticate cannot have queued a message. |
| Any other negative code | REFUSED | **UNCONFIRMED** | We have no code list from TweetSMS. Another negative number could as easily mean "queued, then dropped". |
| `status: "error"` with no code | REFUSED | **UNCONFIRMED** | Names no code at all. |
| HTTP 4xx | REFUSED | **UNCONFIRMED** | A 4xx can come from a proxy, a WAF, or from the gateway after it had already handed the message on. |
| HTTP 5xx, timeout, unreadable body | UNCONFIRMED | UNCONFIRMED | Unchanged. |

Tests: "another negative code is NOT treated as proof that nothing was queued", "a bare error status
with no code stays unconfirmed", "an HTTP 4xx is not proof that nothing was queued".

**The guarantee:** the adapter never asserts that a message was not queued or not charged unless a
specific observed provider response says so, and even then the assertion buys no relaxation of any
control (below).

### Every provider attempt stays bounded — finding 1

An earlier revision deleted the challenge row when a send looked refused. That removed both the
resend cooldown and the row's slot in the daily budgets — which made provider calls effectively
unbounded: against a gateway that refuses everything (a wrong API key, or an attacker's choice of
target), a caller could loop as fast as it could issue requests, and each iteration was one outbound
HTTP request to TweetSMS.

**That deletion is gone.** `auth.service.ts` now does nothing at all on a delivery failure except let
it propagate. So:

- One request → one committed challenge row → one provider call. No row is ever removed.
- The resend cooldown (60s per number per purpose) applies after a failure exactly as after a success.
- Both daily budgets count challenges *created*, so they count provider attempts — accepted, refused,
  and unanswered alike.
- No outcome value grants an exemption. A refusal is our inference, not a receipt from the gateway's
  billing system, so it cannot buy back an attempt.

Tests in `auth.service.test.ts`:

| Test | What it pins |
| --- | --- |
| "a refused send fails the request and still costs the attempt" | 1 provider call, 0 users, **1 challenge row retained**, and the next request meets `OTP_RESEND_COOLDOWN` without reaching the gateway |
| "repeated refusals are bounded by the per-number daily budget, not by the gateway" | 3 refusals exhaust `OTP_MAX_PER_PHONE_PER_DAY=3`; the 4th returns `OTP_DAILY_LIMIT_REACHED` and makes no provider call |
| "repeated refusals across many numbers are bounded by the platform ceiling" | `OTP_MAX_GLOBAL_PER_DAY=2` stops a distributed source at 2 provider calls |
| "concurrent requests for one number produce exactly one provider call" | 3 simultaneous requests → 1 fulfilled, 2 × `OTP_RESEND_COOLDOWN`, **1** message |
| "concurrent requests against a refusing gateway also make exactly one call" | The loser of the race is stopped by the cooldown, not by the gateway |
| "an unconfirmed send failure keeps the cooldown, so one code is never sent twice" | The row and its cooldown survive a timeout |
| "a code that was never delivered still cannot be verified or guessed" | A retained row behaves like any other challenge: a wrong code is `OTP_INVALID`, no account is created |

The cost of this, stated plainly: a refused attempt consumes one slot of the number's daily budget
even though probably nothing was sent. That is the deliberate trade — it is what makes the bound
real — and it is why the preflight script exists (§6), so configuration mistakes are found without
spending attempts.

### Logging — finding 5

Provider-supplied text is no longer redacted. **It is no longer read at all.** Nothing in the adapter
consults `msg` or `message`, and `TweetSmsVerdict` has no field that can hold free text, so there is
no path by which a gateway's wording — echoing our message, quoting our request — could reach a log
line. Redaction by pattern was the wrong instrument: it is a guess about the shape of a string an
outside party controls.

A log line contains exactly: `event`, `purpose`, masked `phone` (`+970***567`), `httpStatus`,
`providerCode`, and for failures `reason` and `outcome`. `providerCode` is either `/^-?\d{1,9}$/` or
the literal `NONE`; `reason` comes from the closed `tweetSmsFailureReasons` set
(`AUTH_REJECTED`, `PROVIDER_ERROR_STATUS`, `UNEXPECTED_CODE`, `MISSING_CODE`, `UNREADABLE_BODY`,
`HTTP_ERROR`, `RESPONSE_READ_FAILED`, `TIMEOUT`, `NETWORK_ERROR`).

Tests capture the real Nest logger output: "a hostile provider message cannot put the API key or the
OTP into a log line" feeds a response whose `msg` contains both the API key and the OTP, then asserts
the emitted line contains neither, omits the full phone number, and has exactly the seven expected
keys. "every logged reason comes from the closed set…" checks the invariant across five response
shapes; "a successful send logs the status and the code, and nothing else" checks the success line.

**Diagnostic consequence, deliberately accepted:** if the live test returns an unexpected code, our
logs give the number but not the provider's wording. Read the wording from the TweetSMS dashboard, or
quote the code to their support. We do not put a third party's text in our logs to save that step.

### Fail-closed provider selection — finding 3

The provider choice moved out of the module into `apps/api/src/auth/otp.provider.factory.ts` so it is
directly testable. `createOtpProvider` has no default branch and no rescue path:

- `tweetsms` with a missing API key or sender → throws (`getOrThrow`).
- `tweetsms` with a plain-HTTP endpoint, a template lacking `{{code}}`, an over-length template, or a
  non-positive timeout → throws (the adapter's constructor re-runs `assertUsableTweetSmsOptions`).
- An unrecognised provider name → throws.
- **In no case is a development provider returned instead.** Test: "a broken TweetSMS configuration
  never falls back to the development provider" walks four broken configurations and asserts each
  throws and none yields a `DevelopmentOtpProvider`.

`validateEnvironment` checks the same values at boot using the same assertion, so a misconfiguration
usually stops the process even earlier.

### What is deployed, and where the log-only provider can still run — finding 3

The earlier revision of this document claimed deployed environments could not use the development
provider. **That claim was wrong**, and the code matched the claim only for `NODE_ENV=production`.
The Azure trial runs the production container image with `NODE_ENV=development` set as an App Service
application setting, deliberately (`TRIAL_DEPLOY_CHECK.md` lines 81–124) — so the guard did not cover
the trial at all, and the trial has in fact been reading verification codes out of its log stream (the
`trial-config-audit` workflow counts `[DEV OTP]` lines).

What is true now:

- `isDeployedEnvironment` in `config/environment.ts` treats the environment as deployed if **any** of:
  `DEPLOYMENT_ENV` is `trial` or `production`; `WEBSITE_SITE_NAME` or `WEBSITE_INSTANCE_ID` is present
  (Azure App Service injects these into every container it runs, so the trial is detected whether or
  not anyone set `DEPLOYMENT_ENV`); or `NODE_ENV=production`.
- With the development provider on a deployed environment, the factory logs a warning naming the risk
  (`otp_development_provider_on_deployed_environment`).
- Setting **`OTP_REQUIRE_REAL_PROVIDER=true`** makes that combination a **boot failure**, checked both
  in `validateEnvironment` and in the factory.
- `OTP_REQUIRE_REAL_PROVIDER` defaults to `false`, so this change **does not stop the existing trial
  from booting**. Turning it on is a one-setting change and is in the list in §5.

So the accurate statement is: *a deployed environment can still be configured to use log-only OTP
unless `OTP_REQUIRE_REAL_PROVIDER=true` is set; `NODE_ENV=production` refuses it unconditionally.*
Tests: "Azure App Service is detected as deployed even with NODE_ENV=development",
"OTP_REQUIRE_REAL_PROVIDER turns a deployed log-only provider into a boot failure", "on a deployed
environment the development provider warns, and is refused when required".

### Customer-facing OTP copy — finding 4

`apps/mobile/src/i18n/locales/{en,ar}/auth.json`:

- `otp.smsHelp` (new, always shown): "We sent the code by SMS to this number. It can take up to a
  minute to arrive." / "أرسلنا الرمز برسالة نصية إلى هذا الرقم. قد يستغرق وصوله حتى دقيقة واحدة."
- `otp.devCodeHelp` (rewritten, shown only when `__DEV__`): "Local development build: no SMS is sent.
  The code is printed in the API terminal."
- `forgotPassword.subtitle`: "We will create a free development verification code" → "We will send a
  verification code by SMS" / "سنرسل رمز تحقق برسالة نصية".

In `screens.tsx` the development line is wrapped in `{__DEV__ ? … : null}`, the same gate
`core/api.ts` already uses, so a release build cannot render it. Locale key parity is enforced by
`i18n/locales.test.ts`, which passes.

### Also changed

`.env.example`, `.env.production.example` (placeholders for the new settings),
`.github/workflows/trial-config-audit.yml` (the read-only Azure report now lists `DEPLOYMENT_ENV`,
`OTP_REQUIRE_REAL_PROVIDER` and the TweetSMS settings' presence, and counts `tweetsms_send` lines by
reason — it changes no setting), `apps/api/src/auth/testing/fake-prisma.ts` (the challenge
`deleteMany` added for the removed deletion path is gone again), and `README.md`.

## 3. Validation actually run

2026-09-30, all with stubbed HTTP. No request reached tweetsms.ps.

| Check | Result |
| --- | --- |
| `npm test --workspace @wasel/api` | **689 tests: 678 passed, 0 failed, 11 skipped** (the skips are the Postgres-backed e2e files, which skip without `RUN_DATABASE_E2E`) |
| `npm test --workspace @wasel/admin` | 143 passed, 0 failed |
| `npm test --workspace @wasel/mobile` | 263 unit passed + 194 UI passed, 0 failed |
| `npm run typecheck` (all three workspaces, `tsc --noEmit`) | clean |
| `npm run build` (all three) | clean — api `prisma generate && tsc`, admin bundle, Expo web/Android/iOS export |
| `npm run security:scan` | passed, 5277 tracked files |
| `release-readiness.mjs` production env validation, TweetSMS config, dummy credentials in a throwaway file outside the repo | passed |
| `npm run otp:tweetsms:preflight … +970591234567` | printed the request, sent nothing |

Focused counts, each run on its own: `tweetsms.provider.test.ts` 27 passed,
`otp.provider.factory.test.ts` 10 passed, `environment.test.ts` 22 passed, `otp.provider.test.ts` 3
passed (pre-existing, unchanged). The delivery-failure and concurrency block of
`auth.service.test.ts` is 9 tests, all named in the table above and all passing. Pre-existing OTP coverage
re-confirmed: successful signup and verification, wrong code with a decreasing attempt count, expired
code, reused code, the attempt ceiling, the resend cooldown, resend invalidating the older code, and
the per-phone and platform daily ceilings.

**Not run:** the Postgres-backed e2e suite (needs a database; covers no OTP-delivery path); the
remaining `release:check` stages, which re-run the lint/typecheck/test/build above; and no live SMS
test, by instruction.

## 4. What is *not* guaranteed

Stated plainly, because the rest of this document is about what is:

- **That TweetSMS accepts our request.** The recipient format, the optional fields, and whether
  `api_key` is the right credential are all unverified.
- **That the real success response is the one we match on.** If TweetSMS signals success some other
  way, the first live send is reported as a failed delivery. The error falls in the safe direction,
  and the log line names the code that came back.
- **That an accepted message reaches the handset.** The strongest claim the code makes is "the gateway
  accepted it". There is no delivery-receipt handling, so an accepted-but-undelivered message looks
  like success server-side.
- **That a failed send cost nothing.** Except for code `-110`, we do not know. This is why every
  attempt is counted.

## 5. Remaining provider uncertainties

Each is isolated behind one setting; none can be settled without a real send.

| Unknown | What the code does | How to settle it |
| --- | --- | --- |
| **The shape of a successful response.** Only "code 999 = success" is documented; the Postman success example is synthetic. | Accepts only `code: 999` (number or numeric string) in a parseable JSON body on a 2xx with no `status:"error"`. | The live test. The log line records the `providerCode` actually seen. |
| **Whether `groups`/`date`/`time` may be omitted.** | Omitted. An empty `date`/`time` could be read by the gateway as a scheduled send, which is worse than a rejection. | If the request is rejected, set `TWEETSMS_SEND_OPTIONAL_FIELDS=true` and repeat. |
| **The recipient number format.** | `digits` — `970591234567`. The body is form-encoded, where a literal `+` is ambiguous with an encoded space. | Try `TWEETSMS_RECIPIENT_FORMAT=e164` (sent as `%2B970…`), then `local` (`0591234567`). |
| **Non-ASCII message text.** | Default template is ASCII English. | Set `TWEETSMS_MESSAGE_TEMPLATE` to Arabic copy and spend one message confirming it arrives intact. |
| **What any code other than 999 and -110 means.** | Every other code is `UNCONFIRMED`: no claim is made about queueing or cost. | Ask TweetSMS for their code list, then extend `evidencedRefusals` only for codes they document as pre-queue rejections. |
| **Whether `api_key` is the accepted credential.** The observed error says "User name and password Wrong", hinting the account may take a username/password pair instead. | Sends `api_key` only, as the collection lists. | If a key you are confident in returns `-110`, ask the provider which credential the account uses. |
| **Rate limits, throughput, per-message cost.** | Our own ceilings apply (§2). | Ask the provider, then size `OTP_MAX_GLOBAL_PER_DAY` to the budget. |
| **Delivery reporting.** | Not implemented. | Ask about delivery receipts before relying on OTP beyond signup and password reset. |

## 6. Server configuration

Server-side only. Never prefixed `EXPO_PUBLIC_` or `VITE_`, never in a client bundle, never committed.

Required for TweetSMS:

```
OTP_PROVIDER=tweetsms
TWEETSMS_API_KEY=<from the TweetSMS account>
TWEETSMS_SENDER=<the sender name TweetSMS approved for this account>
```

Optional, with the defaults that apply if unset:

```
TWEETSMS_BASE_URL=https://tweetsms.ps/api.php/maan/sendsms
TWEETSMS_TIMEOUT_MS=8000
TWEETSMS_RECIPIENT_FORMAT=digits          # digits | e164 | local
TWEETSMS_MESSAGE_TEMPLATE=JOVO verification code: {{code}}. Do not share it.
TWEETSMS_SEND_OPTIONAL_FIELDS=false
```

Deployment identity and the log-only-provider gate:

```
DEPLOYMENT_ENV=trial                      # local | trial | production
OTP_REQUIRE_REAL_PROVIDER=true            # refuse to boot on a deployed env with log-only OTP
```

Unchanged and still required: `OTP_HASH_SECRET` (≥32 random characters, different from both JWT
secrets), `OTP_EXPIRATION_MINUTES`, `OTP_RESEND_COOLDOWN_SECONDS`, `OTP_MAX_ATTEMPTS`,
`OTP_MAX_PER_PHONE_PER_DAY`, `OTP_MAX_GLOBAL_PER_DAY`. `OTP_WEBHOOK_*` are unused with
`OTP_PROVIDER=tweetsms`.

Notes: `TWEETSMS_BASE_URL` must be HTTPS in every environment, because the key is in the request
body. `TWEETSMS_SENDER` is 1–20 characters starting with a letter or digit, and must be the approved
name. Nothing in Azure has been changed by this work.

### Proposed temporary Trial budget for one controlled test — not applied

These are a **proposal for the operator to apply**, not settings this work has changed anywhere. They
shrink the blast radius of the trial account's small message allowance while the one test happens,
because — per §2 — a refused or unanswered attempt consumes budget just as a successful one does.

```
OTP_MAX_PER_PHONE_PER_DAY=3
OTP_MAX_GLOBAL_PER_DAY=5
OTP_RESEND_COOLDOWN_SECONDS=60      # the default; do not lower it for the test
```

Why these numbers: one successful test needs exactly one message. Three per number leaves room for
two format corrections (§5) on the same test phone before that number is locked out for the day, and
five platform-wide caps the total exposure at five messages even if something loops — while leaving
the rest of the trial allowance intact. If the per-number ceiling is reached mid-test, either use a
second test number or raise `OTP_MAX_PER_PHONE_PER_DAY` deliberately; do not remove the ceiling.

**Restore the defaults (10 / 2000) after the test**, or real customers will hit these limits.

## 7. Corrections to the earlier revision of this document

Both were claims about behaviour that the code did not have:

1. **"On a `REFUSED` send the challenge row is deleted… the customer can ask again immediately."**
   True of the code at the time, and wrong to do: it left provider calls unbounded, since the deleted
   row released both the cooldown and its daily-budget slot. The deletion is gone (§2).
2. **"No environment can silently fall back to log-only codes"** and "there is no path by which a
   deployed environment silently falls back". The guard checked only `NODE_ENV=production`, and the
   Azure trial runs `NODE_ENV=development` on purpose, so the trial was precisely such a path. Now
   described accurately, with `OTP_REQUIRE_REAL_PROVIDER` to close it (§2).

The document also implied that redacting digit runs from provider messages protected the OTP and the
API key in logs. Pattern-matching a string a third party controls is not protection; provider text is
now never carried at all (§2).

## 8. The one controlled live test

Budget: **one** message if all goes well. With the §6 budget applied, the ceiling is five.

**Before spending anything**

1. Apply the §6 settings, including the temporary Trial budget, and `OTP_REQUIRE_REAL_PROVIDER=true`
   now that a real provider is configured.
2. Restart the API and confirm it booted. A configuration mistake stops the boot naming the setting —
   that costs no message.
3. Run the preflight from the same configuration. It sends nothing:
   ```
   npm run otp:tweetsms:preflight --workspace @wasel/api -- +970XXXXXXXXX
   ```
   Check the endpoint, the sender, and that `to` reads the way TweetSMS expects.
4. Open the API logs, filtered to `tweetsms_send`.

**The test**

5. In the JOVO app, on that phone, open **Create Customer Account**, enter that number with a new
   name and password, and submit. This sends exactly one message.
6. Expect one of:
   - The app moves to the code screen **and** the log shows
     `{"event":"tweetsms_send",…,"providerCode":"999"}` with no `reason`. The gateway accepted it.
   - The app shows "The verification code could not be sent. Please try again." and the log shows
     `reason` and `providerCode`. Use §5 to pick the setting to change. **Note the 60-second cooldown
     and that the attempt consumed one slot of the number's daily budget** — that is by design.
7. If a message arrives, enter the code. A successful verification logs you in as the new customer:
   generated, hashed, sent by TweetSMS, delivered, verified, consumed.
8. Spend no further messages on the negative paths — the automated tests cover them. Free checks: a
   wrong code (attempt count drops), then the correct code again (`OTP_ALREADY_USED`).
9. Record here: the exact success body, the recipient format that worked, whether the optional fields
   were needed, the wording as it appeared on the handset, and any unexpected `providerCode`.
10. Restore `OTP_MAX_PER_PHONE_PER_DAY=10` and `OTP_MAX_GLOBAL_PER_DAY=2000`.

## 9. Is the code ready for that test?

**Yes.** Ready means: the adapter is implemented and typechecks; success is recognised only on the
documented code 999; a failure never reads as success to the customer; no send is ever retried, so the
server cannot generate a duplicate message; every provider attempt — accepted, refused or unanswered —
is bounded by the same cooldown and the same daily ceilings; credentials are server-only and validated
at boot; logs carry only controlled values; selecting `tweetsms` with a broken configuration fails to
boot rather than falling back; and the pre-existing OTP protections are intact and still tested.

Ready does **not** mean verified delivery. §4 lists what is still unknown, and none of it can be
settled without sending one real message.

**Code readiness: established. SMS delivery: unverified, and unverifiable until one real message is
sent.**

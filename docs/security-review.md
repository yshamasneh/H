# Phase 8 security review

Review date: 2026-08-06

## Scope and result

The review covered the NestJS REST/WebSocket API, authentication and authorization boundaries, Prisma/PostgreSQL access, the shared Expo client, the production container path, secrets, observability, and backup/restore handling. The repository now has enforceable production defaults rather than documentation-only advice.

Resolved findings:

- Production startup rejects wildcard/non-HTTPS CORS, reused/default secrets, the terminal OTP provider, missing monitoring credentials, and missing error tracking.
- REST and Socket.IO now use the same explicit origin allowlist. Direct non-HTTPS application traffic is rejected behind a trusted proxy; liveness and protected metrics remain reachable on the private container network.
- Helmet/HSTS, removal of `X-Powered-By`, a small request body limit at Nginx, request throttling, and no-store API responses reduce common exposure.
- Logs are one-line JSON with request IDs, status/duration fields, and recursive secret redaction. Exception responses never include stacks; sanitized 5xx events can be sent to a dedicated HTTPS error-tracking bridge.
- `/health/live` and `/health/ready` are separate. `/api/v1/metrics` is Prometheus-compatible and protected with a constant-time token check.
- Production OTP delivery uses an authenticated HTTPS webhook and never logs OTP values. Development OTP output remains forbidden in production.
- Android production configuration disables backup and cleartext traffic, removes broad storage/overlay permissions, enables minification/resource shrinking, and no longer signs release builds with the debug key.
- The production API container runs as a non-root user, has a read-only filesystem, drops Linux capabilities, and receives traffic only through the TLS reverse proxy.
- Database backups use `pg_dump` custom archives, SHA-256 sidecars, retention, and a restore command that ignores `DATABASE_URL` and requires the target database name as explicit confirmation.

## Existing controls verified

- Passwords use Argon2id; OTPs use an HMAC keyed separately from JWT secrets; refresh/reset tokens are stored hashed.
- Access and refresh JWT types are separated, refresh rotation is conditional/atomic, and password reset revokes existing sessions through `tokenVersion`.
- DTO whitelisting rejects unknown fields, prices are computed server-side, and order/delivery state transitions use explicit allowlists and race-safe conditional writes.
- Customer, restaurant, driver, and admin access is checked on the server. Cross-tenant resource probes return generic not-found responses.
- WebSocket connections verify the same session state and role facts as REST before room membership.

## Accepted or external risks

- Restaurant and driver phone numbers remain self-attested during registration. Their accounts cannot become publicly/operationally active until admin approval, but the approval procedure must include an out-of-band identity/phone check.
- The built-in throttler is process-local. The supplied deployment runs one API replica; horizontal scaling requires a shared Redis-compatible throttler store before adding replicas.
- The generic OTP and error-tracking webhooks require an operator-owned bridge or vendor adapter. Provider contracts, data-processing terms, geographic routing, and delivery SLAs are deployment decisions.
- Mobile/web tokens can still be stolen by a compromised device or successful XSS. Native tokens use SecureStore; web tokens use sessionStorage, are cleared when the tab session ends, and must be protected by the supplied CSP and dependency patching.
- Payment and continuous driver-location processing are not enabled. A new security/privacy review is required before either feature is introduced.
- Legal policy text in this repository is an operational product draft, not jurisdiction-specific legal advice. The operator must approve it before store submission.

## Release gate

Do not publish unless every item in `docs/launch-checklist.md` is checked, `npm run release:check` passes against the real `.env.production`, a restore drill has succeeded on an isolated database, and closed-test sign-off is recorded.

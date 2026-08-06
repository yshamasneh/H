# Phase 8 launch checklist

## Automated release gate

- [ ] Copy `.env.production.example` to `.env.production` and replace every placeholder with operator-owned values.
- [ ] `npm run release:check -- --env-file=.env.production` passes.
- [ ] `npm run prod:config` renders the expected services and mounts without exposing secret values in logs.
- [ ] CI passes lint, typecheck, tests, build, Prisma validation/migration replay, API production audit, and container builds.

## Infrastructure and security

- [ ] DNS and valid auto-renewing TLS certificate are active; HTTP redirects to HTTPS.
- [ ] Database role is least-privilege, TLS/storage encryption are enabled, and the database is not exposed publicly.
- [ ] Production JWT, OTP hash, OTP bridge, monitoring, and error-tracking secrets are unique and stored outside Git.
- [ ] CORS contains only the actual HTTPS app origins; Swagger is absent in production.
- [ ] Monitoring alerts and the error-tracking destination received a controlled test event.
- [ ] Daily off-host backup job succeeded and an isolated restore drill was signed off.
- [ ] Admin users and restaurant/driver approval procedures received an access review.

## Product smoke test

- [ ] Customer verifies phone, signs in, browses an approved/open restaurant, places an order, sees realtime status changes, and can read notifications.
- [ ] Restaurant sees only its orders, accepts/prepares/marks ready, and cannot perform an invalid transition.
- [ ] Approved online driver sees an available delivery, claims it atomically, and completes pickup/on-the-way/delivered.
- [ ] Admin approves/suspends actors, searches orders/users, performs a reasoned cancellation, and sees the audit record.
- [ ] Reconnect/relaunch re-fetches REST state correctly; expired access and rotated refresh tokens behave as expected.
- [ ] OTP failure, database unavailability, and provider timeout paths show safe user errors without secrets or stacks.

## Store and legal sign-off

- [ ] Operator legal name, address, support contact, governing law, cancellation/refund rules, and complaint path are inserted into the policies and approved by local counsel.
- [ ] Privacy/terms/support pages are published at stable HTTPS URLs and entered in both stores.
- [ ] Data Safety/App Privacy declarations match the release binary and selected processors.
- [ ] App icon, screenshots, feature graphic, descriptions, category, age/content rating, and dedicated review account are uploaded.
- [ ] Android closed testing and iOS TestFlight cover supported OS/device sizes; crash-free and four-role sign-off are recorded.
- [ ] Production signing is store/EAS-managed; no debug certificate or development account is present in a release artifact.

## Go/no-go

- [ ] Product owner, operations, engineering, security/privacy, and legal approvers record GO.
- [ ] On-call owner, rollback image, incident channel, provider contacts, and launch monitoring window are confirmed.

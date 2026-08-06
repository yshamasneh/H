# Production operations runbook

## Deployment prerequisites

- A Linux host with Docker Engine and Compose, DNS for the public app host, and valid TLS certificate/key files.
- A supported PostgreSQL database with a dedicated least-privilege application role and automated provider snapshots in addition to application-level dumps.
- HTTPS endpoints for OTP delivery and error tracking, each with a dedicated bearer token.
- A secret manager or protected host environment file. Never place `.env.production`, TLS keys, backup archives, or provider credentials in Git.

Copy `.env.production.example` to `.env.production`, replace every placeholder, and validate without revealing values:

```bash
npm run prod:config
npm run release:check -- --env-file=.env.production
```

## Deploy

1. Point DNS at the host and place the TLS files at the paths configured by `TLS_CERTIFICATE_PATH` and `TLS_PRIVATE_KEY_PATH`.
2. Back up the database before a release that contains migrations.
3. Run `npm run prod:up`. The one-shot `migrate` service must finish successfully before the API starts; the web proxy waits for the API health check.
4. Verify the endpoints through the public hostname:

```bash
curl -fsS https://YOUR_HOST/api/v1/health/live
curl -fsS https://YOUR_HOST/api/v1/health/ready
curl -fsS -H "x-monitoring-token: $MONITORING_TOKEN" https://YOUR_HOST/api/v1/metrics
```

5. Run the four-role smoke test in `docs/launch-checklist.md` and watch structured logs/error tracking during the test.

The API and mobile web bundle are immutable images. Swagger is disabled in production. PostgreSQL is external to the supplied production Compose file so database lifecycle and application lifecycle cannot accidentally erase each other.

## Monitoring and alerts

Scrape `/api/v1/metrics` over the private network or HTTPS with `x-monitoring-token`. Alert on:

- readiness failing for 2 consecutive minutes;
- 5xx responses above 2% for 5 minutes;
- p95 latency above 1.5 seconds for 10 minutes;
- OTP delivery failures or error-tracking delivery failures;
- disk utilization above 80%, certificate expiry below 21 days, or no successful backup within 26 hours.

Every API response and completion log has `x-request-id`/`requestId`. Use that value to correlate a support report with logs and error events. Logs intentionally omit bodies, query strings, authorization headers, cookies, passwords, tokens, and OTPs.

## Backup and restore

Install PostgreSQL client tools on the backup runner. Schedule a daily command with `DATABASE_URL`, `BACKUP_DIRECTORY`, and `BACKUP_RETENTION_DAYS` supplied by the secret/scheduler environment:

```bash
npm run db:backup
```

Copy both `.dump` and `.dump.sha256` to encrypted off-host storage. The local retention default is 14 days; set provider lifecycle retention independently.

Verify an archive without touching a database:

```bash
npm run db:restore -- --file=backups/tasawaq-TIMESTAMP.dump --verify-only
```

For the quarterly restore drill, create an isolated empty database and set `RESTORE_DATABASE_URL` to that database only. The command refuses to use `DATABASE_URL` and requires the target database name:

```bash
npm run db:restore -- --file=backups/tasawaq-TIMESTAMP.dump --confirm-restore=tasawaq_restore_drill
```

After restore, apply migrations, start a temporary API against the restored database, verify `/health/ready`, sign in with a designated test account, and confirm order/status-history counts. Record archive name, checksum, duration, and tester in the launch checklist or incident system.

## Incident response

1. Confirm impact through readiness, metrics, and recent deployment/provider status.
2. Preserve request IDs and relevant sanitized logs. Do not paste secrets or database exports into tickets.
3. If credentials may be exposed, rotate provider tokens and JWT secrets. Rotating JWT secrets logs out all users; also increment user token versions when targeted session invalidation is required.
4. For a bad application release, redeploy the last known-good image. Never reverse a database migration blindly; use a reviewed forward fix or restore into a new database and switch only after validation.
5. Notify affected users and regulators according to the approved privacy policy and applicable law.
6. Write a blameless incident review with timeline, impact, root cause, resolution, and prevention actions.

## Routine maintenance

- Weekly: review 4xx/5xx trends, OTP delivery rates, admin audit logs, and dependency alerts.
- Monthly: patch base images and dependencies, rebuild, run the full release gate, and test certificate renewal.
- Quarterly: restore drill, access review, secret rotation where practical, and review restaurant/driver approvals.
- Before enabling payments, push tokens, maps, or continuous location: complete a separate threat/privacy review and update policies.

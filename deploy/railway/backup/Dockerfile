# syntax=docker/dockerfile:1.7
# The Railway cron service "backup" (docs/railway-setup.md, "Backups"). Built from this folder alone:
#   railway up deploy/railway/backup --path-as-root --service backup
# The same image runs restore.mjs and restore-test.mjs on an operator machine.
FROM node:22-trixie-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# pg_dump must be at least the server's major version (PostgreSQL 18 on Railway).
FROM postgres:18
RUN apt-get update \
  && apt-get install -y --no-install-recommends age ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# Node 22 (LTS) from the official image; both stages are Debian trixie, so the binary is compatible.
COPY --from=dependencies /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json lib.mjs backup.mjs fetch-backup.mjs restore.mjs restore-test.mjs ./
USER postgres
ENTRYPOINT []
CMD ["node", "backup.mjs"]

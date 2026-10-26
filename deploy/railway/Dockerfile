# syntax=docker/dockerfile:1.7
# Railway image for the API (see docs/railway-setup.md). Railway builds the last stage of a
# Dockerfile and cannot pick a --target, so this mirrors the root Dockerfile's `runtime` stage and
# additionally ships the Prisma schema, migrations and config: Railway's pre-deploy command
# (`prisma migrate deploy`, railway.json) runs inside this image once per deploy, before traffic
# moves, instead of on every container start. Keep the shared stages in step with ../../Dockerfile,
# which Azure keeps building unchanged.
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/mobile/package.json apps/mobile/package.json
RUN npm ci

FROM dependencies AS build
COPY apps/api apps/api
ENV DATABASE_URL=postgresql://build:build-only-password@localhost:5432/build
RUN npm run build --workspace @wasel/api

FROM build AS production-dependencies
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
# Reported by /health as `commit`. Railway passes a service variable named GIT_SHA in as this build
# argument; docs/railway-setup.md sets it to the commit being deployed.
ARG GIT_SHA=""
ENV GIT_SHA=$GIT_SHA
ENV NODE_ENV=production
# Store opening hours are compared against the server's local wall clock; see ../../Dockerfile.
ENV TZ=Asia/Hebron
WORKDIR /app/apps/api
COPY --from=production-dependencies --chown=node:node /app/node_modules /app/node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
COPY --from=build --chown=node:node /app/apps/api/package.json ./package.json
# Only what `prisma migrate deploy` reads: no seed data is run from this image.
COPY --from=build --chown=node:node /app/apps/api/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=node:node /app/apps/api/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=build --chown=node:node /app/apps/api/prisma/migrations ./prisma/migrations
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]

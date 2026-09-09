# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/mobile/package.json apps/mobile/package.json
RUN npm ci
# package-lock.json is committed from Windows development machines, which never records the
# Linux build of Rollup's native binary — a known npm bug (npm/cli#4828) where a lockfile's
# platform-specific optional dependencies only cover the platform(s) `npm install` has actually
# run on. `vite build` (admin's build tool) needs it and fails inside this Linux image with
# "Cannot find module @rollup/rollup-linux-x64-gnu" without this. Installing it directly by exact
# version — matching the "rollup" entry's own optionalDependencies in package-lock.json, so a
# rollup bump here means bumping this too — avoids re-resolving (and risking drift in) the rest
# of the workspace tree, which deleting/regenerating the lockfile would require.
RUN npm install --no-save --no-audit --no-fund @rollup/rollup-linux-x64-gnu@4.62.4
COPY apps/admin apps/admin
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build --workspace @wasel/admin

FROM nginx:1.27-alpine
COPY deploy/nginx/admin.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
EXPOSE 80 443
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1

# ---------- build: install deps + build the React client ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --no-audit --no-fund
COPY . .
# The build runs scripts/check-changelog.js first: a malformed CHANGELOG.json fails here, and so does the deploy.
# 0.10.2: CHANGELOG_TARGET (production in docker-compose.yml, dev in docker-compose.dev.yml) also refuses dev builds
# left in production's changelog, i.e. a dev → main promotion that skipped scripts/release.js. A failed build changes
# nothing that is running.
ARG CHANGELOG_TARGET=
RUN CHANGELOG_TARGET="$CHANGELOG_TARGET" npm run build && npm prune --omit=dev --no-audit --no-fund

# ---------- runtime: one image, two entrypoints (web + worker) ----------
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    LISTEN_HOST=0.0.0.0 \
    PORT=3260 \
    WORKER_PORT=3261
# pg_dump / pg_restore for the worker's nightly backups (server/core/backup.js). The client must be at least the
# server's major version (postgres:17 in docker-compose.yml), and Debian bookworm only ships 15, so it comes from the
# PostgreSQL project's own apt repository (apt.postgresql.org, signed with its published key).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-17 \
 && apt-get purge -y curl && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* \
 && pg_dump --version | grep -q ' 17\.'
WORKDIR /app
# CHANGELOG.json is the app version at run time (server/core/version.js) and what /api/health reports. Don't drop it.
COPY --from=build /app/package.json /app/CHANGELOG.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/client/package.json ./client/package.json
COPY --from=build /app/client/dist ./client/dist
# 0.8.0: share cards draw badges from the same verbatim art the site uses (server/cards/badgeSvg.js).
COPY --from=build /app/client/src/badges/art ./client/src/badges/art
COPY --from=build /app/client/src/guildBadges/art ./client/src/guildBadges/art
# 0.8.0: the share-card renderer (server/cards/render.js): Playwright's chromium headless shell, at the exact build the
# pinned playwright-core expects, plus the system libraries and fonts it needs (--with-deps runs apt as root, here).
# Installed where the non-root node user can read it. The web container uses it; the worker image carries it too.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN node node_modules/playwright-core/cli.js install --with-deps --only-shell chromium \
 && rm -rf /var/lib/apt/lists/* \
 && chmod -R a+rX /ms-playwright
USER node
EXPOSE 3260 3261
# Default: the web app. docker-compose.yml overrides the command for the worker.
CMD ["node", "server/index.js"]

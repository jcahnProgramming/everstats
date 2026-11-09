# ---------- build: install deps + build the React client ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --no-audit --no-fund
COPY . .
# The build runs scripts/check-changelog.js first: a malformed CHANGELOG.json fails here, and so does the deploy.
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

# ---------- runtime: one image, two entrypoints (web + worker) ----------
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    LISTEN_HOST=0.0.0.0 \
    PORT=3260 \
    WORKER_PORT=3261
WORKDIR /app
# CHANGELOG.json is the app version at run time (server/core/version.js) and what /api/health reports. Don't drop it.
COPY --from=build /app/package.json /app/CHANGELOG.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/client/package.json ./client/package.json
COPY --from=build /app/client/dist ./client/dist
USER node
EXPOSE 3260 3261
# Default: the web app. docker-compose.yml overrides the command for the worker.
CMD ["node", "server/index.js"]

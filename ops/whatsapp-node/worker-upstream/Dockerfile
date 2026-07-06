# Multi-stage build: compile TypeScript, then run a slim production image.
#
# Production image is distroless-ish: node:22-alpine + only the compiled JS +
# production node_modules. No npm in the runtime layer.

FROM node:22-alpine AS builder

WORKDIR /build

# Install deps with lockfile reproducibility. Copy lockfile-less for now (B1
# scaffold). When package-lock.json lands, switch to `npm ci`.
COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune dev deps for the runtime image.
RUN npm prune --omit=dev


FROM node:22-alpine AS runtime

# Drop privileges. The node:alpine image already ships a `node` user (uid 1000).
WORKDIR /app
RUN mkdir -p /app && chown -R node:node /app
USER node

COPY --from=builder --chown=node:node /build/node_modules ./node_modules
COPY --from=builder --chown=node:node /build/dist         ./dist
COPY --from=builder --chown=node:node /build/package.json ./

ENV NODE_ENV=production
ENV NODE_OPTIONS=--enable-source-maps

# Webhook port (internal-only; not published in compose).
EXPOSE 8090

# No HEALTHCHECK here — orchestrator checks worker_health table heartbeat
# (more accurate than a process-up signal).

CMD ["node", "dist/index.js"]

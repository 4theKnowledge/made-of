# syntax=docker/dockerfile:1.7
# Build a standalone Next.js server for Railway.
# Three stages so the final image carries only the runtime output.

ARG NODE_VERSION=22-alpine

# -- deps ---------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# Named cache mount: Railway rejects BuildKit cache mounts without an id so it
# can scope the cache per-service. The literal value here is given to us by
# Railway's build validation; any stable id works locally.
RUN --mount=type=cache,id=s/a903dfcf-2076-4671-bd17-a1186f028e5b-/root/.npm,target=/root/.npm \
    npm ci --no-audit --no-fund

# -- build --------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build \
    && npm run build:scripts

# -- runtime ------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs nextjs

# Standalone output includes a minimal node_modules and server.js.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# Predeploy bundle: compiled JS for migrate + seed-if-empty, plus the data
# they need. Standalone doesn't trace scripts; we build a small single-file
# bundle in the build stage and only ship that + the migration SQL + the
# artifact HTML. Everything is plain Node — no tsx at runtime.
COPY --from=build --chown=nextjs:nodejs /app/dist-scripts ./dist-scripts
COPY --from=build --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=build --chown=nextjs:nodejs /app/legacy ./legacy
COPY --from=build --chown=nextjs:nodejs /app/scripts/predeploy.sh ./scripts/predeploy.sh
# The predeploy bundle marks `postgres` as external, so it must be present
# in node_modules at runtime. Next's standalone output traces imports from
# server.js only; our dist-scripts don't go through that tracer, so copy
# the postgres package explicitly. Same for its transitive runtime deps
# that aren't dev-only.
COPY --from=build --chown=nextjs:nodejs /app/node_modules/postgres ./node_modules/postgres

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]

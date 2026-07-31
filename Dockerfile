FROM node:22.18-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22.18-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="Nebula Console" \
    org.opencontainers.image.description="Web management and publishing console for Helios distributions" \
    org.opencontainers.image.source="https://github.com/lingyu-ily/Nebula-L" \
    org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    JAVA_EXECUTABLE=/usr/bin/java \
    NEBULA_GENERATOR_CACHE_DIR=/var/lib/nebula/cache

RUN apt-get update \
    && apt-get install -y --no-install-recommends openjdk-17-jre-headless ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/libraries ./libraries
COPY --from=build --chown=node:node /app/apps/server/dist ./apps/server/dist
COPY --from=build --chown=node:node /app/apps/server/migrations ./apps/server/migrations
COPY --from=build --chown=node:node /app/apps/server/package.json ./apps/server/package.json
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist
COPY --from=build --chown=node:node /app/apps/web/package.json ./apps/web/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /app/packages/shared/package.json ./packages/shared/package.json

RUN mkdir -p /var/lib/nebula/cache && chown -R node:node /var/lib/nebula
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/server/dist/index.js"]

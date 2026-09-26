FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ARG DATABASE_PROVIDER=postgresql
ENV DATABASE_PROVIDER=${DATABASE_PROVIDER}
# Only a provider selector is supplied at build time; no deployment credentials.
RUN case "$DATABASE_PROVIDER" in postgresql|sqlite) printf '%s' "$DATABASE_PROVIDER" > .image-db-provider ;; *) echo 'DATABASE_PROVIDER must be postgresql or sqlite' >&2; exit 1 ;; esac
COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./
COPY scripts/generate-sqlite-schema.mjs ./scripts/
RUN npm ci --no-audit --no-fund
COPY . .
# The reserved host is never a live database. Neither build needs a connection.
RUN if [ "$DATABASE_PROVIDER" = sqlite ]; then \
      DATABASE_URL=file:/app/data/build-only.db npm run build; \
    else \
      DATABASE_URL=postgresql://placeholder.invalid:5432/forge npm run build; \
    fi

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ARG DATABASE_PROVIDER=postgresql
ENV NODE_ENV=production PORT=3013 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1 DATABASE_PROVIDER=${DATABASE_PROVIDER}
COPY --from=builder --chown=node:node /app/.image-db-provider ./.image-db-provider
# npm run build prepares public/ and .next/static inside standalone already.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/scripts/sqlite-init.mjs ./scripts/sqlite-init.mjs
COPY --from=builder --chown=node:node /app/prisma/sqlite-migrations ./prisma/sqlite-migrations
COPY --chown=node:node docker/entrypoint.sh docker/healthcheck.mjs ./docker/
RUN mkdir -p /app/data /app/public/images/uploads /app/private/chat-uploads && \
    chown -R node:node /app/data /app/public/images/uploads /app/private/chat-uploads && \
    chmod +x /app/docker/entrypoint.sh
USER node
EXPOSE 3013
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=4 CMD ["node", "docker/healthcheck.mjs"]
ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["node", "server.js"]

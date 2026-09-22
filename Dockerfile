FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./
RUN npm ci
COPY . .
# No production credentials are needed to compile. The reserved host cannot
# point at a real database; runtime credentials are supplied only to runner.
RUN DATABASE_URL=postgresql://placeholder.invalid:5432/forge npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3013 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
RUN mkdir -p public/images/uploads private/chat-uploads && chown -R node:node public/images/uploads private
USER node
EXPOSE 3013
CMD ["node", "server.js"]

FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/orchestrator/package.json apps/orchestrator/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json turbo.json ./
COPY scripts/load-wxmr-env.cjs scripts/load-wxmr-env.cjs
COPY apps/orchestrator apps/orchestrator
COPY packages/core packages/core
RUN npm run build --workspace @wxmr/core && npm run build --workspace @wxmr/orchestrator

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json /app/package-lock.json ./
COPY --from=build /app/scripts/load-wxmr-env.cjs ./scripts/load-wxmr-env.cjs
COPY --from=build /app/apps/orchestrator/package.json ./apps/orchestrator/package.json
COPY --from=build /app/apps/orchestrator/dist ./apps/orchestrator/dist
COPY --from=build /app/packages/core ./packages/core
WORKDIR /app/apps/orchestrator
CMD ["node", "dist/server.js"]

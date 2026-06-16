# syntax=docker/dockerfile:1
# Build context must be the monorepo root: docker build -f apps/swap/Dockerfile .

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat

# 1) Prune the workspace down to just what @wxmr/swap needs.
FROM base AS pruner
WORKDIR /app
RUN npm install -g turbo@^2
COPY . .
RUN turbo prune @wxmr/swap --docker

# 2) Install pruned deps and build the app.
FROM base AS builder
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN npm ci
COPY --from=pruner /app/out/full/ .
COPY --from=pruner /app/scripts ./scripts

# NEXT_PUBLIC_* are inlined at build time, so they must be present during `next build`.
ARG NEXT_PUBLIC_SOLANA_RPC_URL
ARG NEXT_PUBLIC_JUPITER_API_KEY
ARG NEXT_PUBLIC_ORCHESTRATOR_URL
ARG NEXT_PUBLIC_ETHEREUM_RPC_URL
ARG NEXT_PUBLIC_BSC_RPC_URL
ARG NEXT_PUBLIC_BASE_RPC_URL
ARG NEXT_PUBLIC_ARBITRUM_RPC_URL
ARG NEXT_PUBLIC_OPTIMISM_RPC_URL
ARG NEXT_PUBLIC_POLYGON_RPC_URL
ARG NEXT_PUBLIC_AVALANCHE_RPC_URL
ARG NEXT_PUBLIC_LINEA_RPC_URL
ARG NEXT_PUBLIC_HYPEREVM_RPC_URL
ARG NEXT_PUBLIC_MONAD_RPC_URL
ARG NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
ENV NEXT_PUBLIC_SOLANA_RPC_URL=$NEXT_PUBLIC_SOLANA_RPC_URL \
    NEXT_PUBLIC_JUPITER_API_KEY=$NEXT_PUBLIC_JUPITER_API_KEY \
    NEXT_PUBLIC_ORCHESTRATOR_URL=$NEXT_PUBLIC_ORCHESTRATOR_URL \
    NEXT_PUBLIC_ETHEREUM_RPC_URL=$NEXT_PUBLIC_ETHEREUM_RPC_URL \
    NEXT_PUBLIC_BSC_RPC_URL=$NEXT_PUBLIC_BSC_RPC_URL \
    NEXT_PUBLIC_BASE_RPC_URL=$NEXT_PUBLIC_BASE_RPC_URL \
    NEXT_PUBLIC_ARBITRUM_RPC_URL=$NEXT_PUBLIC_ARBITRUM_RPC_URL \
    NEXT_PUBLIC_OPTIMISM_RPC_URL=$NEXT_PUBLIC_OPTIMISM_RPC_URL \
    NEXT_PUBLIC_POLYGON_RPC_URL=$NEXT_PUBLIC_POLYGON_RPC_URL \
    NEXT_PUBLIC_AVALANCHE_RPC_URL=$NEXT_PUBLIC_AVALANCHE_RPC_URL \
    NEXT_PUBLIC_LINEA_RPC_URL=$NEXT_PUBLIC_LINEA_RPC_URL \
    NEXT_PUBLIC_HYPEREVM_RPC_URL=$NEXT_PUBLIC_HYPEREVM_RPC_URL \
    NEXT_PUBLIC_MONAD_RPC_URL=$NEXT_PUBLIC_MONAD_RPC_URL \
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=$NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID

# Opt into Next standalone output (consumed by the runner stage below).
ENV NEXT_OUTPUT_STANDALONE=1

RUN npx turbo run build --filter=@wxmr/swap

# 3) Minimal standalone runtime image.
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
USER nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/swap/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/swap/.next/static ./apps/swap/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/swap/public ./apps/swap/public

EXPOSE 3001
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
CMD ["node", "apps/swap/server.js"]

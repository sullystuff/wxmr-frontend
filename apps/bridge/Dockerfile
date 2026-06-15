# syntax=docker/dockerfile:1
# Build context must be the monorepo root: docker build -f apps/bridge/Dockerfile .

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat

# 1) Prune the workspace down to just what @wxmr/bridge needs.
FROM base AS pruner
WORKDIR /app
RUN npm install -g turbo@^2
COPY . .
RUN turbo prune @wxmr/bridge --docker

# 2) Install pruned deps and build the app.
FROM base AS builder
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN npm ci
COPY --from=pruner /app/out/full/ .

# NEXT_PUBLIC_* are inlined at build time, so they must be present during `next build`.
ARG NEXT_PUBLIC_SOLANA_RPC_URL
ARG NEXT_PUBLIC_BRIDGE_PROGRAM_ID
ARG NEXT_PUBLIC_JUPITER_API_KEY
ARG NEXT_PUBLIC_JUPITER_REFERRAL_ACCOUNT
ARG NEXT_PUBLIC_JUPITER_REFERRAL_FEE
ENV NEXT_PUBLIC_SOLANA_RPC_URL=$NEXT_PUBLIC_SOLANA_RPC_URL \
    NEXT_PUBLIC_BRIDGE_PROGRAM_ID=$NEXT_PUBLIC_BRIDGE_PROGRAM_ID \
    NEXT_PUBLIC_JUPITER_API_KEY=$NEXT_PUBLIC_JUPITER_API_KEY \
    NEXT_PUBLIC_JUPITER_REFERRAL_ACCOUNT=$NEXT_PUBLIC_JUPITER_REFERRAL_ACCOUNT \
    NEXT_PUBLIC_JUPITER_REFERRAL_FEE=$NEXT_PUBLIC_JUPITER_REFERRAL_FEE

# Opt into Next standalone output (consumed by the runner stage below).
ENV NEXT_OUTPUT_STANDALONE=1

RUN npx turbo run build --filter=@wxmr/bridge

# 3) Minimal standalone runtime image.
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
USER nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/bridge/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/bridge/.next/static ./apps/bridge/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/bridge/public ./apps/bridge/public

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "apps/bridge/server.js"]

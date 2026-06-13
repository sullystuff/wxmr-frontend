# wXMR Monorepo

Turborepo monorepo for the wXMR web apps: the Monero <-> Solana bridge and the standalone swap site.

## Structure

```
apps/
  bridge/      # wxmr.io  - bridge UI + transparency page (Next.js, port 3000)
  swap/        # swap.wxmr.io - lean Jupiter-only swap UI (Next.js, port 3001)
packages/
  shared/      # @wxmr/shared - wallet providers, mints, Jupiter hook, swap UI, design system
deploy/        # docker-compose + nginx config for self-hosting
```

Both apps consume `@wxmr/shared`, so the wallet setup, token mints, Jupiter integration,
swap component, and styling have a single source of truth.

## Requirements

- Node.js 20+
- npm 11+ (workspaces)

## Getting started

```bash
# install all workspaces from the repo root
npm install

# run both apps (bridge on :3000, swap on :3001)
npm run dev

# or run just one
npm run dev:bridge
npm run dev:swap
```

Each app reads its own `.env.local` (see `apps/<app>/.env.example`). Relevant vars:

- `NEXT_PUBLIC_SOLANA_RPC_URL` - Solana RPC endpoint
- `NEXT_PUBLIC_BRIDGE_PROGRAM_ID` - bridge program id (bridge only)
- `NEXT_PUBLIC_JUPITER_API_KEY` - (optional) Jupiter API key for swap routing
- `NEXT_PUBLIC_JUPITER_REFERRAL_ACCOUNT` / `NEXT_PUBLIC_JUPITER_REFERRAL_FEE` - (optional, bridge)

## Common commands

```bash
npm run build          # build every app via turbo
npm run build:bridge   # build only the bridge app
npm run build:swap     # build only the swap app
npm run lint           # lint every app
```

Turborepo caches task outputs; re-running `build`/`lint` only rebuilds what changed.

## Apps

### Bridge (`apps/bridge`)

The full bridge experience: deposit native XMR to mint wXMR on Solana, withdraw (burn) wXMR
back to native XMR, an embedded swap modal, and the on-chain transparency/audit page.

### Swap (`apps/swap`)

A focused swap-only site for `swap.wxmr.io`. Renders the shared swap panel full-page with a
wallet connect button. XMR <-> USDC routing is handled by the Jupiter Ultra API.

## Deployment

Self-hosted via per-app Docker images (Next.js standalone output) behind Nginx. See
[deploy/README.md](deploy/README.md) for build, compose, Nginx, and Tor notes.

## Tech stack

- Turborepo + npm workspaces
- Next.js 16 (App Router), React 19, TypeScript
- Tailwind CSS 4
- @solana/wallet-adapter, @coral-xyz/anchor (bridge)
- Jupiter Ultra API

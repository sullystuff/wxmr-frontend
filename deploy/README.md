# Deploy

Self-hosted setup for the two apps in this monorepo:

- `apps/bridge` -> `wxmr.io` (listens on `127.0.0.1:3000`)
- `apps/swap` -> `swap.wxmr.io` (listens on `127.0.0.1:3001`)

Each app is an independent Next.js server. The default runner here is PM2; Docker is
provided as an alternative further down.

### Bridge RPC budget

The `wxmr.io` bridge browser calls `https://solana-rpc.publicnode.com` directly.
The Solana Labs mainnet endpoints rejected direct `wxmr.io` browser requests with
HTTP 403 during verification; PublicNode accepted them. The bridge ignores the
shared `SOLANA_RPC_URL` and `NEXT_PUBLIC_SOLANA_RPC_URL` settings, which still
configure the swap app and orchestrator. No paid RPC URL is embedded in the bridge.

Balances, history, and confirmation share a browser-local queue: request starts
are at least 1,000 ms apart (at most 1 request/second per visitor), with no automatic
retries. Different visitors have independent budgets. Web Locks and localStorage
coordinate that budget across a visitor's tabs; when unavailable, pacing remains
per tab. Identical reads coalesce, account reads cache for 5 seconds, and successful
sends invalidate the cache. Public endpoint failures back off. The frontend server
makes no Solana RPC calls and has no RPC, audit, or withdrawal proxy routes.

The homepage loads its known accounts together and does not poll while idle.
Withdrawal addresses are remembered per wallet/browser; use **Load wallet history**
to find transfers from other browsers or earlier sessions. Audit and withdrawal
history paginate through 10 finalized transactions on demand, then read the exact
record accounts. A page can take about 12 seconds on a cold cache; an empty page
does not mean there are no older records. The browser client rejects
`getProgramAccounts`. The public RPC can still throttle or block traffic.

Run `npm --workspace @wxmr/bridge run test:rpc` and `npm run build:bridge` before
deploying with `scripts/redeploy-bridge-remote.sh`. The script ships only the
bridge build and core package and verifies the service restart and build ID.

## 1. Build and run with PM2

The PM2 config lives at the repo root (`ecosystem.config.js`). From the repo root:

```bash
npm install

# NEXT_PUBLIC_* are inlined at BUILD time, so set them before building:
#   .env  (repo-root shared RPC, program id, Jupiter key/referral)
# Sensible fallbacks exist in code, so a build with no env still runs
# (public mainnet RPC, no Jupiter key).
npm run build

pm2 start ecosystem.config.js
pm2 save                 # persist the process list across reboots
pm2 startup              # (run once) generate the boot service, then `pm2 save`
```

This starts two processes, `wxmr-bridge` (`127.0.0.1:3000`) and `wxmr-swap`
(`127.0.0.1:3001`), each running `next start` from its own app directory.

Useful commands:

```bash
pm2 status
pm2 logs wxmr-swap
pm2 restart wxmr-swap    # after a rebuild
```

To change public or server env values: edit the repo-root `.env`, `npm run build`, then
`pm2 restart wxmr-bridge wxmr-swap`.

## 2. Build and run with Docker (alternative)

Each app also builds to a standalone Next.js server in its own Docker image. From this
`deploy/` directory:

```bash
# optional: create/edit the shared repo-root env first
cp ../.env.example ../.env

docker compose --env-file ../.env up -d --build
```

Public env values are still baked into the Next.js bundles at build time. Update the
repo-root `.env` and rebuild to change them. To build a single image directly
(context must be the repo root), export or pass the same env values before building:

```bash
docker build -f apps/swap/Dockerfile -t wxmr-swap .
```

## 3. Nginx (clearnet)

`nginx/wxmr.conf` proxies each hostname to the matching app (`127.0.0.1:3000` /
`127.0.0.1:3001`), so it works the same whether the apps run under PM2 or Docker. Install
it into your nginx config dir and reload:

```bash
sudo cp nginx/wxmr.conf /etc/nginx/sites-available/wxmr.conf
sudo ln -s /etc/nginx/sites-available/wxmr.conf /etc/nginx/sites-enabled/wxmr.conf
sudo nginx -t && sudo systemctl reload nginx
```

Point `swap.wxmr.io` DNS at the same host and terminate TLS with certbot as usual.

## 4. Tor (left to you)

Clearnet subdomains do not map onto Tor: each hidden service is its own `.onion` address.
To expose the swap app as a separate onion, add a second hidden service to your `torrc`
pointing at the swap app, e.g.:

```
# torrc
HiddenServiceDir /var/lib/tor/wxmr_swap/
HiddenServicePort 80 127.0.0.1:3001
```

The existing bridge onion keeps pointing at `127.0.0.1:3000`. After reloading Tor, read the
generated `.onion` hostname from `/var/lib/tor/wxmr_swap/hostname`.

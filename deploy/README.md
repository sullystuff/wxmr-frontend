# Deploy

Self-hosted setup for the two apps in this monorepo:

- `apps/bridge` -> `wxmr.io` (listens on `127.0.0.1:3000`)
- `apps/swap` -> `swap.wxmr.io` (listens on `127.0.0.1:3001`)

Each app is an independent Next.js server. The default runner here is PM2; Docker is
provided as an alternative further down.

## 1. Build and run with PM2

The PM2 config lives at the repo root (`ecosystem.config.js`). From the repo root:

```bash
npm install

# NEXT_PUBLIC_* are inlined at BUILD time, so set them before building:
#   apps/bridge/.env.local  (RPC, program id, Jupiter key/referral)
#   apps/swap/.env.local    (RPC, Jupiter key)
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

To change `NEXT_PUBLIC_*` values: edit the relevant `.env.local`, `npm run build`, then
`pm2 restart wxmr-bridge wxmr-swap`.

## 2. Build and run with Docker (alternative)

Each app also builds to a standalone Next.js server in its own Docker image. From this
`deploy/` directory:

```bash
# optional: provide production NEXT_PUBLIC_* values for the build
cp ../apps/bridge/.env.example .env   # then edit values

docker compose up -d --build
```

`NEXT_PUBLIC_*` are passed as Docker build args (see `docker-compose.yml` and each
`Dockerfile`); update them and rebuild to change them. To build a single image directly
(context must be the repo root):

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

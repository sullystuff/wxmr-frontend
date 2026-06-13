# Deploy

Self-hosted setup for the two apps in this monorepo:

- `apps/bridge` -> `wxmr.io` (listens on `127.0.0.1:3000`)
- `apps/swap` -> `swap.wxmr.io` (listens on `127.0.0.1:3001`)

Each app builds to a standalone Next.js server in its own Docker image, so they can be
built, deployed, and restarted independently.

## 1. Build and run

From this `deploy/` directory:

```bash
# optional: provide production NEXT_PUBLIC_* values for the build
cp ../apps/bridge/.env.example .env   # then edit values

docker compose up -d --build
```

`NEXT_PUBLIC_*` variables are inlined into the client bundle at build time, so they are
passed as Docker build args (see `docker-compose.yml` and each `Dockerfile`). Update them
and rebuild to change them. Sensible fallbacks exist in code, so a build with no env still
runs (using public mainnet RPC and no Jupiter API key).

To build a single image directly (context must be the repo root):

```bash
docker build -f apps/swap/Dockerfile -t wxmr-swap .
```

## 2. Nginx (clearnet)

`nginx/wxmr.conf` proxies each hostname to the matching container. Install it into your
nginx config dir and reload:

```bash
sudo cp nginx/wxmr.conf /etc/nginx/sites-available/wxmr.conf
sudo ln -s /etc/nginx/sites-available/wxmr.conf /etc/nginx/sites-enabled/wxmr.conf
sudo nginx -t && sudo systemctl reload nginx
```

Point `swap.wxmr.io` DNS at the same host and terminate TLS with certbot as usual.

## 3. Tor (left to you)

Clearnet subdomains do not map onto Tor: each hidden service is its own `.onion` address.
To expose the swap app as a separate onion, add a second hidden service to your `torrc`
pointing at the swap container, e.g.:

```
# torrc
HiddenServiceDir /var/lib/tor/wxmr_swap/
HiddenServicePort 80 127.0.0.1:3001
```

The existing bridge onion keeps pointing at `127.0.0.1:3000`. After reloading Tor, read the
generated `.onion` hostname from `/var/lib/tor/wxmr_swap/hostname`.

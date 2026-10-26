# Deploy

Self-hosted setup for the two apps in this monorepo:

- `apps/bridge` -> `wxmr.io` (listens on `127.0.0.1:3000`)
- `apps/swap` -> `swap.wxmr.io` (listens on `127.0.0.1:3001`)

Bridge search visibility and privacy-preserving traffic reporting are documented
in [SEO-ANALYTICS.md](SEO-ANALYTICS.md). Collection requires a verified no-request-logs
setup and defaults to disabled.

Each app is an independent Next.js server. The default runner here is PM2; Docker is
provided as an alternative further down.

### Bridge RPC budget

The `wxmr.io` bridge browser calls `https://solana-rpc.publicnode.com` directly by default.
The Solana Labs mainnet endpoints rejected direct `wxmr.io` browser requests with
HTTP 403 during verification; PublicNode accepted them. The bridge ignores the
shared `SOLANA_RPC_URL` and `NEXT_PUBLIC_SOLANA_RPC_URL` settings, which still
configure the swap app and orchestrator. No paid RPC URL is embedded in the bridge.

Visitors can choose **Solana RPC** on the bridge, transparency, or swap page to
save a custom mainnet HTTP(S) endpoint. The browser checks `getGenesisHash`
directly before saving; the provider must allow browser requests (CORS). Path and
query API keys are supported, and the input is masked unless **Show URL** is checked.
Remote HTTP endpoints require an HTTP site; HTTPS sites can also use HTTP loopback
nodes. See the [Solana RPC method documentation](https://solana.com/docs/rpc/http/getgenesishash).

The URL is stored in localStorage for that origin only, so `wxmr.io` and
`swap.wxmr.io` have independent settings. **Save & reload** and **Use default &
reload** explicitly reload the current page; other tabs retain their current
connection until reloaded. The bridge routes balances, wallet submissions,
confirmation, withdrawal history, and audit history through the selection, keeping
the same queue/cache policy below. There is no automatic public-RPC fallback for
a failed custom endpoint. Swap wallet RPC uses the selection too; quote services,
wallet-internal requests, and server-side cross-chain processing keep their own endpoints.

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

### Homepage Jupiter swap

The main site supports buying/selling wXMR with SOL or USDC through Jupiter's
Metis Swap API. The requested referral account is
`36rUjmrYc16eBpCCGG2t6oeiEmi1GHjeLTDQ7i8JUxAW`, under Jupiter's Swap project.
Jupiter Plugin/Ultra requires a different project and rejects this account.
The bridge calls Jupiter's `/swap/v1/quote`, `/swap/v1/swap`, and token-search
APIs directly from the visitor's browser. It uses keyless access by default;
`NEXT_PUBLIC_JUPITER_BROWSER_API_KEY` optionally configures a deliberately
browser-visible key. The existing server API key is not included in these requests.
See [Jupiter's fee documentation](https://developers.jup.ag/docs/swap/v1/add-fees-to-swap).

Token search supports any Jupiter-listed mint with supported metadata, with
wXMR fixed on one side. Quotes debounce edits by 450 ms, refresh every 10 seconds,
and pause while the page is hidden, token search is open, or a swap is active.
Obsolete requests are aborted; 429 responses honor backoff. Per-browser request
spacing is 2.2 seconds without a key, or 1.1 seconds with a browser key.

The fee remains fixed at 50 bps (0.5%) and always uses the initialized wXMR
referral token account `BVQREgTvRZcQmv1rwfBTUkR4JhiAdUM3zHCFaPKJB6E7`.
ExactIn swaps allow collecting in either input or output mint, so unrelated token
fee accounts do not need to be created. The UI omits fee and slippage controls;
the quoted output still includes the fee, and a fixed 50-bps output protection
is enforced. Quotes missing the fee or weakening the output minimum are rejected.
Quotes expire after 30 seconds and each quote object builds at most once.
Builds require the wallet fee payer and writable referral account to be present.
Jupiter's requested priority fees are capped at 100,000 lamports; the wallet can apply its own settings.

Jupiter's unsigned transaction is checked before the wallet prompt. After signing,
accept the connected wallet's returned transaction, including safety wrappers,
memos, account reordering, sponsorship, and its own priority settings. Do not
compare its instruction list to Jupiter's unsigned list. Require the connected
wallet to be a signed required signer, then submit the returned signed bytes
unchanged. Snapshot the original blockhash before handing the mutable transaction
to the wallet. If the wallet refreshes it, confirm by signature without reusing
the old block-height expiry bound.

Jupiter may return a serialized transaction alongside a failed compute-estimation
simulation. If the transaction is present, decodes, and passes the unsigned
wallet/referral checks, pass it unchanged to the wallet rather than vetoing it
based on that simulation field. Log only the bounded error reason in the browser.
Wallet simulation and RPC preflight remain active (`skipPreflight: false`). If
Jupiter returns no usable transaction, surface its actual simulation error.
An omitted or string-encoded expiry hint is supported; signature confirmation
is used when the exact last-valid block height is unavailable.

Wallets sign locally. Signed bytes and their signature are saved in browser
storage before one submission through the visitor's selected Solana RPC.
Timeouts retain the record and block another swap until status is reconciled;
**Check swap status** only reads chain status and never resends or signs again.
No backend wallet or bridge funds participate. Deployment does not create
accounts, sign swaps, or claim fees. Verify existing referral account ownership,
fee-account mint and initialization, all four quotes, unsigned build simulation,
and browser behavior before release.

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

# Bridge SEO and anonymous traffic statistics

This applies to `wxmr.io` and its bridge onion alias. The swap site has a separate
application and is outside this change.

## Search visibility

The bridge provides descriptive titles and descriptions, canonical HTTPS URLs,
an indexable `/wrapped-xmr` guide, a `/privacy` page, WebSite structured data,
an Open Graph image, `/robots.txt`, and `/sitemap.xml`. Public content is rendered
into HTML. `/insights` is noindex and omitted from the sitemap; report data needs
an administrator bearer token. API routes are excluded from crawling.

After deploying, verify `https://wxmr.io/` in Google Search Console, submit
`https://wxmr.io/sitemap.xml`, and inspect/request indexing of `/` and
`/wrapped-xmr`. Use DNS verification or set `GOOGLE_SITE_VERIFICATION` before
building. Bing verification is available through `BING_SITE_VERIFICATION`.
These steps require the owner's search-engine account; a sitemap alone does not
guarantee indexing or ranking. Check crawl/index reports before diagnosing ranking.

Measure impressions and clicks for “wrapped XMR”, “wrapped Monero”, and
“Monero Solana bridge” in Search Console. Seek accurate links from the project's
public repositories and relevant ecosystem documentation. Do not buy links or
make custody/privacy claims the bridge cannot support.

## Data model and limits

One first-party script submits only `{path, entry, source}`. Paths and referral
categories are fixed allowlists. Requests omit cookies and the Referer header.
Queries, fragments, wallet state, form inputs, and raw referral URLs are never
sent. Browser UA is reduced to device/browser categories and discarded. A local
country-only MMDB lookup uses the proxy-overwritten `X-Real-IP` transiently, without
hashing, retaining, logging, or making external visitor lookups. The reader has no
IP-address cache. Onion requests have Unknown country.

SQLite stores only `day, metric, label, count`, with a separate counter for each
dimension. There is no event table or cross-dimension visitor record. The report
combines country/source/device/browser categories with fewer than five entries
over the selected period. Reports cover 7, 30, or 90 UTC days. Expired daily
counters are pruned on collection and reporting; do not retain backups longer
than the same policy. Files live outside release directories with private
permissions. No analytics ID or session identifier exists. An entry is a new
document load/tab, including reloads; it is not a unique visitor or a 30-minute
session. Internal SPA navigation counts another page view. The dashboard cannot
identify returning users or reconstruct journeys. Known bots are ignored, but
anonymous statistics can still be inflated by automated requests.

Do Not Track, Global Privacy Control, and the `/privacy` opt-out disable the
script. The opt-out stores one boolean preference only. DNT/GPC are also checked
server-side. The privacy page explains the measurement and offers the opt-out.

## Required production setup

Node 22.16+ is required for built-in SQLite; the bridge Docker image uses Node 24.
The existing systemd bridge runtime was verified as Node 24.13 during this change.
`mmdb-lib` is pure JavaScript; verify it is included in the compiled server bundle
or install the locked bridge dependencies before release. Do not rebuild native
orchestrator modules or restart bridge financial workers for this change.

Collection defaults to **off**. It remains off unless both
`WXMR_ANALYTICS_ENABLED=1` and `WXMR_ANALYTICS_LOGGING_DISABLED=1` are set and an
absolute database path is configured. The second flag is an operator assertion,
not an automatic log audit. Do not set it until every layer has been checked.

1. Back up the actual nginx configuration. Include
   [`nginx/bridge-privacy.inc`](nginx/bridge-privacy.inc) in all bridge HTTPS,
   onion, and HTTP redirect server blocks. Remove any child-location
   `access_log on`/`error_log` overrides and duplicate server-level log directives,
   including token image/metadata locations.
   Check upstream load balancers, CDN/WAF logs, application/APM request capture,
   and hosting-provider logging too. Both access and error logs can contain
   addresses, full request URLs, or referrers. Existing logs are separate historical
   data: do not silently delete shared logs or other applications' records.
2. Run `nginx -t`, reload nginx with administrator access, make a marked test
   request through clearnet and the onion, and verify no matching request/address
   appears in any configured log. Preserve generic application health/error
   monitoring that does not contain request data. The app must stay bound to
   loopback; nginx must overwrite `X-Real-IP` with `$remote_addr`.
3. Create a mode-700 persistent directory owned by the bridge service user, e.g.
   `/home/deploy/.local/share/wxmr-analytics`. Generate a random administrator token
   of at least 32 characters in a mode-600 ignored environment file. Never put
   it in a URL, command-line argument, public variable, git, or deploy output.
4. Download the current monthly **IP to Country Lite MMDB** from
   [DB-IP](https://db-ip.com/db/download/ip-to-country-lite) into that directory,
   decompress it, and verify its published checksum. Do not use a city database.
   Update it monthly and restart the frontend to reload it. This is a database
   download only; never send visitor addresses to DB-IP. Its CC BY 4.0 attribution
   appears in the privacy policy and dashboard.
5. Set the following server-only runtime environment values (actual paths depend
   on the service user). Restart the frontend using the existing release process.

   ```dotenv
   WXMR_ANALYTICS_ENABLED=1
   WXMR_ANALYTICS_LOGGING_DISABLED=1
   WXMR_ANALYTICS_TRUST_PROXY=1
   WXMR_ANALYTICS_DB_PATH=/home/deploy/.local/share/wxmr-analytics/traffic.analytics.sqlite
   WXMR_ANALYTICS_GEOIP_PATH=/home/deploy/.local/share/wxmr-analytics/country.mmdb
   WXMR_ANALYTICS_ADMIN_TOKEN=<random value in private runtime env only>
   WXMR_ANALYTICS_ORIGINS=<bridge onion HTTPS origin, if used>
   ```

6. Check `/api/analytics` returns `{"enabled":true}`, then make one ordinary browser
   visit and navigate internally. At `/insights`, enter the administrator token
   (held in memory only) and verify entry/page totals, no raw request fields, and
   expected privacy suppression. An unauthenticated report must return 401 with
   `Cache-Control: private, no-store`. Confirm DNT/GPC and opt-out requests create
   no counters. Do not call a synthetic request proof of real user traffic.

The deployment account available during this change could read nginx settings
but could not modify them or reload nginx without a sudo password. Until an
administrator completes steps 1–2, keep collection disabled. Do not deploy a
third-party tracker as a fallback.

## Validation

```bash
npm --workspace @wxmr/bridge run test:analytics
npm --workspace @wxmr/bridge run test:rpc
npm run build:bridge
```

The report endpoint never includes raw rows or visitor data. The database is
entirely separate from bridge custody/accounting databases.

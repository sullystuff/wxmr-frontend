import Link from "next/link";
import { BridgeShell } from "@/components/BridgeShell";
import { AnalyticsPreference } from "@/components/AnalyticsPreference";
import { pageMetadata } from "@/lib/site-metadata";

export const metadata = pageMetadata(
  "/privacy",
  "Privacy & Anonymous Website Statistics | wXMR",
  "Understand wXMR website statistics and bridge privacy: aggregate counts, no analytics cookies, no visitor identifiers, and no stored analytics IP addresses.",
);

export default function PrivacyPage() {
  return (
    <BridgeShell>
      <main id="main" className="bridge-main docs-main">
        <div className="page-intro"><div>
          <p className="eyebrow">WEBSITE PRIVACY</p>
          <h1>Traffic trends. <span>Without visitor profiles.</span></h1>
          <p>What anonymous statistics count, and what the bridge makes public.</p>
        </div></div>
        <article className="docs-content information-content">
          <section>
            <h2>Your choice</h2>
            <AnalyticsPreference />
          </section>
          <section>
            <h2>What anonymous traffic statistics count</h2>
            <p>When enabled, our own server counts views of public pages, page loads that start a visit, landing pages, broad referral categories such as Google or Reddit, approximate countries, device categories, and browser families. Each category is totaled separately by UTC day. We do not store individual visit records or connect these categories into visitor profiles.</p>
            <p>A “visit entry” means a fresh page load or tab; refreshing can count again. It is not a unique person or a session. The statistics cannot identify returning visitors, reconstruct browsing journeys, or reliably count unique people. Countries and other audience categories with fewer than five entries in a reporting period are combined.</p>
          </section>
          <section>
            <h2>What analytics never saves</h2>
            <p>No IP addresses or IP hashes, cookies, visitor IDs, fingerprints, wallet addresses, balances, transfer amounts, transaction signatures, form contents, precise locations, raw user agents, or full referral URLs are stored in analytics. Only fixed public page paths are accepted; URL queries and fragments are excluded.</p>
            <p>Country estimation uses a downloaded database on our server. The connection address is read temporarily for that lookup and discarded without logging, hashing, or saving it in analytics. It is never sent to an external geolocation API. We do not request browser location permission or collect cities or coordinates. VPN and Tor use can make a country estimate inaccurate or unavailable.</p>
            <p>Daily counters are retained for 90 days. Reports are private and require an administrator credential. There are no advertising pixels or third-party analytics scripts.</p>
          </section>
          <section>
            <h2>Network connections and other services</h2>
            <p>Connecting to a website necessarily exposes a network address to the hosting infrastructure. The no-IP-storage promise above describes our analytics. Your browser also contacts services needed for features you use, such as your chosen Solana RPC provider and wallet software. Those services have their own privacy practices.</p>
            <p>Country data is provided by <a className="text-link" href="https://db-ip.com" rel="noreferrer">IP Geolocation by DB-IP</a> under the <a className="text-link" href="https://creativecommons.org/licenses/by/4.0/" rel="noreferrer">Creative Commons Attribution 4.0 license</a>. Only the downloaded country database is used; DB-IP receives no visitor lookup requests from us.</p>
          </section>
          <section>
            <h2>Bridge records are separate</h2>
            <p>Solana balances, token transfers, and bridge records are public. Records can associate a Solana wallet with Monero addresses, transfer amounts, and timing. These are operational blockchain records, separate from anonymous website statistics. Read the <Link className="text-link" href="/docs#privacy">bridge privacy explanation</Link> before transferring.</p>
            <p>The bridge can save wallet-related preferences and pending withdrawal information in your browser for its functionality. Those records are not sent to analytics. The statistics opt-out stores only a yes/no preference.</p>
          </section>
        </article>
      </main>
    </BridgeShell>
  );
}

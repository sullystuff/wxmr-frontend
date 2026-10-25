import Link from "next/link";
import { BridgeShell } from "@/components/BridgeShell";
import { pageMetadata } from "@/lib/site-metadata";

export const metadata = pageMetadata(
  "/wrapped-xmr",
  "What Is Wrapped XMR? Wrapped Monero on Solana | wXMR",
  "Wrapped XMR (wXMR) represents Monero on Solana. Learn how to wrap and unwrap XMR, verify reserves, and understand custody and privacy risks.",
);

export default function WrappedXmrPage() {
  return (
    <BridgeShell>
      <main id="main" className="bridge-main docs-main">
        <div className="page-intro">
          <div>
            <p className="eyebrow">MONERO, CONNECTED</p>
            <h1>What is <span>wrapped XMR?</span></h1>
            <p>Native Monero, represented as a token on Solana.</p>
          </div>
        </div>
        <article className="docs-content information-content">
          <section>
            <h2>Wrapped Monero on Solana</h2>
            <p>Wrapped XMR, also called wrapped Monero or wXMR, is a Solana token representing XMR held by the bridge. Native XMR lives on the Monero network. wXMR can be held and transferred using a compatible Solana wallet and used in supported Solana markets.</p>
            <p>The bridge accounts for XMR and wXMR at a 1:1 unit ratio before fees. Market prices can differ from native Monero. The official wXMR token mint on Solana is <code className="breakable-address">WXMRyRZhsa19ety5erZhHg4N3xj3EVN92u94422teJp</code>. Check the mint address when choosing a token or market.</p>
          </section>
          <section>
            <h2>How do I wrap XMR?</h2>
            <p>Connect a Solana wallet to the <Link className="text-link" href="/">wXMR bridge</Link>, create your reusable Monero deposit address, and send at least 0.1 XMR from your Monero wallet. After 10 Monero confirmations and bridge processing, you receive wXMR. The deposit fee is 0.1%, charged in wXMR.</p>
            <p>For example, a 1 XMR deposit mints 0.999 wXMR to you and 0.001 wXMR to the fee treasury. You also need SOL for Solana transactions and account creation.</p>
          </section>
          <section>
            <h2>How do I unwrap wXMR to native Monero?</h2>
            <p>Choose Solana → Monero in the bridge, enter your amount and Monero destination, and review the request before signing. The withdrawal fee is 0.1% in wXMR, and the minimum withdrawal is 0.1 XMR. Native XMR is paid after the bridge processes your request.</p>
            <p>Read the <Link className="text-link" href="/docs">bridge guide</Link> for fees, confirmations, pending requests, and cancellation details.</p>
          </section>
          <section>
            <h2>How can I verify the reserves?</h2>
            <p>The <Link className="text-link" href="/transparency">reserve transparency page</Link> publishes reserve proofs and bridge heartbeat records. Download proof material and check it with your own Monero tools. A proof describes the outputs covered at its reference time; it is not a guarantee about future reserves or redemption availability.</p>
          </section>
          <section>
            <h2>Does wrapped XMR have Monero’s privacy?</h2>
            <p>Solana balances and token transfers are public. Using wXMR does not bring Monero’s native transaction privacy to Solana. Public bridge records can connect wallets, Monero addresses, amounts, and timing. Read <Link className="text-link" href="/docs#privacy">how privacy changes across networks</Link> before transferring.</p>
          </section>
          <section>
            <h2>What are the risks of wrapped Monero?</h2>
            <p>wXMR relies on the bridge operator holding reserves and processing redemptions. The bridge uses an upgradeable Solana program and an active mint authority. Custody, software, network availability, and market liquidity introduce risks. Public proofs help you inspect evidence; they do not remove those risks.</p>
          </section>
          <Link className="primary-button" href="/">Open the XMR ↔ wXMR bridge</Link>
        </article>
      </main>
    </BridgeShell>
  );
}

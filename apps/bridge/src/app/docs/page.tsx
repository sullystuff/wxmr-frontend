import Link from "next/link";
import { XMR_DEPOSIT_DUST_PICONERO, formatXmrAmount } from "@wxmr/core";
import { BridgeShell } from "@/components/BridgeShell";
import { Icon } from "@/components/BridgeIcons";

export default function DocsPage() {
  return (
    <BridgeShell>
      <main id="main" className="bridge-main docs-main">
        <div className="page-intro">
          <div>
            <p className="eyebrow">
              <span className="orange-dash" />A LITTLE CONTEXT GOES A LONG WAY
            </p>
            <h1>
              Understand <span>the bridge.</span>
            </h1>
            <p>How XMR becomes wXMR, what it costs, and what to verify.</p>
          </div>
        </div>
        <div className="docs-layout">
          <nav className="docs-toc" aria-label="On this page">
            <span className="eyebrow">ON THIS PAGE</span>
            <a href="#overview">What is wXMR?</a>
            <a href="#deposit">Monero → Solana</a>
            <a href="#withdraw">Solana → Monero</a>
            <a href="#fees">Fees & minimums</a>
            <a href="#verification">Verify the reserves</a>
            <a href="#privacy">Privacy across networks</a>
          </nav>
          <div className="docs-content">
            <section id="overview">
              <span className="doc-number">01 / THE BASICS</span>
              <h2>Native XMR. Wrapped on Solana.</h2>
              <p>
                XMR is Monero’s native currency. wXMR is its token representation
                on Solana. Bridge XMR to Solana to receive wXMR, or bridge wXMR
                back to receive native XMR at your Monero address.
              </p>
              <p>
                Use a Solana wallet to interact with the bridge and a Monero
                wallet to send or receive native XMR. You need SOL for Solana
                transaction costs.
              </p>
            </section>
            <section id="deposit">
              <span className="doc-number">02 / BRIDGE TO SOLANA</span>
              <h2>Deposit XMR. Receive wXMR.</h2>
              <ol className="doc-steps">
                <li>
                  <strong>Connect your Solana wallet.</strong> Create your
                  reusable Monero deposit address. Approve the account creation
                  transaction in your wallet.
                </li>
                <li>
                  <strong>Send native XMR to that address.</strong> Each deposit
                  must meet the 0.1 XMR minimum. Keep your sender’s transaction
                  record.
                </li>
                <li>
                  <strong>Wait for 10 Monero confirmations.</strong>{" "}
                  Confirmation time depends on block production. Once eligible,
                  the bridge processes the mint.
                </li>
                <li>
                  <strong>Receive wXMR in your Solana wallet.</strong> The
                  contract mints 99.9% to you and 0.1% to the fee treasury. If
                  tokens are waiting in your deposit account, the bridge shows a
                  claim action.
                </li>
              </ol>
              <div className="doc-callout">
                <Icon name="info" />
                <p>
                  Your reusable address accepts different eligible amounts
                  without creating a new address. Deposits below 0.1 XMR are not
                  minted; transfers or individual inputs below{" "}
                  {formatXmrAmount(XMR_DEPOSIT_DUST_PICONERO)} XMR are ignored
                  as dust.
                </p>
              </div>
            </section>
            <section id="withdraw">
              <span className="doc-number">03 / BRIDGE TO MONERO</span>
              <h2>Return to native XMR.</h2>
              <ol className="doc-steps">
                <li>
                  <strong>Choose the Solana → Monero direction.</strong> Enter
                  your wXMR amount, or enable exact receive to specify the XMR
                  you want to get.
                </li>
                <li>
                  <strong>Enter your Monero destination.</strong> Check the
                  complete address in the review before signing.
                </li>
                <li>
                  <strong>Approve the withdrawal request.</strong> Your Solana
                  wallet displays the transaction for approval. The bridge fee
                  is charged in wXMR.
                </li>
                <li>
                  <strong>Follow the request status.</strong> The bridge
                  processes the native XMR payment. You can refresh pending
                  requests or load earlier wallet requests in transfer activity.
                </li>
              </ol>
              <p>
                A pending request can be canceled after the on-chain waiting
                period if it remains eligible. The interface shows when
                cancellation becomes available. Canceling returns the refundable
                wXMR amount; the original bridge fee is retained.
              </p>
            </section>
            <section id="fees">
              <span className="doc-number">04 / THE NUMBERS</span>
              <h2>Clear fees. Both directions.</h2>
              <div className="doc-fee-table">
                <div>
                  <span>Monero → Solana</span>
                  <strong>0.1% in wXMR</strong>
                </div>
                <div>
                  <span>Solana → Monero</span>
                  <strong>0.1% in wXMR</strong>
                </div>
                <div>
                  <span>Minimum deposit</span>
                  <strong>0.1 XMR</strong>
                </div>
                <div>
                  <span>Minimum withdrawal</span>
                  <strong>0.1 XMR</strong>
                </div>
              </div>
              <p>
                For a 1 XMR deposit, the contract mints 0.999 wXMR to you and
                0.001 wXMR to the existing fee treasury. For a 1 wXMR withdrawal
                in “You send” mode, the bridge fee is 0.001 wXMR and the
                requested native payment is 0.999 XMR.
              </p>
              <p>
                Solana transaction and account creation costs are separate and
                shown by your wallet. Sending native XMR from your own wallet
                also incurs the Monero network fee shown by that wallet.
              </p>
            </section>
            <section id="verification">
              <span className="doc-number">05 / CHECK THE EVIDENCE</span>
              <h2>Verify using your own tools.</h2>
              <p>
                Native reserve proofs publish daily and include confirmed locked
                outputs as well as unlocked XMR. The daily wallet sweep continues
                separately. Open the reserves page and expand a native reserve proof.
                Download the proof, signed message, and full report. The report
                records the Monero challenge block, Solana reference slot, token
                supply reference, and publisher’s check.
              </p>
              <p>
                Use a Monero CLI wallet connected to a synchronized node to run
                the report’s exact <code>check_reserve_proof</code> command.
                Check the signature result and the amount reported as spent. A
                fresh check may differ from the publisher’s earlier snapshot
                because later bridge activity can spend included outputs.
              </p>
              <p>
                Older consolidation records contain transaction keys you can use
                to inspect specific payments. The public view key allows
                incoming wallet inspection; it does not prove the current
                unspent reserve balance on its own.
              </p>
              <Link className="text-link" href="/transparency">
                Open reserve records
                <Icon name="arrow" />
              </Link>
            </section>
            <section id="privacy">
              <span className="doc-number">06 / PRIVACY ACROSS NETWORKS</span>
              <h2>Know what becomes public.</h2>
              <p>
                <strong>On Solana.</strong> wXMR balances and token transfers
                are visible on the public ledger. wXMR does not extend Monero’s
                native transaction privacy to Solana activity.
              </p>
              <p>
                <strong>At the bridge.</strong> Public bridge records can
                associate your Solana wallet with a Monero deposit address,
                withdrawal destination, transfer amount, and timing. Consider
                these connections when choosing which wallets and addresses to
                use. The public heartbeat also lists pending deposit amounts,
                confirmation progress, and their Solana accounts.
              </p>
              <p>
                <strong>In verification records.</strong> Published view keys
                and payment proof material support independent verification of
                bridge activity. They also make the covered transaction
                information inspectable.
              </p>
              <p>
                <strong>Native Monero.</strong> XMR transactions use Monero’s
                privacy protections. Information you share through the bridge,
                public records, or with a recipient can still reveal details
                about the entry and exit points.
              </p>
            </section>
            <div className="docs-back">
              <Link href="/" className="primary-button">
                Back to the bridge
                <Icon name="arrow" />
              </Link>
            </div>
          </div>
        </div>
      </main>
    </BridgeShell>
  );
}

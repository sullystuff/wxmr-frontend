"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CopyAddress } from "@wxmr/shared";
import { Icon } from "../BridgeIcons";
import { AssetIcon } from "./AssetIcon";
import {
  SwapApiError,
  XMR_ASSET_ID,
  USDC_SOL_ASSET_ID,
  chainflipPageNote,
  chainflipStatusLinks,
  explorerTxUrl,
  formatUnits,
  refundNotice,
  routeUsesChainflip,
  swapApi,
  unitsToInput,
  type SwapOrder,
  type SwapStatus,
} from "@/lib/swap-api";

const POLL_MS = 5_000;
const TERMINAL: SwapStatus[] = ["completed", "refunded", "failed"];
const STATUS_HEADINGS: Record<SwapStatus, string> = {
  allocating: "Opening your deposit address",
  awaiting_deposit: "Waiting for your deposit",
  confirming: "Deposit on its way",
  swapping: "Swapping",
  sending: "Sending",
  completed: "Swap complete",
  refunding: "Refunding",
  refunded: "Refunded",
  expired: "This deposit address has expired",
  failed: "This swap needs a closer look",
};

function TxLink({ asset, tx, label }: { asset: string; tx: string; label: string }) {
  const url = explorerTxUrl(asset, tx);
  if (!url) return <code className="xswap-tx">{tx}</code>;
  return (
    <a className="text-link small" href={url} target="_blank" rel="noopener noreferrer">
      {label}
      <Icon name="external" />
    </a>
  );
}

const ALLOCATION_USUAL_MS = 30_000;

function timeLeft(expiresAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${(seconds % 60).toString().padStart(2, "0")}s`;
}

/** A deposit made just before a Chainflip channel expires can be witnessed for a while after. */
const LATE_DEPOSIT_WINDOW_MS = 3 * 3_600_000;

/** Whether this swap can still change. Only an address we keep watching can revive after expiring. */
function isFinal(swap: SwapOrder): boolean {
  if (TERMINAL.includes(swap.status)) return true;
  if (swap.status !== "expired" || swap.from === XMR_ASSET_ID || swap.from === USDC_SOL_ASSET_ID) return false;
  return Date.now() > (swap.deposit.expiresAt ?? 0) + LATE_DEPOSIT_WINDOW_MS;
}

export function SwapProgress({
  id,
  active,
  onStartAnother,
}: {
  id: string;
  active: boolean;
  onStartAnother: () => void;
}) {
  const [swap, setSwap] = useState<SwapOrder | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: number | undefined;
    let stopped = false;
    const load = async () => {
      if (document.hidden) {
        // Nobody is looking. Check again soon, and fetch the moment they are back.
        timer = window.setTimeout(load, POLL_MS);
        return;
      }
      try {
        const next = await swapApi.order(id, controller.signal);
        if (stopped) return;
        setSwap(next);
        setError("");
        if (!isFinal(next)) timer = window.setTimeout(load, POLL_MS);
      } catch (err) {
        if (stopped || controller.signal.aborted) return;
        if (err instanceof SwapApiError && err.status === 404) {
          setError("There is no swap with this link. It may have been made against a different server.");
          return;
        }
        // Keep the last good state on screen: the swap keeps going without this page.
        setError("Cannot reach the swap service right now. Your swap keeps running. Trying again…");
        timer = window.setTimeout(load, POLL_MS * 2);
      }
    };
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [id, active]);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!swap) {
    return (
      <section className="xswap" aria-live="polite">
        <div className="xswap-card xswap-status-card">
          {error ? (
            <>
              <p className="field-error" role="alert">
                {error}
              </p>
              <button type="button" className="secondary-button" onClick={onStartAnother}>
                Start a new swap
              </button>
            </>
          ) : (
            <div className="address-pending">
              <span className="spinner" />
              <div>
                <strong>Loading your swap</strong>
              </div>
            </div>
          )}
        </div>
      </section>
    );
  }

  const fromDecimals = swap.fromAsset.decimals;
  const toDecimals = swap.toAsset.decimals;
  const fromSymbol = swap.fromAsset.symbol;
  const toSymbol = swap.toAsset.symbol;
  const fromIsXmr = swap.from === XMR_ASSET_ID;
  const refundDecimals = swap.refund.asset?.decimals ?? fromDecimals;
  const refundSymbol = swap.refund.asset?.symbol ?? fromSymbol;
  const awaiting = swap.status === "awaiting_deposit";
  const received = BigInt(swap.deposit.received ?? 0);
  const amountIn = BigInt(swap.amountIn);
  // The backend knows when more is still part of this swap: after that, more is lost or sent back.
  const showAddress = Boolean(swap.deposit.address) && swap.deposit.acceptsMore;
  const stillToSend = received > BigInt(0) && received < amountIn ? amountIn - received : amountIn;
  const required = swap.deposit.requiredConfirmations;
  const confirmations = swap.deposit.confirmations ?? 0;
  const expiresAt = swap.deposit.expiresAt;
  const heldUntil = swap.reserveHeldUntil;
  const startsAnywayAt = swap.deposit.startsAnywayAt;
  // Confirmations are not what it is waiting for any more. The bridge has it, however long that takes.
  const waitingOnBridge = fromIsXmr && swap.reservePath === "slow" && required !== null && confirmations >= required;
  const chainflipLinks = chainflipStatusLinks(swap);
  const chainflipNote = chainflipLinks.length > 0 ? chainflipPageNote(swap.kind) : null;

  return (
    <section className="xswap" aria-labelledby="xswap-status-title">
      <div className="xswap-card xswap-status-card">
        <div className="xswap-card-heading">
          <div>
            <p className="eyebrow">
              {formatUnits(swap.amountIn, fromDecimals, fromDecimals)} {fromSymbol} → {toSymbol}
            </p>
            <h2 id="xswap-status-title" aria-live="polite">
              {STATUS_HEADINGS[swap.status]}
            </h2>
          </div>
          {routeUsesChainflip(swap.from, swap.to) && (
            <a className="xswap-powered" href="https://chainflip.io" target="_blank" rel="noopener noreferrer">
              Powered by <b>Chainflip</b>
              <Icon name="external" />
            </a>
          )}
        </div>

        {error && (
          <div className="notice error-notice" role="status">
            <Icon name="info" />
            <p>{error}</p>
          </div>
        )}

        <div className="xswap-status-grid">
          <div>
            {showAddress && (
              <div className="xswap-deposit">
                <div className="xswap-deposit-amount">
                  <AssetIcon symbol={fromSymbol} chain={swap.fromAsset.chain} />
                  <div>
                    <span className="field-label">{received > BigInt(0) ? `${formatUnits(received, fromDecimals, fromDecimals)} ${fromSymbol} received. Send the remaining` : "Send exactly"}</span>
                    <strong>
                      <CopyAddress address={unitsToInput(stillToSend, fromDecimals)} label={`${fromSymbol} amount`} className="xswap-copy-amount">
                        {formatUnits(stillToSend, fromDecimals, fromDecimals)} {fromSymbol}
                      </CopyAddress>
                    </strong>
                    <small>on {swap.deposit.network}. Only {fromSymbol} on {swap.deposit.network}: anything else sent here is lost.</small>
                  </div>
                </div>
                <div className="xswap-qr">
                  <QRCodeSVG value={swap.deposit.address!} size={156} level="M" includeMargin bgColor="#ffffff" fgColor="#000000" />
                </div>
                <span className="field-label">To this address</span>
                <CopyAddress address={swap.deposit.address!} label="Deposit address" className="deposit-address" />
                <div className="address-actions">
                  <CopyAddress address={swap.deposit.address!} label="Deposit address" className="secondary-button">
                    <Icon name="copy" />
                    Copy address
                  </CopyAddress>
                </div>
                {startsAnywayAt ? (
                  <p className="muted small">
                    {now < startsAnywayAt ? (
                      <>
                        Send the rest within <b>{timeLeft(startsAnywayAt, now)}</b>. After that, what has arrived goes ahead on its own, or is returned if it is under the minimum. Anything sent later is returned to your refund address, less a network fee. {fromIsXmr ? "Amounts under 0.001 XMR are not returned." : "Amounts under 1 USDC are not returned."}
                      </>
                    ) : (
                      "What has arrived is about to go ahead on its own. Do not send more: it would be returned to your refund address, less a network fee."
                    )}
                  </p>
                ) : expiresAt && (
                  <p className="muted small">
                    {now < expiresAt ? (
                      <>
                        Open for <b>{timeLeft(expiresAt, now)}</b>.
                      </>
                    ) : (
                      "The deposit window has closed."
                    )}{" "}
                    {fromIsXmr ? "Sending later still works, at the price at that time." : "Do not send after that: a late deposit may not be recoverable."}
                  </p>
                )}
              </div>
            )}

            {swap.status === "allocating" && (
              <div className="address-pending">
                <span className="spinner" />
                <div>
                  <strong>Opening your deposit address</strong>
                  <p>{now - swap.createdAt > ALLOCATION_USUAL_MS ? "This usually takes a few seconds, but the service is busy, and it can take several minutes. Nothing has been sent, and there is nothing to send until an address appears here. If it cannot be opened, this page will say so." : "This usually takes a few seconds."}</p>
                </div>
              </div>
            )}

            {(swap.status === "swapping" || swap.status === "sending") && (
              <div className="xswap-outcome">
                <span className="spinner" />
                <div>
                  <strong>
                    {swap.status === "sending"
                      ? `Your ${toSymbol} is on its way`
                      : `We have your ${fromSymbol}. It is being swapped now.`}
                  </strong>
                  <p className="small muted">Nothing more to do. You can close this page: the swap keeps running, and this link brings you back to it.</p>
                </div>
              </div>
            )}

            {swap.status === "confirming" && !showAddress && (
              <div className="xswap-outcome">
                <span className="spinner" />
                <div>
                  <strong>
                    {swap.deposit.received ? `${formatUnits(swap.deposit.received, fromDecimals)} ${fromSymbol} received` : "Deposit received"}
                  </strong>
                  <p className="small muted">{waitingOnBridge ? "Confirmed. Waiting for the bridge to credit it." : fromIsXmr ? "Waiting for Monero confirmations." : "Waiting for confirmations on its network."} Nothing more to do.</p>
                </div>
              </div>
            )}

            {swap.status === "completed" && (
              <div className="xswap-outcome is-success">
                <Icon name="check" />
                <div>
                  <strong>
                    {swap.payout.amount ? `${formatUnits(swap.payout.amount, toDecimals)} ${toSymbol}` : toSymbol} sent to your destination address
                  </strong>
                  {swap.payout.tx && <TxLink asset={swap.to} tx={swap.payout.tx} label="View transaction" />}
                  {swap.payout.txKey && (
                    <p className="small muted">
                      Transaction key, to prove this payment: <code className="xswap-tx">{swap.payout.txKey}</code>
                    </p>
                  )}
                  {swap.refund.amount && (
                    <p className="small">
                      Part of this swap could not fill: {formatUnits(swap.refund.amount, refundDecimals, refundDecimals)} {refundSymbol} went back to your refund address.{" "}
                      {swap.refund.tx && <TxLink asset={swap.refund.asset?.id ?? swap.from} tx={swap.refund.tx} label="View refund transaction" />}
                    </p>
                  )}
                </div>
              </div>
            )}

            {(swap.status === "refunding" || swap.status === "refunded") && (
              <div className={`xswap-outcome ${swap.status === "refunded" ? "is-refund" : ""}`}>
                <Icon name={swap.status === "refunded" ? "check" : "clock"} />
                <div>
                  <strong>
                    {swap.status === "refunded"
                      ? `${swap.refund.amount ? `${formatUnits(swap.refund.amount, refundDecimals)} ${refundSymbol} ` : ""}refunded to your refund address`
                      : "Your funds are on their way back to your refund address"}
                  </strong>
                  {swap.refund.reason && <p className="small">{swap.refund.reason}</p>}
                  {swap.refund.tx && <TxLink asset={swap.refund.asset?.id ?? swap.from} tx={swap.refund.tx} label="View refund transaction" />}
                  {swap.refund.txKey && (
                    <p className="small muted">
                      Transaction key: <code className="xswap-tx">{swap.refund.txKey}</code>
                    </p>
                  )}
                </div>
              </div>
            )}

            {swap.status === "expired" && (
              <div className="xswap-outcome">
                <Icon name="clock" />
                <div>
                  <strong>No deposit arrived in time</strong>
                  <p className="small">Nothing was taken. {fromIsXmr ? "If XMR arrives at this address later, it is swapped at the live price, or returned to your refund address if that is below your minimum." : "Start a new swap for a new address."}</p>
                </div>
              </div>
            )}

            {swap.status === "failed" && (
              <div className="notice error-notice" role="alert">
                <Icon name="info" />
                <p>
                  {swap.error ?? "Something went wrong with this swap."} Keep your swap ID: <code className="xswap-tx">{swap.id}</code>
                </p>
              </div>
            )}

            {swap.needsAttention && !["failed", "completed", "refunded"].includes(swap.status) && (
              <div className="notice" role="status">
                <Icon name="info" />
                <p>This swap is taking longer than it should, and has been flagged for an operator. Your funds are accounted for. Your swap ID is <code className="xswap-tx">{swap.id}</code>.</p>
              </div>
            )}
          </div>

          <div className="xswap-status-side">
            <ol className="xswap-timeline">
              {swap.timeline.map((step) => (
                <li key={step.key} className={`is-${step.state}`} aria-current={step.state === "active" ? "step" : undefined}>
                  <span className="xswap-timeline-dot">{step.state === "done" ? <Icon name="check" /> : step.state === "active" ? <span className="swap-loading-dot" /> : null}</span>
                  <div>
                    <strong>{step.label}</strong>
                    {step.detail && <small>{step.detail}</small>}
                  </div>
                </li>
              ))}
            </ol>

            {fromIsXmr && required !== null && (awaiting || swap.status === "confirming") && (
              <div className="xswap-confirmations" aria-label="Monero confirmations">
                <div>
                  <span className="field-label">Monero confirmations</span>
                  <strong>
                    {Math.min(confirmations, required)} / {required}
                  </strong>
                </div>
                <progress value={Math.min(confirmations, required)} max={required} />
                <p className="small muted">
                  {startsAnywayAt
                    ? "It starts once the whole amount has arrived and confirmed, or goes ahead with what has arrived when that time is up. On the slow path that part still has to move through the bridge first."
                    : swap.reservePath === "fast"
                      ? heldUntil && now < heldUntil
                        ? `Reserves are held for this swap unless an older swap reaches its turn first. It starts after ${required} confirmation${required === 1 ? "" : "s"}.`
                        : `Starts after ${required} confirmation${required === 1 ? "" : "s"}, as long as reserves still cover it when your deposit is seen.`
                      : waitingOnBridge
                        ? "Your XMR is on its way through the bridge. The swap starts when it has been credited, or when reserves can cover it."
                        : "Your XMR moves through the bridge first."}
                </p>
              </div>
            )}

            <dl className="xswap-recap">
              <div>
                <dt>Estimated</dt>
                <dd>
                  {formatUnits(swap.estimatedOut, toDecimals)} {toSymbol}
                </dd>
              </div>
              <div>
                <dt>Or refunded below</dt>
                <dd>
                  {formatUnits(swap.minOut, toDecimals)} {toSymbol}
                </dd>
              </div>
              {swap.deposit.received && (
                <div>
                  <dt>Received</dt>
                  <dd>
                    {formatUnits(swap.deposit.received, fromDecimals, fromDecimals)} {fromSymbol}
                    {swap.deposit.tx && (
                      <>
                        {" "}
                        <TxLink asset={swap.from} tx={swap.deposit.tx} label="tx" />
                      </>
                    )}
                  </dd>
                </div>
              )}
              <div>
                <dt>Destination</dt>
                <dd>
                  <CopyAddress address={swap.destinationAddress} label="Destination address" className="break-all" />
                </dd>
              </div>
              <div>
                <dt>Refund</dt>
                <dd>
                  <CopyAddress address={swap.refundAddress} label="Refund address" className="break-all" />
                </dd>
              </div>
              <div>
                <dt>Swap ID</dt>
                <dd>
                  <CopyAddress address={swap.id} label="Swap ID" className="break-all" />
                </dd>
              </div>
              {chainflipLinks.map((link) => (
                <div key={link.href}>
                  <dt>Chainflip</dt>
                  <dd>
                    <a className="text-link small" href={link.href} target="_blank" rel="noopener noreferrer">
                      {link.label}
                      <Icon name="external" />
                    </a>
                  </dd>
                </div>
              ))}
            </dl>
            {chainflipNote && <p className="small muted xswap-chainflip-note">{chainflipNote}</p>}

            {swap.events.length > 0 && (
              <details className="xswap-fees">
                <summary>
                  Activity
                  <Icon name="chevron" />
                </summary>
                <ol className="xswap-events">
                  {swap.events.map((event, index) => (
                    <li key={`${event.at}-${index}`}>
                      <time>{new Date(event.at).toLocaleTimeString()}</time> {event.message}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </div>
        </div>

        <p className="xswap-aml">
          <Icon name="shield" />
          <span>{refundNotice(swap.from, swap.to)}</span>
        </p>
        <button type="button" className="text-button xswap-another" onClick={onStartAnother}>
          {TERMINAL.includes(swap.status) || swap.status === "expired" ? "Start a new swap" : "Back to the swap form"}
          <Icon name="arrow" />
        </button>
      </div>
    </section>
  );
}

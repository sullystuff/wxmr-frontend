"use client";

import { useRef, useState } from "react";
import { formatUnits, swapApi, type DecisionAction, type DecisionQuote, type SwapOrder } from "@/lib/swap-api";

/** A quote is a separate step from authorizing it. Refreshing never accepts a changed price. */
export function SwapDecision({ swap, token, now }: { swap: SwapOrder; token: string | null; now: number }) {
  const [quote, setQuote] = useState<DecisionQuote | null>(null);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState("");
  const working = useRef(false);
  const decision = swap.decision!;
  const expired = !!quote && quote.expiresAt <= now;
  const waiting = queued && !expired;
  const output = quote?.asset === "XMR.Monero" ? swap.toAsset : quote?.asset === "USDC.Solana" ? decision.asset : swap.fromAsset;

  const price = async (action: DecisionAction) => {
    if (!token || working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    setQuote(null);
    setQueued(false);
    try { setQuote(await swapApi.decisionQuote(swap.id, token, action, action === "receive_usdc" ? address.trim() : undefined)); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not price this choice. Your USDC is still held."); }
    finally { working.current = false; setBusy(false); }
  };

  const confirm = async () => {
    if (!token || !quote || quote.expiresAt <= Date.now() || working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await swapApi.decide(swap.id, token, quote.id);
      setQueued(true);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not submit your choice. Check the swap status before trying again."); }
    finally { working.current = false; setBusy(false); }
  };

  return (
    <div className="xswap-decision" aria-labelledby="swap-decision-title">
      <h3 id="swap-decision-title">Choose what happens next</h3>
      <p>{decision.message}</p>
      <p><strong>{formatUnits(decision.amount, 6, 6)} USDC held on Solana</strong></p>
      {swap.refund.amount && swap.refund.asset && <p className="small">Already returned: {formatUnits(swap.refund.amount, swap.refund.asset.decimals, swap.refund.asset.decimals)} {swap.refund.asset.symbol}. The held amount above is the remaining USDC.</p>}
      {decision.reason && <p className="small muted">{decision.reason}</p>}
      {!token || decision.actions.length === 0 ? (
        <p className="notice">Open the private recovery link you saved when creating this swap to use these controls. A public status link cannot authorize a payment. If you have lost access, contact support with your swap ID.</p>
      ) : (
        <>
          <div className="xswap-decision-options">
            <button type="button" className="secondary-button" disabled={busy || waiting} onClick={() => void price("continue_xmr")}>Get a fresh XMR quote</button>
            <button type="button" className="secondary-button" disabled={busy || waiting} onClick={() => void price("return_source")}>Quote a return to {swap.fromAsset.symbol}</button>
            <label htmlFor="decision-usdc-address">Receive USDC on Solana</label>
            <input id="decision-usdc-address" aria-describedby="decision-usdc-help" value={address} maxLength={128} autoComplete="off" spellCheck={false} disabled={busy || waiting} onChange={(event) => { setAddress(event.target.value); if (quote?.action === "receive_usdc") setQuote(null); }} placeholder="Your Solana wallet address" />
            <small id="decision-usdc-help">Use a wallet that supports USDC on Solana. Check the network and address carefully.</small>
            <button type="button" className="secondary-button" disabled={!address.trim() || busy || waiting} onClick={() => void price("receive_usdc")}>Review USDC transfer</button>
          </div>
          {quote && (
            <div className="xswap-decision-review" aria-live="polite">
              <h4>{quote.action === "continue_xmr" ? "Continue to XMR" : quote.action === "return_source" ? `Convert back to ${output.symbol}` : "Receive USDC on Solana"}</h4>
              <dl className="xswap-recap">
                <div><dt>You receive about</dt><dd>{formatUnits(quote.estimatedOut, output.decimals, output.decimals)} {output.symbol}</dd></div>
                <div><dt>Minimum received</dt><dd>{formatUnits(quote.minOut, output.decimals, output.decimals)} {output.symbol}</dd></div>
                <div><dt>Network</dt><dd>{output.chainName}</dd></div>
                <div><dt>Send to</dt><dd className="break-all">{quote.destinationAddress}</dd></div>
              </dl>
              {quote.fees.length > 0 ? <><p className="small">Fees included in the receive estimate:</p><ul className="small">{quote.fees.map((fee, index) => {
                const asset = fee.asset === "USDC.Solana" ? decision.asset : fee.asset === swap.from ? swap.fromAsset : fee.asset === "XMR.Monero" ? swap.toAsset : null;
                return <li key={index}>{fee.label}{asset ? `: ${formatUnits(fee.amount, asset.decimals, asset.decimals)} ${asset.symbol}` : " (included)"}</li>;
              })}</ul></> : <p className="small">No additional service fee. You receive the full held USDC amount.</p>}
              {quote.warnings.map((warning) => <p className="small" key={warning}>{warning}</p>)}
              {waiting ? <p role="status">Your choice is queued. Waiting for the service to accept it; the status will update here.</p> : expired ? <p role="status">This quote expired. Get a fresh quote to review and confirm.</p> : <p className="small muted">Quote valid for {Math.max(0, Math.ceil((quote.expiresAt - now) / 1000))} seconds.</p>}
              <button type="button" className="primary-button" disabled={busy || expired || waiting} onClick={() => void confirm()}>{busy ? "Submitting…" : waiting ? "Choice queued" : quote.action === "continue_xmr" ? "Accept quote and continue to XMR" : quote.action === "return_source" ? `Approve conversion back to ${output.symbol}` : "Confirm USDC address and send"}</button>
            </div>
          )}
          {error && <p className="field-error" role="alert">{error}</p>}
        </>
      )}
    </div>
  );
}

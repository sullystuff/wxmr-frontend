"use client";

import { useEffect, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { utils } from "@coral-xyz/anchor";
import { VersionedTransaction } from "@solana/web3.js";
import { WalletButton } from "./BridgeShell";
import { SWAP_TOKENS, SWAP_FEE_BPS, getSwapFeeAccount, parseSwapAmount, formatSwapAmount,
  type SwapQuote, type PendingSwap } from "@/lib/jupiter-swap";

const PENDING_KEY = "wxmr:jupiter-pending:v1";

async function readResponse(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to load this swap.");
  return data;
}

export function JupiterSwap({ onSwapConfirmed }: { onSwapConfirmed?: () => void }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [token, setToken] = useState<"SOL" | "USDC">("SOL");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(50);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [clock, setClock] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingSwap | null>(null);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [signature, setSignature] = useState("");
  const requestId = useRef(0);
  const actionInProgress = useRef(false);
  const inputSymbol = side === "buy" ? token : "wXMR";
  const outputSymbol = side === "buy" ? "wXMR" : token;
  const units = parseSwapAmount(amount, SWAP_TOKENS[inputSymbol].decimals);

  useEffect(() => {
    // Recover the exact signed intent after a reload, without sending it again.
    try {
      const saved = localStorage.getItem(PENDING_KEY);
      if (saved) {
        const record = JSON.parse(saved) as PendingSwap;
        if (!record.signature || !record.signedTransaction || !record.wallet) throw new Error("Invalid pending swap");
        setPending(record);
        setSignature(record.signature);
        setMessage("A previous swap needs confirmation. Check its status before swapping again.");
      }
    } catch {
      setRecoveryBlocked(true);
      setError("Your browser could not read saved swap status. Check previous transactions before swapping.");
    }
  }, []);

  useEffect(() => {
    if (!quote) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [quote]);

  const invalidateQuote = () => {
    requestId.current++;
    setQuote(null);
    setError("");
    setMessage("");
  };

  const getQuote = async () => {
    if (!units || actionInProgress.current || pending || recoveryBlocked) return;
    actionInProgress.current = true;
    const id = ++requestId.current;
    setBusy(true);
    setQuote(null);
    setError("");
    setMessage("");
    try {
      const params = new URLSearchParams({ side, token, amount: units, slippageBps: String(slippage) });
      const result: SwapQuote = await readResponse(await fetch(`/api/jupiter?${params}`, { cache: "no-store" }));
      if (requestId.current !== id) return;
      setClock(Date.now());
      setQuote(result);
    } catch (err) {
      if (requestId.current === id) setError(err instanceof Error ? err.message : "Unable to get a quote.");
    } finally { actionInProgress.current = false; setBusy(false); }
  };

  const finish = (record: PendingSwap, failed: boolean) => {
    localStorage.removeItem(PENDING_KEY);
    setPending(null);
    setSignature(record.signature);
    setQuote(null);
    if (failed) setError("The swap failed on chain. Get a fresh quote before trying again.");
    else { setMessage("Swap confirmed."); setAmount(""); onSwapConfirmed?.(); }
  };

  const swap = async () => {
    if (!quote || !wallet.publicKey || !wallet.signTransaction || pending || recoveryBlocked || actionInProgress.current) return;
    if (Date.now() >= quote.expiresAt) { setError("Your quote expired. Get a fresh quote."); return; }
    actionInProgress.current = true;
    setBusy(true);
    setError("");
    setMessage("Preparing your swap…");
    let record: PendingSwap | undefined;
    try {
      const publicKey = wallet.publicKey;
      const result = await readResponse(await fetch("/api/jupiter", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quoteId: quote.id, wallet: publicKey.toBase58() }) }));
      const transaction = VersionedTransaction.deserialize(Uint8Array.from(atob(result.swapTransaction), c => c.charCodeAt(0)));
      if (!transaction.message.staticAccountKeys[0].equals(publicKey)
        || !transaction.message.staticAccountKeys.some(key => key.toBase58() === getSwapFeeAccount(quote.outputMint))
        || !wallet.wallet?.adapter.publicKey?.equals(publicKey)) throw new Error("The wallet or swap changed. Get a fresh quote.");
      setMessage("Approve the swap in your wallet.");
      const originalMessage = transaction.message.serialize();
      const signed = await wallet.signTransaction(transaction);
      if (!Buffer.from(signed.message.serialize()).equals(Buffer.from(originalMessage))) throw new Error("The wallet changed the swap transaction.");
      const signedRecord = { wallet: publicKey.toBase58(), signature: utils.bytes.bs58.encode(signed.signatures[0]),
        signedTransaction: btoa(String.fromCharCode(...signed.serialize())), blockhash: signed.message.recentBlockhash,
        lastValidBlockHeight: result.lastValidBlockHeight };
      // Persist signed bytes and their identity BEFORE any network submission.
      localStorage.setItem(PENDING_KEY, JSON.stringify(signedRecord));
      record = signedRecord;
      setPending(record);
      setSignature(record.signature);
      setMessage("Swap submitted. Waiting for confirmation…");
      const sent = await connection.sendRawTransaction(signed.serialize(), { maxRetries: 0, skipPreflight: false });
      if (sent !== record.signature) throw new Error("Unexpected transaction signature.");
      const confirmation = await connection.confirmTransaction({ signature: record.signature,
        blockhash: record.blockhash, lastValidBlockHeight: record.lastValidBlockHeight }, "confirmed");
      finish(record, Boolean(confirmation.value.err));
    } catch (err) {
      setMessage("");
      setQuote(null);
      setError(record
        ? "Confirmation is uncertain. Your signed transaction is saved in this browser. Check its status before another swap."
        : err instanceof Error ? err.message : "Unable to prepare this swap.");
    } finally { actionInProgress.current = false; setBusy(false); }
  };

  const checkStatus = async () => {
    if (!pending || actionInProgress.current) return;
    actionInProgress.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await connection.getSignatureStatuses([pending.signature], { searchTransactionHistory: true });
      const status = result.value[0];
      if (status && ["confirmed", "finalized"].includes(status.confirmationStatus ?? "")) finish(pending, Boolean(status.err));
      else setMessage("This swap is not confirmed yet. Its signed transaction remains saved; check the explorer before another swap.");
    } catch { setError("Unable to confirm this swap yet. Its signed transaction is still saved."); }
    finally { actionInProgress.current = false; setBusy(false); }
  };

  const expired = quote !== null && clock >= quote.expiresAt;
  return (
    <section id="swap" className="jupiter-swap-panel" aria-labelledby="swap-title">
      <div className="jupiter-swap-copy">
        <p className="eyebrow">TRADE ON SOLANA</p>
        <h2 id="swap-title">Swap wXMR.</h2>
        <p>Buy or sell wrapped Monero with SOL or USDC, right here.</p>
        <p className="jupiter-swap-note">Powered by Jupiter. {SWAP_FEE_BPS / 100}% referral fee included in your quote. Network fees and token account rent are additional.</p>
        <p className="jupiter-swap-note">To move native XMR to or from Monero, use the bridge above.</p>
      </div>
      <div className="jupiter-swap-card">
        <fieldset disabled={busy || Boolean(pending) || recoveryBlocked}>
          <div className="direction-selector" aria-label="Swap direction">
            <button type="button" className={side === "buy" ? "selected" : ""} aria-pressed={side === "buy"}
              onClick={() => { setSide("buy"); setAmount(""); invalidateQuote(); }}>Buy wXMR</button>
            <button type="button" className={side === "sell" ? "selected" : ""} aria-pressed={side === "sell"}
              onClick={() => { setSide("sell"); setAmount(""); invalidateQuote(); }}>Sell wXMR</button>
          </div>
          <label className="swap-field">{side === "buy" ? "Pay with" : "Receive"}
            <select aria-label={side === "buy" ? "Pay with" : "Receive"} value={token} onChange={event => { setToken(event.target.value as "SOL" | "USDC"); setAmount(""); invalidateQuote(); }}>
              <option value="SOL">SOL</option><option value="USDC">USDC</option>
            </select>
          </label>
          <label className="swap-field">You pay ({inputSymbol})
            <input inputMode="decimal" autoComplete="off" placeholder="0.00" maxLength={40} value={amount}
              onChange={event => { setAmount(event.target.value); invalidateQuote(); }} />
          </label>
          <label className="swap-field">Slippage tolerance
            <select aria-label="Slippage tolerance" value={slippage} onChange={event => { setSlippage(Number(event.target.value)); invalidateQuote(); }}>
              <option value="10">0.1%</option><option value="50">0.5%</option><option value="100">1%</option>
            </select>
          </label>
          {quote && <div className="swap-quote" aria-live="polite">
            <span>You receive approximately</span>
            <strong>{formatSwapAmount(quote.outAmount, SWAP_TOKENS[outputSymbol].decimals)} {outputSymbol}</strong>
            <p>Minimum received: {formatSwapAmount(quote.minimumReceived, SWAP_TOKENS[outputSymbol].decimals)} {outputSymbol}</p>
            <p>Price impact: {quote.priceImpactPct}% · Fee: {quote.feeBps / 100}% included</p>
            <p>{expired ? "Quote expired. Refresh to continue." : "Quote valid for 30 seconds."}</p>
          </div>}
          <button type="button" className="secondary-button swap-action" disabled={!units} onClick={getQuote}>
            {busy ? "Please wait…" : quote ? "Refresh quote" : "Get quote"}
          </button>
        </fieldset>
        {!wallet.connected ? <div className="swap-wallet"><WalletButton /></div> : !pending &&
          <button type="button" className="primary-button swap-action" disabled={busy || recoveryBlocked || !quote || expired || !wallet.signTransaction} onClick={swap}>
            {busy ? "Please wait…" : "Review & swap"}
          </button>}
        {pending && <button type="button" className="secondary-button swap-action" disabled={busy} onClick={checkStatus}>Check swap status</button>}
        {message && <p className="jupiter-swap-note" role="status">{message}</p>}
        {error && <p className="swap-error" role="alert">{error}</p>}
        {signature && <a className="text-link swap-transaction" href={`https://solscan.io/tx/${signature}`} target="_blank" rel="noopener noreferrer">View swap transaction ↗</a>}
      </div>
    </section>
  );
}

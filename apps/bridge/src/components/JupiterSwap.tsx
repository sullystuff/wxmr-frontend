"use client";

import { useEffect, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { utils } from "@coral-xyz/anchor";
import { VersionedTransaction } from "@solana/web3.js";
import { Icon } from "./BridgeIcons";
import { SwapTokenIcon, SwapTokenSelector } from "./SwapTokenSelector";
import { JupiterApiError, jupiterSwapClient } from "@/lib/jupiter-swap-client";
import { validateWalletSignedSwap } from "@/lib/swap-wallet-validation";
import { WalletButton } from "./BridgeShell";
import { SWAP_TOKENS, SWAP_FEE_ACCOUNT, parseSwapAmount, formatSwapAmount,
  type SwapQuote, type PendingSwap, type SwapToken } from "@/lib/jupiter-swap";

const PENDING_KEY = "wxmr:jupiter-pending:v1";

export function JupiterSwap({ onSwapConfirmed }: { onSwapConfirmed?: () => void }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [token, setToken] = useState<SwapToken>(SWAP_TOKENS.SOL);
  const [selectingToken, setSelectingToken] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [clock, setClock] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingSwap | null>(null);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [signature, setSignature] = useState("");
  const actionInProgress = useRef(false);
  const inputToken = side === "buy" ? token : SWAP_TOKENS.wXMR;
  const outputToken = side === "buy" ? SWAP_TOKENS.wXMR : token;
  const units = parseSwapAmount(amount, inputToken.decimals);

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
    const update = () => { setPageVisible(!document.hidden); setClock(Date.now()); };
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    if (!quote || !pageVisible) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [quote, pageVisible]);

  useEffect(() => {
    if (!units || busy || pending || recoveryBlocked || !pageVisible || selectingToken) {
      setQuoteLoading(false);
      return;
    }
    const controller = new AbortController();
    let timer: number;
    const refresh = async () => {
      setQuoteLoading(true);
      let nextRefresh = 10_000;
      try {
        const result = await jupiterSwapClient.quote(side, token, units, controller.signal);
        if (controller.signal.aborted) return;
        setQuote(result);
        setQuoteError("");
        setClock(Date.now());
      } catch (err) {
        if (controller.signal.aborted) return;
        setQuote(null);
        setQuoteError(err instanceof Error ? err.message : "Unable to update this price.");
        if (err instanceof JupiterApiError) nextRefresh = Math.max(10_000, err.retryAfterMs);
      } finally {
        if (!controller.signal.aborted) {
          setQuoteLoading(false);
          timer = window.setTimeout(refresh, nextRefresh);
        }
      }
    };
    timer = window.setTimeout(refresh, 450);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [units, side, token, busy, pending, recoveryBlocked, pageVisible, selectingToken]);

  const invalidateQuote = () => { setQuote(null); setQuoteError(""); setError(""); setMessage(""); };

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
      const result = await jupiterSwapClient.build(quote, publicKey.toBase58());
      const transaction = result.transaction;
      if (!transaction.message.staticAccountKeys[0].equals(publicKey)
        || !transaction.message.staticAccountKeys.some(key => key.toBase58() === SWAP_FEE_ACCOUNT)
        || !wallet.wallet?.adapter.publicKey?.equals(publicKey)) throw new Error("The wallet or swap changed. Get a fresh quote.");
      setMessage("Approve the swap in your wallet.");
      const original = VersionedTransaction.deserialize(transaction.serialize());
      const signed = await wallet.signTransaction(transaction);
      validateWalletSignedSwap(original, signed, publicKey);
      const signedRecord = { wallet: publicKey.toBase58(), signature: utils.bytes.bs58.encode(signed.signatures[0]),
        signedTransaction: btoa(String.fromCharCode(...signed.serialize())), blockhash: signed.message.recentBlockhash,
        lastValidBlockHeight: signed.message.recentBlockhash === original.message.recentBlockhash ? result.lastValidBlockHeight : undefined };
      // Persist signed bytes and their identity BEFORE any network submission.
      localStorage.setItem(PENDING_KEY, JSON.stringify(signedRecord));
      record = signedRecord;
      setPending(record);
      setSignature(record.signature);
      setMessage("Swap submitted. Waiting for confirmation…");
      const sent = await connection.sendRawTransaction(signed.serialize(), { maxRetries: 0, skipPreflight: false });
      if (sent !== record.signature) throw new Error("Unexpected transaction signature.");
      const confirmation = record.lastValidBlockHeight
        ? await connection.confirmTransaction({ signature: record.signature, blockhash: record.blockhash, lastValidBlockHeight: record.lastValidBlockHeight }, "confirmed")
        : await connection.confirmTransaction(record.signature, "confirmed");
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
  const shownQuote = quote && quote.inAmount === units && quote.inputMint === inputToken.mint && quote.outputMint === outputToken.mint ? quote : null;
  const received = shownQuote ? formatSwapAmount(shownQuote.outAmount, outputToken.decimals) : "0.00";
  const locked = busy || Boolean(pending) || recoveryBlocked;
  const tokenPill = (selected: SwapToken, label: string) => selected.mint === SWAP_TOKENS.wXMR.mint
    ? <span className="swap-token-pill"><SwapTokenIcon token={selected} /><span>wXMR</span></span>
    : <button type="button" className="swap-token-pill" aria-label={label} disabled={locked} onClick={() => setSelectingToken(true)}>
        <SwapTokenIcon token={selected} /><span>{selected.symbol}</span><Icon name="chevron" />
      </button>;

  return (
    <section id="swap" className="jupiter-swap-panel" aria-labelledby="swap-title">
      <div className="jupiter-swap-copy">
        <p className="eyebrow">TRADE ON SOLANA</p>
        <h2 id="swap-title">Swap wXMR.</h2>
        <p>Swap between wrapped Monero and Solana tokens, right here.</p>
        <p className="jupiter-swap-note">Moving native XMR? Use the bridge above.</p>
      </div>
      <div className="jupiter-swap-card">
        <div className="swap-card-heading"><h3>Swap</h3><span>Solana</span></div>
        <fieldset disabled={locked}>
          <div className="swap-amount-block">
            <label htmlFor="swap-pay-amount">You pay</label>
            <div className="swap-amount-row">
              <input id="swap-pay-amount" aria-label="Amount to swap" inputMode="decimal" autoComplete="off" placeholder="0.00" maxLength={40} value={amount}
                onChange={event => { setAmount(event.target.value); invalidateQuote(); }} />
              {tokenPill(inputToken, "Select token to pay")}
            </div>
            <span className="swap-token-name">{inputToken.name}</span>
          </div>
          <div className="swap-reverse-row"><button type="button" className="swap-reverse" aria-label="Reverse swap direction" onClick={() => {
            const nextAmount = shownQuote ? formatSwapAmount(shownQuote.outAmount, outputToken.decimals) : "";
            setSide(side === "buy" ? "sell" : "buy"); setAmount(nextAmount); invalidateQuote();
          }}><Icon name="arrow" /></button></div>
          <div className="swap-amount-block swap-receive-block">
            <span className="swap-amount-label">You receive</span>
            <div className="swap-amount-row">
              <output className={shownQuote ? "swap-output-amount" : "swap-output-amount is-empty"} aria-label="Estimated amount received" aria-live="polite" title={received}>{received}</output>
              {tokenPill(outputToken, "Select token to receive")}
            </div>
            <span className="swap-token-name">{outputToken.name}</span>
          </div>
        </fieldset>
        <div className="swap-price-status" role="status">
          {quoteLoading ? <><span className="swap-loading-dot" />Finding the best price…</> : shownQuote && !expired ? <><Icon name="check" />Price updates automatically</> : units ? "Updating price…" : "Enter an amount to get started"}
        </div>
        {pending ? <button type="button" className="primary-button swap-action" disabled={busy} onClick={checkStatus}>Check swap status</button>
          : !wallet.connected ? <div className="swap-wallet"><WalletButton /></div>
          : <button type="button" className="primary-button swap-action" disabled={locked || !shownQuote || quoteLoading || expired || !wallet.signTransaction} onClick={swap}>
              {busy ? "Please wait…" : !units ? "Enter an amount" : quoteLoading ? "Finding the best price…" : "Swap"}
            </button>}
        <p className="swap-powered">Powered by <a href="https://jup.ag" target="_blank" rel="noopener noreferrer">Jupiter ↗</a></p>
        {message && <p className="jupiter-swap-note" role="status">{message}</p>}
        {(error || quoteError) && <p className="swap-error" role="alert">{error || quoteError}</p>}
        {signature && <a className="text-link swap-transaction" href={`https://solscan.io/tx/${signature}`} target="_blank" rel="noopener noreferrer">View swap transaction ↗</a>}
      </div>
      {selectingToken && <SwapTokenSelector selected={token} onClose={() => setSelectingToken(false)} onSelect={selected => { setToken(selected); setAmount(""); invalidateQuote(); }} />}
    </section>
  );
}

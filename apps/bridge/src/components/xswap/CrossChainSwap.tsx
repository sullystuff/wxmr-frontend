"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { BridgeDialog } from "../BridgeDialog";
import { Icon } from "../BridgeIcons";
import { MoneroQrScanner } from "../MoneroQrScanner";
import { AssetIcon, ChainGlyph } from "./AssetIcon";
import { AssetPicker } from "./AssetPicker";
import { ReserveNotice, RoutePanel } from "./RoutePanel";
import { SwapProgress } from "./SwapProgress";
import {
  SwapApiError,
  XMR_ASSET_ID,
  formatDuration,
  formatUnits,
  formatUsd,
  parseUnits,
  readRecentSwaps,
  refundNotice,
  rememberSwap,
  routeUsesChainflip,
  swapApi,
  unitsToInput,
  type RecentSwap,
  type SwapAsset,
  type SwapQuote,
  type SwapReserves,
} from "@/lib/swap-api";

const QUOTE_REFRESH_MS = 15_000;
const ASSETS_RETRY_MS = 15_000;
/** Only these are about the amount. Anything else, such as being busy, is not fixed by changing it. */
const AMOUNT_ERRORS = ["below_minimum", "above_maximum", "price_impact", "invalid_request"];
const QUOTE_DEBOUNCE_MS = 450;
const RESERVES_REFRESH_MS = 30_000;
const ADDRESS_DEBOUNCE_MS = 350;
const SLIPPAGE_CHOICES = [50, 100, 200, 300];

type AddressState = { status: "idle" | "checking" | "valid" } | { status: "invalid"; reason: string };

/** Checks an address against the same rules the backend and Chainflip will apply. */
function useAddressCheck(chain: string | undefined, address: string): AddressState {
  const [result, setResult] = useState<{ key: string; state: AddressState } | null>(null);
  const value = address.trim();
  const key = `${chain}|${value}`;
  useEffect(() => {
    if (!value || !chain) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      swapApi
        .validateAddress(chain, value, controller.signal)
        .then((check) => setResult({ key, state: check.valid ? { status: "valid" } : { status: "invalid", reason: check.reason ?? "not a valid address" } }))
        .catch(() => {
          // Unknown is not invalid: the backend still checks it on submit.
          if (!controller.signal.aborted) setResult({ key, state: { status: "idle" } });
        });
    }, ADDRESS_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [chain, value, key]);
  if (!value || !chain) return { status: "idle" };
  return result?.key === key ? result.state : { status: "checking" };
}

function AddressField({
  id,
  label,
  help,
  chain,
  chainName,
  value,
  state,
  disabled,
  onChange,
  onScan,
  onUseWallet,
}: {
  id: string;
  label: string;
  help: string;
  chain: string | undefined;
  chainName: string | undefined;
  value: string;
  state: AddressState;
  disabled: boolean;
  onChange: (value: string) => void;
  onScan?: () => void;
  onUseWallet?: () => void;
}) {
  return (
    <div className="xswap-address">
      <div className={`xswap-address-box ${state.status === "invalid" ? "has-error" : state.status === "valid" ? "is-valid" : ""}`}>
        {chain && <ChainGlyph chain={chain} />}
        <input
          id={id}
          aria-label={`${label}${chainName ? ` on ${chainName}` : ""}`}
          aria-describedby={`${id}-help`}
          aria-invalid={state.status === "invalid"}
          placeholder={label}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={128}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {onUseWallet && !value && (
          <button type="button" className="xswap-inline-button" disabled={disabled} onClick={onUseWallet}>
            Use wallet
          </button>
        )}
        {onScan && (
          <button type="button" aria-label={`Scan ${label.toLowerCase()} QR code`} disabled={disabled} onClick={onScan}>
            <Icon name="qr" />
          </button>
        )}
        {state.status === "valid" && <Icon name="check" className="xswap-address-ok" />}
      </div>
      {state.status === "invalid" ? (
        <p id={`${id}-help`} className="field-error">
          {state.reason.charAt(0).toUpperCase() + state.reason.slice(1)}.
        </p>
      ) : (
        <p id={`${id}-help`} className="xswap-address-help">
          {help}
        </p>
      )}
    </div>
  );
}

export function CrossChainSwap({ active }: { active: boolean }) {
  const wallet = useWallet();
  const [assets, setAssets] = useState<SwapAsset[]>([]);
  const [assetsError, setAssetsError] = useState("");
  const [reserves, setReserves] = useState<SwapReserves | null>(null);
  const [from, setFrom] = useState("BTC.Bitcoin");
  const [to, setTo] = useState(XMR_ASSET_ID);
  const [amount, setAmount] = useState("");
  const [refund, setRefund] = useState("");
  const [destination, setDestination] = useState("");
  const [picking, setPicking] = useState<"deposit" | "receive" | null>(null);
  const [slippageBps, setSlippageBps] = useState<number | null>(null);
  const [boost, setBoost] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quotedKey, setQuotedKey] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<{ message: string; code?: string; minAmount?: string } | null>(null);
  const [clock, setClock] = useState(0);
  const [pageVisible, setPageVisible] = useState(true);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [swapId, setSwapId] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentSwap[]>([]);
  const [scanning, setScanning] = useState<"refund" | "destination" | null>(null);
  const creatingRef = useRef(false);
  /** A quote opens one swap. After a lost answer the same quote finds that swap, but after these it has nothing more to give. */
  const usedQuotesRef = useRef(new Set<string>());

  const fromAsset = useMemo(() => assets.find((asset) => asset.id === from), [assets, from]);
  const toAsset = useMemo(() => assets.find((asset) => asset.id === to), [assets, to]);
  const units = fromAsset ? parseUnits(amount, fromAsset.decimals) : null;
  const fromIsXmr = from === XMR_ASSET_ID;
  const toIsXmr = to === XMR_ASSET_ID;

  const refundCheck = useAddressCheck(fromAsset?.chain, refund);
  const destinationCheck = useAddressCheck(toAsset?.chain, destination);

  // A link to a swap, or the last one this browser was watching.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("swap");
    if (id && /^[0-9a-f]{32}$/.test(id)) setSwapId(id);
    setRecent(readRecentSwaps());
  }, []);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: number;
    const load = () =>
      swapApi
        .assets(controller.signal)
        .then((list) => {
          setAssets(list);
          setAssetsError("");
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setAssetsError(error instanceof Error ? error.message : "The swap service cannot be reached right now.");
          // Without the list the form cannot be used at all, so this keeps trying.
          timer = window.setTimeout(load, ASSETS_RETRY_MS);
        });
    void load();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [active]);

  useEffect(() => {
    const update = () => {
      setPageVisible(!document.hidden);
      setClock(Date.now());
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    if (!quote || !pageVisible || !active) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [quote, pageVisible, active]);

  // Reserves matter out of XMR, including before an amount is entered. Bridge health matters both ways.
  useEffect(() => {
    if (!active || !pageVisible || !(fromIsXmr || toIsXmr) || swapId) return;
    const controller = new AbortController();
    const load = () => swapApi.reserves(controller.signal).then(setReserves).catch(() => undefined);
    void load();
    const timer = window.setInterval(load, RESERVES_REFRESH_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [active, pageVisible, fromIsXmr, toIsXmr, swapId]);

  const amountKey = units?.toString() ?? null;
  // Everything that changes the price. A quote only counts for the exact inputs it was made for.
  const quoteKey = `${from}|${to}|${amountKey}|${slippageBps ?? "auto"}|${boost}`;
  useEffect(() => {
    setQuoteError(null);
    if (!amountKey || amountKey === "0" || !active || !pageVisible || picking || swapId || reviewOpen) {
      setQuoteLoading(false);
      if (!amountKey || amountKey === "0") setQuote(null);
      return;
    }
    const controller = new AbortController();
    let timer: number;
    const refresh = async () => {
      setQuoteLoading(true);
      let next = QUOTE_REFRESH_MS;
      try {
        const result = await swapApi.quote({ from, to, amount: amountKey, slippageBps: slippageBps ?? undefined, boost }, controller.signal);
        if (controller.signal.aborted) return;
        setQuote(result);
        setQuotedKey(quoteKey);
        setQuoteError(null);
        setClock(Date.now());
      } catch (error) {
        if (controller.signal.aborted) return;
        setQuote(null);
        if (error instanceof SwapApiError) {
          setQuoteError({ message: error.message, code: error.code, minAmount: error.details.minAmount });
          if (error.status === 429) next = 30_000;
        } else {
          setQuoteError({ message: "Could not get a price. Trying again shortly." });
        }
      } finally {
        if (!controller.signal.aborted) {
          setQuoteLoading(false);
          timer = window.setTimeout(refresh, next);
        }
      }
    };
    timer = window.setTimeout(refresh, QUOTE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [quoteKey, amountKey, from, to, slippageBps, boost, active, pageVisible, picking, swapId, reviewOpen]);

  const secondsLeft = quote ? Math.max(0, Math.ceil((quote.expiresAt - clock) / 1000)) : null;
  const shownQuote = quote && quotedKey === quoteKey ? quote : null;
  const outText = shownQuote && toAsset ? formatUnits(shownQuote.estimatedOut, toAsset.decimals) : "0";

  const reverse = () => {
    const nextAmount = shownQuote && toAsset ? unitsToInput(shownQuote.estimatedOut, toAsset.decimals) : "";
    setFrom(to);
    setTo(from);
    setRefund(destination);
    setDestination(refund);
    setAmount(nextAmount);
    setQuote(null);
    setQuoteError(null);
  };

  const selectAsset = (side: "deposit" | "receive", id: string) => {
    // Choosing what is already on the other side flips the swap, rather than dead-ending.
    if (id === (side === "deposit" ? to : from)) {
      reverse();
      return;
    }
    if (side === "deposit") {
      if (id !== from) {
        setRefund("");
        // "0.5" means something else entirely in the new asset.
        setAmount("");
      }
      setFrom(id);
    } else {
      if (id !== to) setDestination("");
      setTo(id);
    }
    setQuote(null);
    setQuoteError(null);
  };

  const canReview =
    Boolean(shownQuote) &&
    !quoteLoading &&
    refundCheck.status !== "invalid" &&
    destinationCheck.status !== "invalid" &&
    refund.trim().length > 0 &&
    destination.trim().length > 0;

  const amountInvalid = amount.trim().length > 0 && units === null;
  const actionLabel = !units
    ? amountInvalid
      ? "Check the amount"
      : "Enter an amount"
    : quoteError && AMOUNT_ERRORS.includes(quoteError.code ?? "")
      ? "Change the amount"
      : !shownQuote
        ? "Finding a price…"
        : !refund.trim()
          ? "Add your refund address"
          : !destination.trim()
            ? "Add your destination address"
            : "Review swap";

  const startSwap = useCallback(async () => {
    if (!quote || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setCreateError("");
    let tried = quote.id;
    try {
      // A quote about to lapse would come back as an error. Refresh it instead, and let
      // the user see the new number only if they have to confirm again.
      const fresh =
        quote.expiresAt - Date.now() > 5_000 && !usedQuotesRef.current.has(quote.id)
          ? quote
          : await swapApi.quote({ from: quote.from, to: quote.to, amount: quote.amountIn, slippageBps: slippageBps ?? undefined, boost });
      if (fresh !== quote && (BigInt(fresh.minOut) < BigInt(quote.minOut) || BigInt(fresh.estimatedOut) < BigInt(quote.estimatedOut))) {
        // What they confirmed is no longer on offer. They get to see the new numbers first.
        setQuote(fresh);
        setCreateError("The price moved. Check the new amounts and confirm again.");
        return;
      }
      tried = fresh.id;
      const swap = await swapApi.create({ quoteId: fresh.id, destinationAddress: destination.trim(), refundAddress: refund.trim() });
      const entry = { id: swap.id, from: swap.from, to: swap.to, amountIn: swap.amountIn, createdAt: swap.createdAt };
      rememberSwap(entry);
      setRecent(readRecentSwaps());
      setSwapId(swap.id);
      setReviewOpen(false);
      const url = new URL(window.location.href);
      url.searchParams.set("swap", swap.id);
      window.history.replaceState(window.history.state, "", url);
    } catch (error) {
      if (error instanceof SwapApiError && ["deposit_unavailable", "quote_not_found", "quote_expired", "not_found"].includes(error.code)) usedQuotesRef.current.add(tried);
      setCreateError(error instanceof Error ? error.message : "Could not create this swap. No funds have moved.");
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }, [quote, destination, refund, slippageBps, boost]);

  // Once a request is on its way, a corrected address could not reach it. So the dialog stays.
  const closeReview = () => {
    if (!creatingRef.current) setReviewOpen(false);
  };

  const leaveSwap = () => {
    setSwapId(null);
    setAmount("");
    setQuote(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("swap");
    window.history.replaceState(window.history.state, "", url);
    setRecent(readRecentSwaps());
  };

  const openSwap = (id: string) => {
    setSwapId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("swap", id);
    window.history.replaceState(window.history.state, "", url);
  };

  if (swapId) {
    return <SwapProgress id={swapId} active={active} onStartAnother={leaveSwap} />;
  }

  const walletAddress = wallet.publicKey?.toBase58();
  // Whole-route figure from the quote: on a multi-leg route it is more than the Chainflip setting alone.
  const shownSlippageBps = shownQuote?.slippageBps ?? slippageBps;
  const slippageLabel = `${slippageBps === null ? "Auto" : "Max"}${shownSlippageBps === null ? "" : ` ${+(shownSlippageBps / 100).toFixed(2)}%`}`;

  return (
    <section className="xswap" aria-labelledby="xswap-title">
      <div className="xswap-grid">
        <div className="xswap-card">
          <div className="xswap-card-heading">
            <h2 id="xswap-title">Swap</h2>
            {routeUsesChainflip(from, to) && (
              <a className="xswap-powered" href="https://chainflip.io" target="_blank" rel="noopener noreferrer">
                Powered by <b>Chainflip</b>
                <Icon name="external" />
              </a>
            )}
          </div>

          {assetsError && (
            <div className="notice error-notice" role="alert">
              <Icon name="info" />
              <p>{assetsError}</p>
            </div>
          )}

          <fieldset disabled={assets.length === 0}>
            <div className="xswap-field">
              <label htmlFor="xswap-amount">Deposit</label>
              <div className="xswap-field-main">
                <input
                  id="xswap-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  maxLength={40}
                  value={amount}
                  aria-invalid={Boolean(quoteError)}
                  onChange={(event) => setAmount(event.target.value)}
                />
                <small>{formatUsd(shownQuote?.usdIn) ?? " "}</small>
              </div>
              <button type="button" className="xswap-asset-button" aria-label={`Deposit asset: ${fromAsset ? `${fromAsset.symbol} on ${fromAsset.chainName}` : from}`} onClick={() => setPicking("deposit")}>
                {fromAsset && <AssetIcon symbol={fromAsset.symbol} chain={fromAsset.chain} />}
                <span>
                  <strong>{fromAsset?.symbol ?? from.split(".")[0]}</strong>
                  <small>on {fromAsset?.chainName ?? from.split(".")[1]}</small>
                </span>
                <Icon name="chevron" />
              </button>
            </div>

            <div className="xswap-reverse-row">
              <button type="button" className="swap-reverse" aria-label="Swap deposit and receive assets" onClick={reverse}>
                <Icon name="arrow" />
              </button>
            </div>

            <div className="xswap-field">
              <span className="xswap-field-label">Receive</span>
              <div className="xswap-field-main">
                <output className={shownQuote ? "" : "is-empty"} aria-live="polite" aria-label="Estimated amount received" title={outText}>
                  {outText}
                </output>
                <small>{formatUsd(shownQuote?.usdOut) ?? " "}</small>
              </div>
              <button type="button" className="xswap-asset-button" aria-label={`Receive asset: ${toAsset ? `${toAsset.symbol} on ${toAsset.chainName}` : to}`} onClick={() => setPicking("receive")}>
                {toAsset && <AssetIcon symbol={toAsset.symbol} chain={toAsset.chain} />}
                <span>
                  <strong>{toAsset?.symbol ?? to.split(".")[0]}</strong>
                  <small>on {toAsset?.chainName ?? to.split(".")[1]}</small>
                </span>
                <Icon name="chevron" />
              </button>
            </div>

            {amountInvalid && fromAsset && (
              <p className="field-error xswap-quote-error" role="alert">
                Use digits and a dot, with up to {fromAsset.decimals} decimal places.
              </p>
            )}
            {quoteError && (
              <p className="field-error xswap-quote-error" role="alert">
                {quoteError.message}
                {quoteError.minAmount && fromAsset && (
                  <button type="button" className="xswap-inline-button" onClick={() => setAmount(unitsToInput(quoteError.minAmount!, fromAsset.decimals))}>
                    Use minimum
                  </button>
                )}
              </p>
            )}

            <div className="xswap-addresses">
              <AddressField
                id="xswap-refund"
                label="Refund address"
                help={`Your funds come back here as ${fromAsset?.symbol ?? "your deposit"} if the swap cannot finish${routeUsesChainflip(from, to) ? ", including a failed AML check" : ""}.`}
                chain={fromAsset?.chain}
                chainName={fromAsset?.chainName}
                value={refund}
                state={refundCheck}
                disabled={assets.length === 0}
                onChange={setRefund}
                onScan={fromIsXmr ? () => setScanning("refund") : undefined}
                onUseWallet={fromAsset?.chain === "Solana" && walletAddress ? () => setRefund(walletAddress) : undefined}
              />
              <AddressField
                id="xswap-destination"
                label="Destination address"
                help={`Where your ${toAsset?.symbol ?? "swapped funds"} on ${toAsset?.chainName ?? "the other chain"} will arrive.`}
                chain={toAsset?.chain}
                chainName={toAsset?.chainName}
                value={destination}
                state={destinationCheck}
                disabled={assets.length === 0}
                onChange={setDestination}
                onScan={toIsXmr ? () => setScanning("destination") : undefined}
                onUseWallet={toAsset?.chain === "Solana" && walletAddress ? () => setDestination(walletAddress) : undefined}
              />
            </div>
          </fieldset>

          <button type="button" className="primary-button xswap-action" disabled={!canReview} onClick={() => setReviewOpen(true)}>
            {actionLabel}
            {canReview && <Icon name="arrow" />}
          </button>
          <p className="xswap-aml">
            <Icon name="shield" />
            <span>{refundNotice(from, to)}</span>
          </p>
        </div>

        <RoutePanel
          quote={shownQuote}
          loading={quoteLoading}
          secondsLeft={secondsLeft}
          fromAsset={fromAsset}
          toAsset={toAsset}
          assets={assets}
          reserves={reserves}
          slippageLabel={slippageLabel}
          boost={boost}
          onToggleBoost={() => setBoost((value) => !value)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </div>

      {recent.length > 0 && (
        <div className="xswap-recent">
          <span className="field-label">Your recent swaps</span>
          <ul>
            {recent.map((entry) => {
              const a = assets.find((asset) => asset.id === entry.from);
              const b = assets.find((asset) => asset.id === entry.to);
              return (
                <li key={entry.id}>
                  <button type="button" onClick={() => openSwap(entry.id)}>
                    {a ? `${formatUnits(entry.amountIn, a.decimals)} ${a.symbol}` : entry.from} → {b?.symbol ?? entry.to}
                    <small>{new Date(entry.createdAt).toLocaleString()}</small>
                    <Icon name="chevron" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {picking && (
        <AssetPicker
          title={picking === "deposit" ? "Deposit" : "Receive"}
          assets={assets}
          selected={picking === "deposit" ? from : to}
          side={picking}
          onSelect={(id) => selectAsset(picking, id)}
          onClose={() => setPicking(null)}
        />
      )}

      {settingsOpen && (
        <BridgeDialog labelledBy="xswap-settings-title" onClose={() => setSettingsOpen(false)}>
          <div className="swap-token-heading">
            <h2 id="xswap-settings-title">Price protection</h2>
            <button type="button" aria-label="Close price protection" onClick={() => setSettingsOpen(false)}>
              ×
            </button>
          </div>
          <p className="muted small">
            How far below the estimate your swap may fill. If it cannot, your funds are refunded rather than swapped at a worse price. Auto uses Chainflip&apos;s
            recommendation for this pair and size.
          </p>
          <div className="xswap-slippage" role="group" aria-label="Price protection">
            <button type="button" aria-pressed={slippageBps === null} className={slippageBps === null ? "selected" : ""} onClick={() => setSlippageBps(null)}>
              Auto
            </button>
            {SLIPPAGE_CHOICES.map((choice) => (
              <button key={choice} type="button" aria-pressed={slippageBps === choice} className={slippageBps === choice ? "selected" : ""} onClick={() => setSlippageBps(choice)}>
                {choice / 100}%
              </button>
            ))}
          </div>
          <button type="button" className="primary-button" onClick={() => setSettingsOpen(false)}>
            Done
          </button>
        </BridgeDialog>
      )}

      {reviewOpen && shownQuote && fromAsset && toAsset && (
        <BridgeDialog labelledBy="xswap-review-title" onClose={closeReview}>
          <div className="card-heading">
            <h2 id="xswap-review-title">Review swap</h2>
            <button className="icon-button" disabled={creating} onClick={closeReview} aria-label="Close swap review">
              <Icon name="close" />
            </button>
          </div>
          <dl className="review-amounts">
            <div>
              <dt>You send</dt>
              <dd>
                {formatUnits(shownQuote.amountIn, fromAsset.decimals, fromAsset.decimals)} {fromAsset.symbol} on {fromAsset.chainName}
              </dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>{formatDuration(shownQuote.etaSeconds)}</dd>
            </div>
            <div>
              <dt>Or a refund, if below</dt>
              <dd>
                {formatUnits(shownQuote.minOut, toAsset.decimals)} {toAsset.symbol}
              </dd>
            </div>
            <div>
              <dt>You receive about</dt>
              <dd>
                {formatUnits(shownQuote.estimatedOut, toAsset.decimals)} {toAsset.symbol} on {toAsset.chainName}
              </dd>
            </div>
          </dl>
          <p className="field-label">Refund to</p>
          <p className="review-destination" title={refund.trim()}>
            {refund.trim()}
          </p>
          <p className="field-label">Send to</p>
          <p className="review-destination" title={destination.trim()}>
            {destination.trim()}
          </p>
          {shownQuote.reserve && <ReserveNotice reserves={reserves} quote={shownQuote} />}
          <p className="xswap-aml">
            <Icon name="shield" />
            <span>{refundNotice(from, to)} Addresses cannot be changed after this.</span>
          </p>
          {createError && (
            <p className="field-error" role="alert">
              {createError}
            </p>
          )}
          <button type="button" className="primary-button" disabled={creating} onClick={() => void startSwap()}>
            {creating ? "Opening your deposit address…" : "Get deposit address"}
            {!creating && <Icon name="arrow" />}
          </button>
        </BridgeDialog>
      )}

      {scanning && (
        <MoneroQrScanner
          addressOnly
          onScan={({ address }) => {
            if (scanning === "refund") setRefund(address);
            else setDestination(address);
            setScanning(null);
          }}
          onClose={() => setScanning(null)}
        />
      )}
    </section>
  );
}

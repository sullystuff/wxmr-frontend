"use client";

import { compactXmr } from "../ReserveOverview";
import { Icon } from "../BridgeIcons";
import {
  XMR_ASSET_ID,
  formatDuration,
  formatUnits,
  type SwapAsset,
  type SwapQuote,
  type SwapReserves,
} from "@/lib/swap-api";

const PROVIDER_NAMES: Record<string, string> = {
  chainflip: "Chainflip",
  jupiter: "Jupiter",
  bridge: "wXMR bridge",
  monero: "Monero",
  solana: "Solana",
};

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function blocksToTime(count: number, blockSeconds: number): string {
  return formatDuration(count * blockSeconds);
}

/**
 * The promise a user is really buying when swapping out of Monero. Every number here is
 * from the backend's live reserves and its bridge settings, so it cannot drift from what happens.
 */
export function ReserveNotice({ reserves, quote }: { reserves: SwapReserves | null; quote: SwapQuote | null }) {
  const decision = quote?.reserve;
  if (!reserves && !decision) return null;
  const available = compactXmr(decision?.available ?? reserves?.availableForSwaps ?? "0");
  const fast = decision?.fastConfirmations ?? reserves?.fastPathConfirmations ?? 1;
  const slow = decision?.slowConfirmations ?? reserves?.slowPathConfirmations ?? 20;
  const unlock = reserves?.walletUnlockConfirmations ?? 10;
  const bridge = slow - unlock;
  const blockSeconds = reserves?.moneroBlockSeconds ?? 120;
  const limit = BigInt(decision?.fastPathMax ?? reserves?.fastPathMax ?? "0");
  const limitText = `${formatUnits(limit.toString(), 12)} XMR`;
  // Before an amount is entered, larger swaps can be either figure.
  const creditCap = BigInt(reserves?.bridgeFastCreditMax ?? "0");
  const overCap = reserves?.slowPathConfirmationsOverCap ?? slow;
  const limitBelowReserves = limit > BigInt(0) && limit < BigInt(decision?.available ?? reserves?.availableForSwaps ?? "0");
  // The limit only explains the wait when the reserves could otherwise have covered this swap.
  const heldBackByLimit = decision !== undefined && decision.overFastPathMax && BigInt(decision.required) <= BigInt(decision.available);
  const explanation = (
    <>
      Your XMR first has to move through the bridge: {plural(unlock, "confirmation")} before Monero lets it be spent, then{" "}
      {plural(bridge, "more confirmation").replace("more confirmations", "more")} for the bridge to credit it.
    </>
  );

  const reservesLink = reserves?.solanaAddress ? (
    <a href={`https://solscan.io/account/${reserves.solanaAddress}`} target="_blank" rel="noopener noreferrer">
      {available} XMR on Solana
      <Icon name="external" />
    </a>
  ) : (
    <>{available} XMR on Solana</>
  );

  return (
    <section className={`xswap-reserve ${decision ? `is-${decision.path}` : ""}`} aria-label="Swap reserves">
      <div className="xswap-reserve-figure">
        <span className="field-label">Ready to swap now</span>
        <strong>{reservesLink}</strong>
      </div>
      {!decision ? (
        <p>
          Swaps up to {limitBelowReserves ? limitText : "this size"} start after <b>{plural(fast, "Monero confirmation")}</b>, {blocksToTime(fast, blockSeconds)}. Larger swaps take{" "}
          <b>{plural(slow, "confirmation")}</b>, {blocksToTime(slow, blockSeconds)}
          {creditCap > BigInt(0) && overCap !== slow && (
            <>
              , or <b>{plural(overCap, "confirmation")}</b> over {formatUnits(creditCap.toString(), 12)} XMR
            </>
          )}
          . {explanation}
        </p>
      ) : decision.path === "fast" ? (
        <p>
          <Icon name="check" />
          <span>
            <b>Your swap starts after {plural(decision.confirmations, "Monero confirmation")}</b>, {formatDuration(decision.etaSeconds)}. We hold enough wXMR to
            cover it right now, and hold it for you once your deposit is seen on the network, unless an older swap reaches its turn first.
          </span>
        </p>
      ) : (
        <p>
          <Icon name="clock" />
          <span>
            <b>Your swap starts after {plural(decision.confirmations, "Monero confirmation")}</b>, {formatDuration(decision.etaSeconds)}. {heldBackByLimit
              ? `Swaps over ${limitText} wait longer even when we hold enough, because a Monero reorg could undo a large deposit after it has been paid out.`
              : "It is larger than what we hold on Solana."}{" "}
            {explanation}
          </span>
        </p>
      )}
      {reserves?.stale && <p className="xswap-stale">These figures are out of date, so the start time may differ. We will show the real path once your deposit arrives.</p>}
      {reserves && (
        <details className="xswap-fees">
          <summary>
            Reserve details
            <Icon name="chevron" />
          </summary>
          <dl>
            <div>
              <dt>wXMR on Solana</dt>
              <dd>{compactXmr(reserves.wxmrOnSolana)}</dd>
            </div>
            <div>
              <dt>Claimed by open swaps</dt>
              <dd>{compactXmr(reserves.claimedByOpenSwaps)}</dd>
            </div>
            <div>
              <dt>Moving through the bridge</dt>
              <dd>{compactXmr(reserves.incomingFromTopups)}</dd>
            </div>
            <div>
              <dt>XMR in our Monero wallet</dt>
              <dd>{compactXmr(reserves.xmrWallet.balance)}</dd>
            </div>
          </dl>
          <p className="muted small">Our wallet sends XMR to the bridge whenever {compactXmr(reserves.minTopup, 1)} XMR or more is spendable, which refills the reserves.</p>
        </details>
      )}
    </section>
  );
}

export function RoutePanel({
  quote,
  loading,
  secondsLeft,
  fromAsset,
  toAsset,
  assets,
  reserves,
  slippageLabel,
  boost,
  onToggleBoost,
  onOpenSettings,
}: {
  quote: SwapQuote | null;
  loading: boolean;
  secondsLeft: number | null;
  fromAsset: SwapAsset | undefined;
  toAsset: SwapAsset | undefined;
  assets: SwapAsset[];
  reserves: SwapReserves | null;
  slippageLabel: string;
  boost: boolean;
  onToggleBoost: () => void;
  onOpenSettings: () => void;
}) {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const show = (assetId: string, amount: string) => {
    const asset = byId.get(assetId);
    if (assetId === "wXMR.Solana") return `${formatUnits(amount, 12)} wXMR`;
    return asset ? `${formatUnits(amount, asset.decimals)} ${asset.symbol}` : amount;
  };
  const showBoost = quote?.boostAvailable;

  return (
    <aside className="xswap-route" aria-label="Swap route">
      <div className="xswap-route-heading">
        <h3>
          Route
          {quote && secondsLeft !== null && <small>{secondsLeft}s</small>}
          {loading && <span className="swap-loading-dot" />}
        </h3>
        <div>
          {showBoost && (
            <button
              type="button"
              className={`xswap-chip ${boost ? "is-on" : ""}`}
              aria-pressed={boost}
              title="Chainflip's boost credits your deposit early for a small fee"
              onClick={onToggleBoost}
            >
              Boost
            </button>
          )}
          <button type="button" className="xswap-chip" onClick={onOpenSettings}>
            {slippageLabel}
          </button>
        </div>
      </div>

      {!quote ? (
        <div className="xswap-route-idle">
          <p>
            Native coins on every chain Chainflip supports, plus native Monero. No wallet to connect: you send from wherever your funds are.
          </p>
          <ul>
            <li>
              <Icon name="check" /> Assets on their own chains
            </li>
            <li>
              <Icon name="check" /> A refund address on every swap
            </li>
            <li>
              <Icon name="check" /> No account
            </li>
          </ul>
        </div>
      ) : (
        <>
          <div className="xswap-route-total">
            <strong>{show(quote.to, quote.estimatedOut)}</strong>
            <span>
              At least {show(quote.to, quote.minOut)} or a refund · {formatDuration(quote.etaSeconds)}
            </span>
          </div>
          <ol className="xswap-steps">
            {quote.steps.map((step, index) => (
              <li key={`${step.provider}-${index}`}>
                <span className={`xswap-step-tag tag-${step.provider}`}>{PROVIDER_NAMES[step.provider]}</span>
                <span className="xswap-step-label">{step.label}</span>
                {step.amountOut && <span className="xswap-step-amount">{show(step.toAsset, step.amountOut)}</span>}
              </li>
            ))}
          </ol>
          {quote.fees.length > 0 && (
            <details className="xswap-fees">
              <summary>
                Fees included in this price
                <Icon name="chevron" />
              </summary>
              <dl>
                {quote.fees.map((fee, index) => (
                  <div key={`${fee.label}-${index}`}>
                    <dt>{fee.label}</dt>
                    <dd>{show(fee.asset, fee.amount)}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
          {quote.warnings.map((warning) => (
            <p className="xswap-warning" key={warning}>
              {warning}
            </p>
          ))}
        </>
      )}

      {reserves?.bridgeOnline === false && (fromAsset?.id === XMR_ASSET_ID || toAsset?.id === XMR_ASSET_ID) && (
        <p className="xswap-warning" role="status">
          The wXMR bridge is offline right now, so a swap that has to go through it will take longer than shown here. Funds stay safe and it resumes when the bridge is back.
        </p>
      )}
      {fromAsset?.id === XMR_ASSET_ID && <ReserveNotice reserves={reserves} quote={quote} />}
      {toAsset?.id === XMR_ASSET_ID && quote && (
        <p className="xswap-route-note muted small">
          The bridge pays XMR to your address. You get its transaction key, so you can prove the payment.
        </p>
      )}
    </aside>
  );
}

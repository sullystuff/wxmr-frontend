"use client";

import { useEffect, useState } from "react";
import { BridgeDialog } from "./BridgeDialog";
import { TokenIcon } from "./BridgeIcons";
import { jupiterSwapClient } from "@/lib/jupiter-swap-client";
import { SWAP_TOKENS, type SwapToken } from "@/lib/jupiter-swap";

export function SwapTokenIcon({ token }: { token: SwapToken }) {
  if (token.mint === SWAP_TOKENS.wXMR.mint) return <TokenIcon token="wxmr" />;
  if (token.mint === SWAP_TOKENS.SOL.mint) return <span className="swap-coin swap-coin-sol" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 5 14 0-3 3H3zm-3 6h14l3 3H6zm3 6h14l-3 3H3z" fill="currentColor" /></svg></span>;
  if (token.mint === SWAP_TOKENS.USDC.mint) return <span className="swap-coin swap-coin-usdc" aria-hidden="true">$</span>;
  // Token metadata supplies arbitrary icon URLs; avoid forwarding page referrers.
  // eslint-disable-next-line @next/next/no-img-element
  if (token.icon) return <img className="swap-coin" src={token.icon} alt="" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.visibility = "hidden"; }} />;
  return <span className="swap-coin swap-coin-other" aria-hidden="true">{token.symbol.slice(0, 1)}</span>;
}

export function SwapTokenSelector({ selected, onSelect, onClose }: { selected: SwapToken; onSelect: (token: SwapToken) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SwapToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); setError(""); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const tokens = await jupiterSwapClient.search(query, controller.signal);
        if (!controller.signal.aborted) { setResults(tokens); setError(""); }
      } catch { if (!controller.signal.aborted) setError("Token search is unavailable. Try again shortly."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  const popular = [selected, SWAP_TOKENS.SOL, SWAP_TOKENS.USDC].filter((token, index, tokens) => tokens.findIndex(other => other.mint === token.mint) === index);
  const tokens = query.trim().length >= 2 ? results : popular;
  return <BridgeDialog labelledBy="swap-token-title" onClose={onClose}>
    <div className="swap-token-heading"><h2 id="swap-token-title">Select a token</h2><button type="button" aria-label="Close token selector" onClick={onClose}>×</button></div>
    <input className="swap-token-search" aria-label="Search tokens" placeholder="Search name or paste mint address" autoFocus value={query} maxLength={100} onChange={event => setQuery(event.target.value)} />
    <div className="swap-token-results" aria-busy={loading}>
      {loading ? <p role="status">Searching…</p> : error ? <p role="alert">{error}</p> : !tokens.length ? <p role="status">No matching tokens.</p> : tokens.map(token =>
        <button type="button" className="swap-token-result" key={token.mint} onClick={() => { onSelect(token); onClose(); }}>
          <SwapTokenIcon token={token} /><span><strong>{token.symbol}</strong><small>{token.name}</small></span>
          <code>{token.mint.slice(0, 4)}…{token.mint.slice(-4)}</code>
        </button>)}
    </div>
  </BridgeDialog>;
}

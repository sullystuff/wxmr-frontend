"use client";

import { useMemo, useState } from "react";
import { BridgeDialog } from "../BridgeDialog";
import { Icon } from "../BridgeIcons";
import { AssetIcon, ChainGlyph } from "./AssetIcon";
import type { SwapAsset } from "@/lib/swap-api";

const CHAIN_ORDER = ["Monero", "Bitcoin", "Ethereum", "Solana", "Tron", "Arbitrum", "Assethub", "Bsc"];

/** Chains on the left, their assets on the right, as on swap.chainflip.io. */
export function AssetPicker({
  title,
  assets,
  selected,
  side,
  onSelect,
  onClose,
}: {
  title: string;
  assets: SwapAsset[];
  selected: string;
  side: "deposit" | "receive";
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const usable = useMemo(() => assets.filter((asset) => (side === "deposit" ? asset.depositEnabled : asset.receiveEnabled)), [assets, side]);
  const chains = useMemo(() => {
    const seen = new Map<string, string>();
    for (const asset of usable) if (!seen.has(asset.chain)) seen.set(asset.chain, asset.chainName);
    const rank = (chain: string) => {
      const index = CHAIN_ORDER.indexOf(chain);
      return index < 0 ? CHAIN_ORDER.length : index;
    };
    return [...seen.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
  }, [usable]);
  const selectedChain = assets.find((asset) => asset.id === selected)?.chain;
  const [chain, setChain] = useState(selectedChain ?? chains[0]?.[0] ?? "");
  const [query, setQuery] = useState("");

  const needle = query.trim().toLowerCase();
  const shown = usable.filter((asset) =>
    needle ? `${asset.symbol} ${asset.name} ${asset.chainName}`.toLowerCase().includes(needle) : asset.chain === chain,
  );

  return (
    <BridgeDialog labelledBy="xswap-picker-title" onClose={onClose}>
      <div className="swap-token-heading">
        <h2 id="xswap-picker-title">{title}</h2>
        <button type="button" aria-label="Close asset list" onClick={onClose}>
          ×
        </button>
      </div>
      <input
        className="swap-token-search"
        aria-label="Search assets"
        placeholder="Search by symbol or name"
        value={query}
        maxLength={40}
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="xswap-picker">
        <div className="xswap-picker-chains" role="tablist" aria-label="Chains" aria-orientation="vertical">
          {chains.map(([id, name]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={!needle && chain === id}
              className={!needle && chain === id ? "selected" : ""}
              onClick={() => {
                setChain(id);
                setQuery("");
              }}
            >
              <ChainGlyph chain={id} />
              <span>{name}</span>
            </button>
          ))}
        </div>
        <div className="xswap-picker-assets">
          {shown.length === 0 && <p className="muted small">Nothing matches that search.</p>}
          {shown.map((asset) => (
            <button
              key={asset.id}
              type="button"
              className={asset.id === selected ? "selected" : ""}
              onClick={() => {
                onSelect(asset.id);
                onClose();
              }}
            >
              <AssetIcon symbol={asset.symbol} chain={asset.chain} />
              <span>
                <strong>{asset.symbol}</strong>
                <small>
                  {asset.name}
                  {needle ? ` on ${asset.chainName}` : ""}
                </small>
              </span>
              {asset.id === selected && <Icon name="check" />}
            </button>
          ))}
        </div>
      </div>
    </BridgeDialog>
  );
}

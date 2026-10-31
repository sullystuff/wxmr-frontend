"use client";

import { useState } from "react";
import { CrossChainSwap } from "./xswap/CrossChainSwap";
import { JupiterSwap } from "./JupiterSwap";

type Mode = "chains" | "solana";

/** The Swap tab: cross-chain through Chainflip, or wXMR against Solana tokens through Jupiter. */
export function SwapPanel({ active, onSwapConfirmed }: { active: boolean; onSwapConfirmed?: () => void }) {
  const [mode, setMode] = useState<Mode>("chains");
  return (
    <>
      <div className="xswap-mode" role="radiogroup" aria-label="Swap type">
        <button type="button" role="radio" aria-checked={mode === "chains"} className={mode === "chains" ? "selected" : ""} onClick={() => setMode("chains")}>
          Any chain
        </button>
        <button type="button" role="radio" aria-checked={mode === "solana"} className={mode === "solana" ? "selected" : ""} onClick={() => setMode("solana")}>
          wXMR on Solana
        </button>
      </div>
      <div hidden={mode !== "chains"}>
        <CrossChainSwap active={active && mode === "chains"} />
      </div>
      <div hidden={mode !== "solana"}>
        <JupiterSwap active={active && mode === "solana"} onSwapConfirmed={onSwapConfirmed} />
      </div>
    </>
  );
}

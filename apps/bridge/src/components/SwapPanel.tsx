"use client";

import { useState, useSyncExternalStore } from "react";
import { CrossChainSwap } from "./xswap/CrossChainSwap";
import { JupiterSwap } from "./JupiterSwap";

type Mode = "chains" | "solana";

const noSubscription = () => () => undefined;

/** A signed Jupiter swap waiting on confirmation must not hide behind the other mode. */
function readJupiterPending(): boolean {
  try {
    return Boolean(localStorage.getItem("wxmr:jupiter-pending:v1"));
  } catch {
    return false;
  }
}

/** The Swap tab: cross-chain through Chainflip, or wXMR against Solana tokens through Jupiter. */
export function SwapPanel({ active, onSwapConfirmed }: { active: boolean; onSwapConfirmed?: () => void }) {
  const [chosen, setChosen] = useState<Mode | null>(null);
  const jupiterPending = useSyncExternalStore(noSubscription, readJupiterPending, () => false);
  const mode: Mode = chosen ?? (jupiterPending ? "solana" : "chains");
  return (
    <>
      <div className="xswap-mode" role="group" aria-label="Swap type">
        <button type="button" aria-pressed={mode === "chains"} className={mode === "chains" ? "selected" : ""} onClick={() => setChosen("chains")}>
          Any chain
        </button>
        <button type="button" aria-pressed={mode === "solana"} className={mode === "solana" ? "selected" : ""} onClick={() => setChosen("solana")}>
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

import { TokenIcon } from "../BridgeIcons";

/**
 * Drawn here rather than fetched: the site loads no third-party images, and swap pages
 * should not tell anyone what a visitor is looking at.
 */
function Coin({ background, color = "#fff", children }: { background: string; color?: string; children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="xswap-coin">
      <circle cx="16" cy="16" r="16" fill={background} />
      <g fill={color}>{children}</g>
    </svg>
  );
}

function Letter({ children, size = 18 }: { children: string; size?: number }) {
  return (
    <text x="16" y="16" textAnchor="middle" dominantBaseline="central" fontSize={size} fontWeight="700" fontFamily="Inter, Arial, sans-serif">
      {children}
    </text>
  );
}

const ETH_PATH = "M16 5l-6.5 11L16 20l6.5-4L16 5zm-6.5 12.5L16 27l6.5-9.5L16 21.5l-6.5-4z";
const SOL_PATH = "M10.5 9.5h13l-3 3h-13zM7.5 14.5h13l3 3h-13zM10.5 19.5h13l-3 3h-13z";

export function ChainGlyph({ chain }: { chain: string }) {
  switch (chain) {
    case "Monero":
      return <TokenIcon token="xmr" className="xswap-coin" />;
    case "Bitcoin":
      return <Coin background="#f7931a"><Letter>₿</Letter></Coin>;
    case "Ethereum":
      return <Coin background="#3c3f4a"><path d={ETH_PATH} /></Coin>;
    case "Arbitrum":
      return <Coin background="#213147" color="#9dcced"><path d="M16 6l9 15h-4.4L16 13.2 11.4 21H7z" /></Coin>;
    case "Solana":
      return <Coin background="#13171d" color="#a4e1c2"><path d={SOL_PATH} /></Coin>;
    case "Assethub":
      return (
        <Coin background="#e6007a">
          <circle cx="16" cy="9" r="3" />
          <circle cx="16" cy="23" r="3" />
          <circle cx="9.9" cy="12.5" r="3" />
          <circle cx="22.1" cy="12.5" r="3" />
          <circle cx="9.9" cy="19.5" r="3" />
          <circle cx="22.1" cy="19.5" r="3" />
        </Coin>
      );
    case "Tron":
      return <Coin background="#c8102e"><path d="M7 8l18 3-11 15L7 8zm3 2.8l4.6 11 6-8.2-10.6-2.8z" fillRule="evenodd" /></Coin>;
    case "Bsc":
      return <Coin background="#f3ba2f" color="#1e2026"><path d="M16 6l3.4 3.4-3.4 3.4-3.4-3.4zm-6.6 6.6l3.4 3.4-3.4 3.4L6 16zm13.2 0L26 16l-3.4 3.4-3.4-3.4zM16 19.2l3.4 3.4L16 26l-3.4-3.4z" /></Coin>;
    default:
      return <Coin background="#2d2d2d"><Letter>{chain.slice(0, 1)}</Letter></Coin>;
  }
}

function SymbolGlyph({ symbol, chain }: { symbol: string; chain: string }) {
  switch (symbol) {
    case "XMR":
      return <TokenIcon token="xmr" className="xswap-coin" />;
    case "BTC":
      return <Coin background="#f7931a"><Letter>₿</Letter></Coin>;
    case "ETH":
      return <Coin background="#3c3f4a"><path d={ETH_PATH} /></Coin>;
    case "SOL":
      return <Coin background="#13171d" color="#a4e1c2"><path d={SOL_PATH} /></Coin>;
    case "USDC":
      return <Coin background="#2775ca"><Letter>$</Letter></Coin>;
    case "USDT":
      return <Coin background="#26a17b"><Letter>₮</Letter></Coin>;
    case "WBTC":
      return <Coin background="#5a5564" color="#f7931a"><Letter>₿</Letter></Coin>;
    case "CBBTC":
      return <Coin background="#0052ff"><Letter>₿</Letter></Coin>;
    case "FLIP":
      return <Coin background="#111" color="#46da93"><Letter>F</Letter></Coin>;
    case "DOT":
    case "TRX":
    case "BNB":
      return <ChainGlyph chain={chain} />;
    default:
      return <Coin background="#2d2d2d"><Letter>{symbol.slice(0, 1)}</Letter></Coin>;
  }
}

/** The coin, with its chain as a corner badge whenever the chain is not obvious from the coin. */
export function AssetIcon({ symbol, chain, size = "md" }: { symbol: string; chain: string; size?: "sm" | "md" }) {
  const nativeToItsChain =
    (symbol === "BTC" && chain === "Bitcoin") ||
    (symbol === "ETH" && chain === "Ethereum") ||
    (symbol === "SOL" && chain === "Solana") ||
    (symbol === "XMR" && chain === "Monero") ||
    (symbol === "DOT" && chain === "Assethub") ||
    (symbol === "TRX" && chain === "Tron") ||
    (symbol === "BNB" && chain === "Bsc");
  return (
    <span className={`xswap-asset-icon xswap-asset-icon-${size}`} aria-hidden="true">
      <SymbolGlyph symbol={symbol} chain={chain} />
      {!nativeToItsChain && (
        <span className="xswap-chain-badge">
          <ChainGlyph chain={chain} />
        </span>
      )}
    </span>
  );
}

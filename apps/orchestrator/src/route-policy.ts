import {
  CHAINS,
  WXMR_MINT_ADDRESS,
  type Quote,
  type QuoteRequest,
  type SourceChainId,
} from "@wxmr/core";

export type ReverseOutputRoute = "xmr-to-btc" | "xmr-to-solana" | "xmr-to-mayan";

export type AssetToAssetRoute =
  | "btc-to-asset"
  | "asset-to-btc"
  | "solana-to-solana"
  | "solana-to-mayan"
  | "asset-to-wxmr-solana"
  | "mayan-to-asset";

export function selectReverseOutputRoute(outputChain: SourceChainId): ReverseOutputRoute {
  if (outputChain === "bitcoin") return "xmr-to-btc";
  if (outputChain === "solana") return "xmr-to-solana";
  if (!CHAINS[outputChain].mayanChain) {
    throw new Error("destination chain is not supported by Mayan");
  }
  return "xmr-to-mayan";
}

export function selectAssetToAssetRoute(input: Pick<QuoteRequest, "sourceChain" | "sourceToken" | "destinationChain" | "destinationToken">): AssetToAssetRoute {
  if (!input.destinationChain || !input.destinationToken) {
    throw new Error("destinationChain and destinationToken are required");
  }
  if (input.sourceChain === "bitcoin") return "btc-to-asset";
  if (input.destinationChain === "bitcoin") return "asset-to-btc";
  if (input.sourceChain === "solana") {
    return input.destinationChain === "solana" ? "solana-to-solana" : "solana-to-mayan";
  }
  if (input.destinationChain === "solana" && isWxmrMint(input.destinationToken)) {
    return "asset-to-wxmr-solana";
  }
  if (CHAINS[input.sourceChain].kind !== "evm") {
    throw new Error("this source chain needs a wallet-specific funding path that is not enabled yet");
  }
  if (!CHAINS[input.destinationChain].mayanChain) {
    throw new Error("destination chain is not supported by Mayan");
  }
  return "mayan-to-asset";
}

export function usesThorchainBitcoinDepositAddress(quote: Pick<Quote, "route" | "sourceChain">): boolean {
  return quote.route === "thorchain" && quote.sourceChain === "bitcoin";
}

export function requiresSolanaHotWalletPayout(quote: Quote): boolean {
  if (quote.direction === "asset-to-asset" && quote.route === "thorchain" && quote.destinationChain === "bitcoin") {
    return true;
  }
  if (
    quote.direction !== "asset-to-asset" ||
    quote.sourceChain === "solana" ||
    quote.destinationChain !== "solana"
  ) {
    return false;
  }
  const deliveredToken = quote.mayan?.quote.toToken.contract ?? quote.mayan?.quote.toToken.mint;
  if (!deliveredToken) return isWxmrMint(quote.destinationToken);
  return !sameToken(deliveredToken, quote.destinationToken);
}

function isWxmrMint(value: string | undefined): boolean {
  return Boolean(value && value.toLowerCase() === WXMR_MINT_ADDRESS.toLowerCase());
}

function sameToken(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

import {
  CHAINS,
  MAYAN_SWIFT_EVM_SOURCE_CHAINS,
  MAYAN_SWIFT_SOURCE_CHAINS,
  type SourceChainId,
} from "@wxmr/core";

export const QUOTE_PLACEHOLDER_XMR_ADDRESS = "45ZYpKmPaPmh3bnRP1XpMz8cASJQf1cfUgq32H8trCYA4RodzXhsmt2VYkQX9QQ65CetiGja65tH2JmKC3gEZtZjB7AzMpd";
export const QUOTE_PLACEHOLDER_SOLANA_ADDRESS = "9wtvVxue6wfwVf27cG11tyfQXyHZnyz5gHR5okWh26sX";
export const QUOTE_PLACEHOLDER_EVM_ADDRESS = "0x000000000000000000000000000000000000dEaD";
export const QUOTE_PLACEHOLDER_SUI_ADDRESS = `0x${"1".repeat(64)}`;
export const QUOTE_PLACEHOLDER_BTC_ADDRESS = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";

const CHAIN_DISPLAY_PRIORITY: readonly SourceChainId[] = [
  "monero",
  "ethereum",
  "solana",
  "bitcoin",
  "base",
  "arbitrum",
  "optimism",
  "polygon",
  "bsc",
  "avalanche",
  "sui",
  "linea",
  "hyperevm",
  "hyperliquid",
  "monad",
];

export function sortChainsForDisplay(chains: readonly SourceChainId[]): readonly SourceChainId[] {
  const rank = (chain: SourceChainId) => {
    const index = CHAIN_DISPLAY_PRIORITY.indexOf(chain);
    return index === -1 ? CHAIN_DISPLAY_PRIORITY.length : index;
  };
  return [...chains].sort((a, b) => rank(a) - rank(b));
}

export function selectableSourceChains(): readonly SourceChainId[] {
  return sortChainsForDisplay(["monero", "bitcoin", ...MAYAN_SWIFT_EVM_SOURCE_CHAINS, "solana"]);
}

export function selectableDestinationChains(): readonly SourceChainId[] {
  return sortChainsForDisplay(["monero", "bitcoin", ...MAYAN_SWIFT_SOURCE_CHAINS, "solana"]);
}

export function placeholderAddressForChain(chainId: SourceChainId): string {
  const chain = CHAINS[chainId];
  if (chainId === "solana") return QUOTE_PLACEHOLDER_SOLANA_ADDRESS;
  if (chainId === "bitcoin") return QUOTE_PLACEHOLDER_BTC_ADDRESS;
  if (chainId === "sui") return QUOTE_PLACEHOLDER_SUI_ADDRESS;
  if (chainId === "monero") return QUOTE_PLACEHOLDER_XMR_ADDRESS;
  if (chain.kind === "evm" || chain.kind === "hypercore") return QUOTE_PLACEHOLDER_EVM_ADDRESS;
  return QUOTE_PLACEHOLDER_SOLANA_ADDRESS;
}

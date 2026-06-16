import type { Address } from "viem";
import type { SourceChainId } from "./orders.js";

export interface ChainConfig {
  id: SourceChainId;
  name: string;
  kind: "evm" | "sui" | "hypercore" | "solana" | "bitcoin";
  chainId?: number;
  mayanChain?: string;
  usdc?: Address | string;
  nativeCurrency?: string;
  explorerTxUrl: string;
  rpcEnv?: string;
}

export const CHAINS: Record<SourceChainId, ChainConfig> = {
  ethereum: {
    id: "ethereum",
    name: "Ethereum",
    kind: "evm",
    chainId: 1,
    mayanChain: "ethereum",
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    nativeCurrency: "ETH",
    explorerTxUrl: "https://etherscan.io/tx/",
    rpcEnv: "ETHEREUM_RPC_URL",
  },
  bsc: {
    id: "bsc",
    name: "BSC",
    kind: "evm",
    chainId: 56,
    mayanChain: "bsc",
    usdc: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
    nativeCurrency: "BNB",
    explorerTxUrl: "https://bscscan.com/tx/",
    rpcEnv: "BSC_RPC_URL",
  },
  base: {
    id: "base",
    name: "Base",
    kind: "evm",
    chainId: 8453,
    mayanChain: "base",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    nativeCurrency: "ETH",
    explorerTxUrl: "https://basescan.org/tx/",
    rpcEnv: "BASE_RPC_URL",
  },
  arbitrum: {
    id: "arbitrum",
    name: "Arbitrum",
    kind: "evm",
    chainId: 42161,
    mayanChain: "arbitrum",
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    nativeCurrency: "ETH",
    explorerTxUrl: "https://arbiscan.io/tx/",
    rpcEnv: "ARBITRUM_RPC_URL",
  },
  optimism: {
    id: "optimism",
    name: "Optimism",
    kind: "evm",
    chainId: 10,
    mayanChain: "optimism",
    usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    nativeCurrency: "ETH",
    explorerTxUrl: "https://optimistic.etherscan.io/tx/",
    rpcEnv: "OPTIMISM_RPC_URL",
  },
  polygon: {
    id: "polygon",
    name: "Polygon",
    kind: "evm",
    chainId: 137,
    mayanChain: "polygon",
    usdc: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
    nativeCurrency: "POL",
    explorerTxUrl: "https://polygonscan.com/tx/",
    rpcEnv: "POLYGON_RPC_URL",
  },
  avalanche: {
    id: "avalanche",
    name: "Avalanche",
    kind: "evm",
    chainId: 43114,
    mayanChain: "avalanche",
    usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    nativeCurrency: "AVAX",
    explorerTxUrl: "https://snowtrace.io/tx/",
    rpcEnv: "AVALANCHE_RPC_URL",
  },
  linea: {
    id: "linea",
    name: "Linea",
    kind: "evm",
    chainId: 59144,
    mayanChain: "linea",
    usdc: "0x176211869cA2b568f2A7D4EE941E073a821EE1ff",
    nativeCurrency: "ETH",
    explorerTxUrl: "https://lineascan.build/tx/",
    rpcEnv: "LINEA_RPC_URL",
  },
  hyperevm: {
    id: "hyperevm",
    name: "HyperEVM",
    kind: "evm",
    chainId: 999,
    mayanChain: "hyperevm",
    usdc: "0xb88339CB7199b77E23DB6E890353E22632Ba630f",
    nativeCurrency: "HYPE",
    explorerTxUrl: "https://hyperevmscan.io/tx/",
    rpcEnv: "HYPEREVM_RPC_URL",
  },
  monad: {
    id: "monad",
    name: "Monad",
    kind: "evm",
    chainId: 143,
    mayanChain: "monad",
    usdc: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
    nativeCurrency: "MON",
    explorerTxUrl: "https://monadscan.com/tx/",
    rpcEnv: "MONAD_RPC_URL",
  },
  sui: {
    id: "sui",
    name: "Sui",
    kind: "sui",
    chainId: 1999,
    mayanChain: "sui",
    usdc: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
    nativeCurrency: "SUI",
    explorerTxUrl: "https://suivision.xyz/txblock/",
    rpcEnv: "SUI_RPC_URL",
  },
  hyperliquid: {
    id: "hyperliquid",
    name: "Hyperliquid",
    kind: "hypercore",
    chainId: 9999,
    mayanChain: "hypercore",
    usdc: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
    nativeCurrency: "USDC",
    explorerTxUrl: "https://hypurrscan.io/tx/",
    rpcEnv: "HYPERLIQUID_RPC_URL",
  },
  solana: {
    id: "solana",
    name: "Solana",
    kind: "solana",
    mayanChain: "solana",
    usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    nativeCurrency: "SOL",
    explorerTxUrl: "https://solscan.io/tx/",
    rpcEnv: "SOLANA_RPC_URL",
  },
  bitcoin: {
    id: "bitcoin",
    name: "Bitcoin",
    kind: "bitcoin",
    nativeCurrency: "BTC",
    explorerTxUrl: "https://mempool.space/tx/",
    rpcEnv: "BITCOIN_RPC_URL",
  },
};

export const MAYAN_SWIFT_SOURCE_CHAINS = [
  "avalanche",
  "sui",
  "linea",
  "hyperevm",
  "ethereum",
  "monad",
  "bsc",
  "base",
  "arbitrum",
  "optimism",
  "polygon",
  "hyperliquid",
] as const satisfies readonly SourceChainId[];

export const MAYAN_SWIFT_EVM_SOURCE_CHAINS = MAYAN_SWIFT_SOURCE_CHAINS.filter(
  (id) => CHAINS[id].kind === "evm",
) as readonly SourceChainId[];

export function getChainConfig(chainId: SourceChainId): ChainConfig {
  return CHAINS[chainId];
}

export function getMayanSwiftSourceChains(): ChainConfig[] {
  return MAYAN_SWIFT_SOURCE_CHAINS.map((id) => CHAINS[id]).filter(
    (chain): chain is ChainConfig & { kind: "evm"; chainId: number; usdc: Address } =>
      chain.kind === "evm" && typeof chain.chainId === "number" && Boolean(chain.usdc),
  );
}

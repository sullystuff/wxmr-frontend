import type { Address } from "viem";
import type { SourceChainId } from "./orders.js";

export interface ChainConfig {
  id: SourceChainId;
  name: string;
  kind: "evm" | "solana" | "bitcoin";
  chainId?: number;
  cctpDomain?: number;
  usdc?: Address | string;
  nativeCurrency?: string;
  explorerTxUrl: string;
  rpcEnv?: string;
}

export const CCTP_DOMAIN = {
  ethereum: 0,
  avalanche: 1,
  optimism: 2,
  arbitrum: 3,
  noble: 4,
  solana: 5,
  base: 6,
  polygon: 7,
} as const;

export const CHAINS: Record<SourceChainId, ChainConfig> = {
  ethereum: {
    id: "ethereum",
    name: "Ethereum",
    kind: "evm",
    chainId: 1,
    cctpDomain: CCTP_DOMAIN.ethereum,
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    nativeCurrency: "ETH",
    explorerTxUrl: "https://etherscan.io/tx/",
    rpcEnv: "ETHEREUM_RPC_URL",
  },
  base: {
    id: "base",
    name: "Base",
    kind: "evm",
    chainId: 8453,
    cctpDomain: CCTP_DOMAIN.base,
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
    cctpDomain: CCTP_DOMAIN.arbitrum,
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
    cctpDomain: CCTP_DOMAIN.optimism,
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
    cctpDomain: CCTP_DOMAIN.polygon,
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
    cctpDomain: CCTP_DOMAIN.avalanche,
    usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    nativeCurrency: "AVAX",
    explorerTxUrl: "https://snowtrace.io/tx/",
    rpcEnv: "AVALANCHE_RPC_URL",
  },
  solana: {
    id: "solana",
    name: "Solana",
    kind: "solana",
    cctpDomain: CCTP_DOMAIN.solana,
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

export const CCTP_SOURCE_CHAINS = [
  "ethereum",
  "base",
  "arbitrum",
  "optimism",
  "polygon",
  "avalanche",
  "solana",
] as const satisfies readonly SourceChainId[];

export function getChainConfig(chainId: SourceChainId): ChainConfig {
  return CHAINS[chainId];
}

export function getEvmCctpChains(): ChainConfig[] {
  return CCTP_SOURCE_CHAINS.map((id) => CHAINS[id]).filter(
    (chain): chain is ChainConfig & { kind: "evm"; chainId: number; cctpDomain: number; usdc: Address } =>
      chain.kind === "evm" && typeof chain.chainId === "number" && typeof chain.cctpDomain === "number",
  );
}

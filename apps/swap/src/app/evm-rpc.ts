import type { SourceChainId } from '@wxmr/core';

export const DEFAULT_EVM_RPC_URL_BY_CHAIN: Partial<Record<SourceChainId, string>> = {
  ethereum: 'https://ethereum-rpc.publicnode.com',
};

export const EVM_RPC_ENV_BY_CHAIN: Partial<Record<SourceChainId, string>> = {
  ethereum: 'NEXT_PUBLIC_ETHEREUM_RPC_URL',
  base: 'NEXT_PUBLIC_BASE_RPC_URL',
  arbitrum: 'NEXT_PUBLIC_ARBITRUM_RPC_URL',
  optimism: 'NEXT_PUBLIC_OPTIMISM_RPC_URL',
  polygon: 'NEXT_PUBLIC_POLYGON_RPC_URL',
  avalanche: 'NEXT_PUBLIC_AVALANCHE_RPC_URL',
};

export const EVM_RPC_URL_BY_CHAIN: Partial<Record<SourceChainId, string | undefined>> = {
  ethereum: process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL || DEFAULT_EVM_RPC_URL_BY_CHAIN.ethereum,
  base: process.env.NEXT_PUBLIC_BASE_RPC_URL,
  arbitrum: process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL,
  optimism: process.env.NEXT_PUBLIC_OPTIMISM_RPC_URL,
  polygon: process.env.NEXT_PUBLIC_POLYGON_RPC_URL,
  avalanche: process.env.NEXT_PUBLIC_AVALANCHE_RPC_URL,
};

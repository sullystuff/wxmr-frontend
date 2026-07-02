import { DEFAULT_EVM_RPC_URL_BY_CHAIN, type SourceChainId } from '@wxmr/core';

export { DEFAULT_EVM_RPC_URL_BY_CHAIN };

export const EVM_RPC_ENV_BY_CHAIN: Partial<Record<SourceChainId, string>> = {
  ethereum: 'NEXT_PUBLIC_ETHEREUM_RPC_URL',
  bsc: 'NEXT_PUBLIC_BSC_RPC_URL',
  base: 'NEXT_PUBLIC_BASE_RPC_URL',
  arbitrum: 'NEXT_PUBLIC_ARBITRUM_RPC_URL',
  optimism: 'NEXT_PUBLIC_OPTIMISM_RPC_URL',
  polygon: 'NEXT_PUBLIC_POLYGON_RPC_URL',
  avalanche: 'NEXT_PUBLIC_AVALANCHE_RPC_URL',
  linea: 'NEXT_PUBLIC_LINEA_RPC_URL',
  hyperevm: 'NEXT_PUBLIC_HYPEREVM_RPC_URL',
  monad: 'NEXT_PUBLIC_MONAD_RPC_URL',
};

export const EVM_RPC_URL_BY_CHAIN: Partial<Record<SourceChainId, string | undefined>> = {
  ethereum: process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL || DEFAULT_EVM_RPC_URL_BY_CHAIN.ethereum,
  bsc: process.env.NEXT_PUBLIC_BSC_RPC_URL || DEFAULT_EVM_RPC_URL_BY_CHAIN.bsc,
  base: process.env.NEXT_PUBLIC_BASE_RPC_URL || DEFAULT_EVM_RPC_URL_BY_CHAIN.base,
  arbitrum: process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL || DEFAULT_EVM_RPC_URL_BY_CHAIN.arbitrum,
  optimism: process.env.NEXT_PUBLIC_OPTIMISM_RPC_URL || DEFAULT_EVM_RPC_URL_BY_CHAIN.optimism,
  polygon: process.env.NEXT_PUBLIC_POLYGON_RPC_URL || DEFAULT_EVM_RPC_URL_BY_CHAIN.polygon,
  avalanche: process.env.NEXT_PUBLIC_AVALANCHE_RPC_URL || DEFAULT_EVM_RPC_URL_BY_CHAIN.avalanche,
  linea: process.env.NEXT_PUBLIC_LINEA_RPC_URL || DEFAULT_EVM_RPC_URL_BY_CHAIN.linea,
  hyperevm: process.env.NEXT_PUBLIC_HYPEREVM_RPC_URL || DEFAULT_EVM_RPC_URL_BY_CHAIN.hyperevm,
  monad: process.env.NEXT_PUBLIC_MONAD_RPC_URL || DEFAULT_EVM_RPC_URL_BY_CHAIN.monad,
};

'use client';

import { useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { arbitrum, avalanche, base, bsc, hyperEvm, linea, mainnet, monad, optimism, polygon } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';
import { EVM_RPC_URL_BY_CHAIN } from './evm-rpc';

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

const config = createConfig({
  chains: [mainnet, bsc, base, arbitrum, optimism, polygon, avalanche, linea, hyperEvm, monad],
  connectors: [
    injected({ shimDisconnect: true }),
    ...(walletConnectProjectId
      ? [walletConnect({ projectId: walletConnectProjectId, showQrModal: true })]
      : []),
  ],
  transports: {
    [mainnet.id]: http(EVM_RPC_URL_BY_CHAIN.ethereum),
    [bsc.id]: http(EVM_RPC_URL_BY_CHAIN.bsc),
    [base.id]: http(EVM_RPC_URL_BY_CHAIN.base),
    [arbitrum.id]: http(EVM_RPC_URL_BY_CHAIN.arbitrum),
    [optimism.id]: http(EVM_RPC_URL_BY_CHAIN.optimism),
    [polygon.id]: http(EVM_RPC_URL_BY_CHAIN.polygon),
    [avalanche.id]: http(EVM_RPC_URL_BY_CHAIN.avalanche),
    [linea.id]: http(EVM_RPC_URL_BY_CHAIN.linea),
    [hyperEvm.id]: http(EVM_RPC_URL_BY_CHAIN.hyperevm),
    [monad.id]: http(EVM_RPC_URL_BY_CHAIN.monad),
  },
  ssr: true,
});

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const wagmiConfig = useMemo(() => config, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

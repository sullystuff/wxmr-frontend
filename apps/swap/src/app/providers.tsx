'use client';

import { useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { arbitrum, avalanche, base, mainnet, optimism, polygon } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';
import { Providers as SolanaProviders } from '@wxmr/shared';
import { EVM_RPC_URL_BY_CHAIN } from './evm-rpc';

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

const config = createConfig({
  chains: [mainnet, base, arbitrum, optimism, polygon, avalanche],
  connectors: [
    injected({ shimDisconnect: true }),
    ...(walletConnectProjectId
      ? [walletConnect({ projectId: walletConnectProjectId, showQrModal: true })]
      : []),
  ],
  transports: {
    [mainnet.id]: http(EVM_RPC_URL_BY_CHAIN.ethereum),
    [base.id]: http(EVM_RPC_URL_BY_CHAIN.base),
    [arbitrum.id]: http(EVM_RPC_URL_BY_CHAIN.arbitrum),
    [optimism.id]: http(EVM_RPC_URL_BY_CHAIN.optimism),
    [polygon.id]: http(EVM_RPC_URL_BY_CHAIN.polygon),
    [avalanche.id]: http(EVM_RPC_URL_BY_CHAIN.avalanche),
  },
  ssr: true,
});

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const wagmiConfig = useMemo(() => config, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <SolanaProviders>{children}</SolanaProviders>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

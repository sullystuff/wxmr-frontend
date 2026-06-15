'use client';

import { useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { arbitrum, avalanche, base, mainnet, optimism, polygon } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';
import { Providers as SolanaProviders } from '@wxmr/shared';

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
    [mainnet.id]: http(process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL),
    [base.id]: http(process.env.NEXT_PUBLIC_BASE_RPC_URL),
    [arbitrum.id]: http(process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL),
    [optimism.id]: http(process.env.NEXT_PUBLIC_OPTIMISM_RPC_URL),
    [polygon.id]: http(process.env.NEXT_PUBLIC_POLYGON_RPC_URL),
    [avalanche.id]: http(process.env.NEXT_PUBLIC_AVALANCHE_RPC_URL),
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

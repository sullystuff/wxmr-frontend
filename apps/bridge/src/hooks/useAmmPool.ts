'use client';

import { useCallback } from 'react';
import type { PublicKey } from '@solana/web3.js';

export interface AmmPoolData {
  authority: PublicKey;
  wxmrMint: PublicKey;
  usdcMint: PublicKey;
  poolWxmr: PublicKey;
  poolUsdc: PublicKey;
  buyPrice: bigint;
  sellPrice: bigint;
  lastPriceUpdate: number;
  enabled: boolean;
  totalWxmrVolume: bigint;
  totalUsdcVolume: bigint;
}

type AmmSimulationResult = {
  success: boolean;
  outputAmount: bigint;
  error?: string;
};

type AmmCalculation = (amount: bigint) => bigint;
type AmmSimulation = (amount: bigint, userPublicKey: PublicKey) => Promise<AmmSimulationResult>;

export function useAmmPool() {
  const calculateOutput = useCallback<AmmCalculation>(() => BigInt(0), []);
  const simulateDisabled = useCallback<AmmSimulation>(async () => ({
    success: false,
    outputAmount: BigInt(0),
    error: 'AMM disabled',
  }), []);
  const refresh = useCallback(async () => {}, []);

  return {
    pool: null as AmmPoolData | null,
    poolPda: null as PublicKey | null,
    loading: false,
    error: 'AMM disabled',
    isPriceStale: false,
    priceAge: 0,
    isAvailable: false,
    calculateBuyOutput: calculateOutput,
    calculateSellOutput: calculateOutput,
    simulateBuy: simulateDisabled,
    simulateSell: simulateDisabled,
    refresh,
  };
}

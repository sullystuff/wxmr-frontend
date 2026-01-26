'use client';

import { useEffect, useState, useCallback } from 'react';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import type { WxmrBridge } from '@/idl/wxmr_bridge';
import IDL from '@/idl/wxmr_bridge.json';

const PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_BRIDGE_PROGRAM_ID || 'EzBkC8P5wxab9kwrtV5hRdynHAfB5w3UPcPXNgMseVA8');
const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const WXMR_MINT = new PublicKey('WXMRyRZhsa19ety5erZhHg4N3xj3EVN92u94422teJp');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

export interface AmmPoolData {
  authority: PublicKey;
  wxmrMint: PublicKey;
  usdcMint: PublicKey;
  poolWxmr: PublicKey;
  poolUsdc: PublicKey;
  buyPrice: bigint;  // USDC atomic units per 1 wXMR (1e12 piconero)
  sellPrice: bigint; // USDC atomic units per 1 wXMR
  lastPriceUpdate: number;
  enabled: boolean;
  totalWxmrVolume: bigint;
  totalUsdcVolume: bigint;
}

export function useAmmPool() {
  const [pool, setPool] = useState<AmmPoolData | null>(null);
  const [poolPda, setPoolPda] = useState<PublicKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPool = useCallback(async () => {
    try {
      const connection = new Connection(SOLANA_RPC);
      
      // Create a read-only provider (no wallet needed for reads)
      const provider = new AnchorProvider(
        connection,
        { 
          publicKey: PublicKey.default, 
          signTransaction: async <T,>(tx: T): Promise<T> => tx, 
          signAllTransactions: async <T,>(txs: T[]): Promise<T[]> => txs 
        } as any,
        { commitment: 'confirmed' }
      );
      
      const program = new Program(IDL as any, provider) as Program<WxmrBridge>;
      
      // Find AMM pool PDA
      const [ammPoolPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('amm_pool')],
        PROGRAM_ID
      );
      setPoolPda(ammPoolPda);

      // Fetch pool account
      const poolAccount = await (program.account as any).ammPool.fetchNullable(ammPoolPda);
      
      if (!poolAccount) {
        setPool(null);
        setError('AMM pool not initialized');
        return;
      }

      setPool({
        authority: poolAccount.authority,
        wxmrMint: poolAccount.wxmrMint,
        usdcMint: poolAccount.usdcMint,
        poolWxmr: poolAccount.poolWxmr,
        poolUsdc: poolAccount.poolUsdc,
        buyPrice: BigInt(poolAccount.buyPrice.toString()),
        sellPrice: BigInt(poolAccount.sellPrice.toString()),
        lastPriceUpdate: poolAccount.lastPriceUpdate.toNumber(),
        enabled: poolAccount.enabled,
        totalWxmrVolume: BigInt(poolAccount.totalWxmrVolume.toString()),
        totalUsdcVolume: BigInt(poolAccount.totalUsdcVolume.toString()),
      });
      setError(null);
    } catch (e) {
      console.error('Error fetching AMM pool:', e);
      setError(e instanceof Error ? e.message : 'Failed to fetch AMM pool');
      setPool(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPool();
    // Refresh every 5 seconds
    const interval = setInterval(fetchPool, 5000);
    return () => clearInterval(interval);
  }, [fetchPool]);

  // Check if price is stale (>20 seconds old)
  // Note: on-chain contract enforces this, but we show a warning
  const isPriceStale = pool ? (Date.now() / 1000 - pool.lastPriceUpdate) > 20 : true;
  const priceAge = pool ? Math.floor(Date.now() / 1000 - pool.lastPriceUpdate) : 0;

  // Calculate wXMR output for given USDC input (buying wXMR)
  const calculateBuyOutput = useCallback((usdcAmount: bigint): bigint => {
    if (!pool || usdcAmount <= BigInt(0)) return BigInt(0);
    // wxmr = (usdc * 1e12) / buy_price
    return (usdcAmount * BigInt('1000000000000')) / pool.buyPrice;
  }, [pool]);

  // Calculate USDC output for given wXMR input (selling wXMR)
  const calculateSellOutput = useCallback((wxmrAmount: bigint): bigint => {
    if (!pool || wxmrAmount <= BigInt(0)) return BigInt(0);
    // usdc = (wxmr * sell_price) / 1e12
    return (wxmrAmount * pool.sellPrice) / BigInt('1000000000000');
  }, [pool]);

  // Simulate a buy transaction
  const simulateBuy = useCallback(async (
    usdcAmount: bigint,
    userPublicKey: PublicKey
  ): Promise<{ success: boolean; outputAmount: bigint; error?: string }> => {
    if (!pool || !poolPda) {
      return { success: false, outputAmount: BigInt(0), error: 'AMM not available' };
    }

    try {
      const connection = new Connection(SOLANA_RPC);
      const provider = new AnchorProvider(
        connection,
        { 
          publicKey: userPublicKey, 
          signTransaction: async <T,>(tx: T): Promise<T> => tx, 
          signAllTransactions: async <T,>(txs: T[]): Promise<T[]> => txs 
        } as any,
        { commitment: 'confirmed' }
      );
      const program = new Program(IDL as any, provider) as Program<WxmrBridge>;

      const userWxmr = await getAssociatedTokenAddress(WXMR_MINT, userPublicKey);
      const userUsdc = await getAssociatedTokenAddress(USDC_MINT, userPublicKey);

      const tx = await (program.methods as any)
        .buyWxmr(new BN(usdcAmount.toString()))
        .accounts({
          pool: poolPda,
          user: userPublicKey,
          userWxmr,
          userUsdc,
          poolWxmr: pool.poolWxmr,
          poolUsdc: pool.poolUsdc,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .transaction();

      tx.feePayer = userPublicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      const simulation = await connection.simulateTransaction(tx);
      
      if (simulation.value.err) {
        const errMsg = JSON.stringify(simulation.value.err);
        return { 
          success: false, 
          outputAmount: BigInt(0), 
          error: errMsg.includes('InsufficientLiquidity') ? 'Insufficient AMM liquidity' :
                 errMsg.includes('InsufficientBalance') ? 'Insufficient USDC balance' :
                 errMsg.includes('PriceStale') ? 'AMM price stale' :
                 'Simulation failed'
        };
      }

      // Calculate expected output
      const outputAmount = calculateBuyOutput(usdcAmount);
      return { success: true, outputAmount };
    } catch (e) {
      console.error('AMM buy simulation error:', e);
      return { 
        success: false, 
        outputAmount: BigInt(0), 
        error: e instanceof Error ? e.message : 'Simulation failed' 
      };
    }
  }, [pool, poolPda, calculateBuyOutput]);

  // Simulate a sell transaction
  const simulateSell = useCallback(async (
    wxmrAmount: bigint,
    userPublicKey: PublicKey
  ): Promise<{ success: boolean; outputAmount: bigint; error?: string }> => {
    if (!pool || !poolPda) {
      return { success: false, outputAmount: BigInt(0), error: 'AMM not available' };
    }

    try {
      const connection = new Connection(SOLANA_RPC);
      const provider = new AnchorProvider(
        connection,
        { 
          publicKey: userPublicKey, 
          signTransaction: async <T,>(tx: T): Promise<T> => tx, 
          signAllTransactions: async <T,>(txs: T[]): Promise<T[]> => txs 
        } as any,
        { commitment: 'confirmed' }
      );
      const program = new Program(IDL as any, provider) as Program<WxmrBridge>;

      const userWxmr = await getAssociatedTokenAddress(WXMR_MINT, userPublicKey);
      const userUsdc = await getAssociatedTokenAddress(USDC_MINT, userPublicKey);

      const tx = await (program.methods as any)
        .sellWxmr(new BN(wxmrAmount.toString()))
        .accounts({
          pool: poolPda,
          user: userPublicKey,
          userWxmr,
          userUsdc,
          poolWxmr: pool.poolWxmr,
          poolUsdc: pool.poolUsdc,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .transaction();

      tx.feePayer = userPublicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      const simulation = await connection.simulateTransaction(tx);
      
      if (simulation.value.err) {
        const errMsg = JSON.stringify(simulation.value.err);
        return { 
          success: false, 
          outputAmount: BigInt(0), 
          error: errMsg.includes('InsufficientLiquidity') ? 'Insufficient AMM liquidity' :
                 errMsg.includes('InsufficientBalance') ? 'Insufficient wXMR balance' :
                 errMsg.includes('PriceStale') ? 'AMM price stale' :
                 'Simulation failed'
        };
      }

      // Calculate expected output
      const outputAmount = calculateSellOutput(wxmrAmount);
      return { success: true, outputAmount };
    } catch (e) {
      console.error('AMM sell simulation error:', e);
      return { 
        success: false, 
        outputAmount: BigInt(0), 
        error: e instanceof Error ? e.message : 'Simulation failed' 
      };
    }
  }, [pool, poolPda, calculateSellOutput]);

  return {
    pool,
    poolPda,
    loading,
    error,
    isPriceStale,
    priceAge,
    // Be permissive - let simulation determine if it works
    // Only check pool exists and is enabled, let on-chain staleness check be enforced via simulation
    isAvailable: pool !== null && pool.enabled,
    calculateBuyOutput,
    calculateSellOutput,
    simulateBuy,
    simulateSell,
    refresh: fetchPool,
  };
}

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import type { Wallet as AnchorProviderWallet } from '@coral-xyz/anchor/dist/cjs/provider';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import type { WxmrBridge } from '@/idl/wxmr_bridge';
import IDL from '@/idl/wxmr_bridge.json';
import { XMR_MINT, USDC_MINT } from '@/constants';

const PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_BRIDGE_PROGRAM_ID || 'EzBkC8P5wxab9kwrtV5hRdynHAfB5w3UPcPXNgMseVA8');
const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

function createReadonlyWallet(publicKey: PublicKey): AnchorProviderWallet {
  return {
    publicKey,
    signTransaction: async (tx) => tx,
    signAllTransactions: async (txs) => txs,
  };
}

export interface AmmPoolData {
  authority: PublicKey;
  wxmrMint: PublicKey;
  usdcMint: PublicKey;
  poolWxmr: PublicKey;
  poolUsdc: PublicKey;
  buyPrice: bigint;  // USDC atomic units per 1 XMR (1e12 piconero)
  sellPrice: bigint; // USDC atomic units per 1 XMR
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
        createReadonlyWallet(PublicKey.default),
        { commitment: 'confirmed' }
      );
      
      const program = new Program<WxmrBridge>(IDL as WxmrBridge, provider);
      
      // Find AMM pool PDA
      const [ammPoolPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('amm_pool')],
        PROGRAM_ID
      );
      setPoolPda(ammPoolPda);

      // Fetch pool account
      const poolAccount = await program.account.ammPool.fetchNullable(ammPoolPda);
      
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
    // Refresh every 30 seconds (AMM data doesn't change often)
    const interval = setInterval(fetchPool, 30000);
    return () => clearInterval(interval);
  }, [fetchPool]);

  // Price staleness - not checked on frontend, let on-chain handle it
  const isPriceStale = false;
  const priceAge = pool ? Math.floor(Date.now() / 1000 - pool.lastPriceUpdate) : 0;

  // Calculate XMR output for given USDC input
  const calculateBuyOutput = useCallback((usdcAmount: bigint): bigint => {
    if (!pool || usdcAmount <= BigInt(0)) return BigInt(0);
    // xmr = (usdc * 1e12) / buy_price
    return (usdcAmount * BigInt('1000000000000')) / pool.buyPrice;
  }, [pool]);

  // Calculate USDC output for given XMR input
  const calculateSellOutput = useCallback((wxmrAmount: bigint): bigint => {
    if (!pool || wxmrAmount <= BigInt(0)) return BigInt(0);
    // usdc = (xmr * sell_price) / 1e12
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
        createReadonlyWallet(userPublicKey),
        { commitment: 'confirmed' }
      );
      const program = new Program<WxmrBridge>(IDL as WxmrBridge, provider);

      const userWxmr = await getAssociatedTokenAddress(XMR_MINT, userPublicKey);
      const userUsdc = await getAssociatedTokenAddress(USDC_MINT, userPublicKey);
      const ensureUserWxmrAtaIx = createAssociatedTokenAccountIdempotentInstruction(
        userPublicKey,
        userWxmr,
        userPublicKey,
        XMR_MINT,
        TOKEN_PROGRAM_ID
      );

      const tx = await program.methods
        .buyWxmr(new BN(usdcAmount.toString()))
        .preInstructions([ensureUserWxmrAtaIx])
        .accountsPartial({
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
        createReadonlyWallet(userPublicKey),
        { commitment: 'confirmed' }
      );
      const program = new Program<WxmrBridge>(IDL as WxmrBridge, provider);

      const userWxmr = await getAssociatedTokenAddress(XMR_MINT, userPublicKey);
      const userUsdc = await getAssociatedTokenAddress(USDC_MINT, userPublicKey);
      const ensureUserUsdcAtaIx = createAssociatedTokenAccountIdempotentInstruction(
        userPublicKey,
        userUsdc,
        userPublicKey,
        USDC_MINT,
        TOKEN_PROGRAM_ID
      );

      const tx = await program.methods
        .sellWxmr(new BN(wxmrAmount.toString()))
        .preInstructions([ensureUserUsdcAtaIx])
        .accountsPartial({
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
                 errMsg.includes('InsufficientBalance') ? 'Insufficient XMR balance' :
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

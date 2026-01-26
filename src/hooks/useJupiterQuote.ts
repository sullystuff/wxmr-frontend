'use client';

import { useState, useCallback } from 'react';
import { Connection, VersionedTransaction, PublicKey } from '@solana/web3.js';

const JUPITER_QUOTE_API = 'https://quote-api.jup.ag/v6/quote';
const JUPITER_SWAP_API = 'https://quote-api.jup.ag/v6/swap';
const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Token addresses
const WXMR_MINT = 'WXMRyRZhsa19ety5erZhHg4N3xj3EVN92u94422teJp';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: number;
  routePlan: any[];
  contextSlot: number;
}

export interface SwapTransaction {
  swapTransaction: string;
  lastValidBlockHeight: number;
}

export function useJupiterQuote() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get quote for buying wXMR with USDC
  const getBuyQuote = useCallback(async (usdcAmount: bigint): Promise<JupiterQuote | null> => {
    if (usdcAmount <= BigInt(0)) return null;
    
    setLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams({
        inputMint: USDC_MINT,
        outputMint: WXMR_MINT,
        amount: usdcAmount.toString(),
        slippageBps: '50', // 0.5% slippage
      });

      const response = await fetch(`${JUPITER_QUOTE_API}?${params}`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Quote failed: ${response.status}`);
      }

      const quote = await response.json();
      return quote;
    } catch (e) {
      console.error('Jupiter quote error:', e);
      setError(e instanceof Error ? e.message : 'Failed to get Jupiter quote');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Get quote for selling wXMR for USDC
  const getSellQuote = useCallback(async (wxmrAmount: bigint): Promise<JupiterQuote | null> => {
    if (wxmrAmount <= BigInt(0)) return null;
    
    setLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams({
        inputMint: WXMR_MINT,
        outputMint: USDC_MINT,
        amount: wxmrAmount.toString(),
        slippageBps: '50', // 0.5% slippage
      });

      const response = await fetch(`${JUPITER_QUOTE_API}?${params}`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Quote failed: ${response.status}`);
      }

      const quote = await response.json();
      return quote;
    } catch (e) {
      console.error('Jupiter quote error:', e);
      setError(e instanceof Error ? e.message : 'Failed to get Jupiter quote');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Get swap transaction from Jupiter
  const getSwapTransaction = useCallback(async (
    quote: JupiterQuote,
    userPublicKey: string
  ): Promise<SwapTransaction | null> => {
    try {
      const response = await fetch(JUPITER_SWAP_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey,
          wrapAndUnwrapSol: true,
          // Add referral if configured
          ...(process.env.NEXT_PUBLIC_JUPITER_REFERRAL_ACCOUNT && {
            feeAccount: process.env.NEXT_PUBLIC_JUPITER_REFERRAL_ACCOUNT,
          }),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Swap transaction failed: ${response.status}`);
      }

      return await response.json();
    } catch (e) {
      console.error('Jupiter swap error:', e);
      setError(e instanceof Error ? e.message : 'Failed to get swap transaction');
      return null;
    }
  }, []);

  // Simulate a Jupiter swap to verify it will work
  const simulateSwap = useCallback(async (
    quote: JupiterQuote,
    userPublicKey: string
  ): Promise<{ success: boolean; outputAmount: bigint; error?: string }> => {
    try {
      // Get the swap transaction
      const swapData = await getSwapTransaction(quote, userPublicKey);
      if (!swapData) {
        return { success: false, outputAmount: BigInt(0), error: 'Failed to build swap transaction' };
      }

      // Simulate it
      const connection = new Connection(SOLANA_RPC);
      const txBuf = Buffer.from(swapData.swapTransaction, 'base64');
      const tx = VersionedTransaction.deserialize(txBuf);

      const simulation = await connection.simulateTransaction(tx, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      });

      if (simulation.value.err) {
        const errMsg = JSON.stringify(simulation.value.err);
        return { 
          success: false, 
          outputAmount: BigInt(0), 
          error: errMsg.includes('InsufficientFunds') ? 'Insufficient balance' :
                 errMsg.includes('SlippageToleranceExceeded') ? 'Slippage too high' :
                 'Route unavailable'
        };
      }

      return { 
        success: true, 
        outputAmount: BigInt(quote.outAmount) 
      };
    } catch (e) {
      console.error('Jupiter simulation error:', e);
      return { 
        success: false, 
        outputAmount: BigInt(0), 
        error: e instanceof Error ? e.message : 'Simulation failed' 
      };
    }
  }, [getSwapTransaction]);

  return {
    loading,
    error,
    getBuyQuote,
    getSellQuote,
    getSwapTransaction,
    simulateSwap,
  };
}

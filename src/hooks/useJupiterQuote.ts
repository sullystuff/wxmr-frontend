'use client';

import { useState, useCallback } from 'react';
import { Connection, VersionedTransaction } from '@solana/web3.js';

// Jupiter API config
const JUPITER_API_KEY = process.env.NEXT_PUBLIC_JUPITER_API_KEY || '';
// Public endpoint: free but has 0.2% fee and 10 req/sec limit
// Official endpoint: requires API key from https://portal.jup.ag
const USE_PUBLIC_API = !JUPITER_API_KEY;
const JUPITER_QUOTE_URL = USE_PUBLIC_API 
  ? 'https://public.jupiterapi.com/quote'
  : 'https://api.jup.ag/ultra/v1/order';
const JUPITER_SWAP_URL = USE_PUBLIC_API
  ? 'https://public.jupiterapi.com/swap'
  : 'https://api.jup.ag/ultra/v1/execute';
const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Token addresses
const WXMR_MINT = 'WXMRyRZhsa19ety5erZhHg4N3xj3EVN92u94422teJp';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  routePlan: any[];
  // Ultra API specific
  transaction?: string | null;
  requestId?: string;
  // Public API specific
  contextSlot?: number;
  errorCode?: number;
  errorMessage?: string;
}

export function useJupiterQuote() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Build headers based on API type
  const getHeaders = useCallback(() => {
    const headers: Record<string, string> = {};
    if (JUPITER_API_KEY) {
      headers['x-api-key'] = JUPITER_API_KEY;
    }
    return headers;
  }, []);

  // Get quote for buying wXMR with USDC
  const getBuyQuote = useCallback(async (usdcAmount: bigint, takerPubkey?: string): Promise<JupiterQuote | null> => {
    if (usdcAmount <= BigInt(0)) return null;
    
    setLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams({
        inputMint: USDC_MINT,
        outputMint: WXMR_MINT,
        amount: usdcAmount.toString(),
      });
      
      // Add slippage for public API
      if (USE_PUBLIC_API) {
        params.set('slippageBps', '50');
      }
      
      // Add taker for Ultra API
      if (!USE_PUBLIC_API && takerPubkey) {
        params.set('taker', takerPubkey);
      }

      const response = await fetch(`${JUPITER_QUOTE_URL}?${params}`, {
        headers: getHeaders(),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.errorMessage || `Quote failed: ${response.status}`);
      }

      const data = await response.json();
      
      // Check for errors in response
      if (data.errorCode || data.error) {
        throw new Error(data.errorMessage || data.error || 'Quote failed');
      }
      
      return data;
    } catch (e) {
      console.error('Jupiter quote error:', e);
      setError(e instanceof Error ? e.message : 'Failed to get Jupiter quote');
      return null;
    } finally {
      setLoading(false);
    }
  }, [getHeaders]);

  // Get quote for selling wXMR for USDC
  const getSellQuote = useCallback(async (wxmrAmount: bigint, takerPubkey?: string): Promise<JupiterQuote | null> => {
    if (wxmrAmount <= BigInt(0)) return null;
    
    setLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams({
        inputMint: WXMR_MINT,
        outputMint: USDC_MINT,
        amount: wxmrAmount.toString(),
      });
      
      // Add slippage for public API
      if (USE_PUBLIC_API) {
        params.set('slippageBps', '50');
      }
      
      // Add taker for Ultra API
      if (!USE_PUBLIC_API && takerPubkey) {
        params.set('taker', takerPubkey);
      }

      const response = await fetch(`${JUPITER_QUOTE_URL}?${params}`, {
        headers: getHeaders(),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.errorMessage || `Quote failed: ${response.status}`);
      }

      const data = await response.json();
      
      // Check for errors in response
      if (data.errorCode || data.error) {
        throw new Error(data.errorMessage || data.error || 'Quote failed');
      }
      
      return data;
    } catch (e) {
      console.error('Jupiter quote error:', e);
      setError(e instanceof Error ? e.message : 'Failed to get Jupiter quote');
      return null;
    } finally {
      setLoading(false);
    }
  }, [getHeaders]);

  // Get swap transaction
  const getSwapTransaction = useCallback(async (
    quote: JupiterQuote,
    userPublicKey: string
  ): Promise<{ swapTransaction: string } | null> => {
    try {
      if (USE_PUBLIC_API) {
        // Public API: POST to /swap with quote
        const response = await fetch(JUPITER_SWAP_URL, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            ...getHeaders(),
          },
          body: JSON.stringify({
            quoteResponse: quote,
            userPublicKey,
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Swap failed: ${response.status}`);
        }

        const data = await response.json();
        return { swapTransaction: data.swapTransaction };
      } else {
        // Ultra API: transaction is in the order, but need to re-fetch with taker
        if (quote.transaction) {
          return { swapTransaction: quote.transaction };
        }
        
        // Re-fetch with taker
        const isBuying = quote.inputMint === USDC_MINT;
        const newQuote = isBuying 
          ? await getBuyQuote(BigInt(quote.inAmount), userPublicKey)
          : await getSellQuote(BigInt(quote.inAmount), userPublicKey);
        
        if (!newQuote?.transaction) {
          return null;
        }
        return { swapTransaction: newQuote.transaction };
      }
    } catch (e) {
      console.error('Jupiter swap error:', e);
      setError(e instanceof Error ? e.message : 'Failed to get swap transaction');
      return null;
    }
  }, [getHeaders, getBuyQuote, getSellQuote]);

  // Simulate a Jupiter swap to verify it will work
  const simulateSwap = useCallback(async (
    quote: JupiterQuote,
    userPublicKey: string
  ): Promise<{ success: boolean; outputAmount: bigint; error?: string }> => {
    try {
      const txData = await getSwapTransaction(quote, userPublicKey);
      if (!txData) {
        return { success: false, outputAmount: BigInt(0), error: 'No transaction available' };
      }

      // Simulate it
      const connection = new Connection(SOLANA_RPC);
      const txBuf = Buffer.from(txData.swapTransaction, 'base64');
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

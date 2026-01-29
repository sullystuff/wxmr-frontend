'use client';

import { useState, useCallback } from 'react';
import { USDC_MINT, WXMR_MINT } from '@/constants';

// Jupiter API config
const JUPITER_API_KEY = process.env.NEXT_PUBLIC_JUPITER_API_KEY || '';
const JUPITER_QUOTE_URL = 'https://api.jup.ag/ultra/v1/order';

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
}

export function useJupiterQuote() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getHeaders = useCallback(() => {
    const headers: Record<string, string> = {};
    if (JUPITER_API_KEY) {
      headers['x-api-key'] = JUPITER_API_KEY;
    }
    return headers;
  }, []);

  // Get quote - isBuying: true = USDC -> wXMR, false = wXMR -> USDC
  const getQuote = useCallback(async (
    amount: bigint, 
    isBuying: boolean, 
    takerPubkey?: string
  ): Promise<JupiterQuote | null> => {
    if (amount <= BigInt(0)) return null;
    
    setLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams({
        inputMint: isBuying ? USDC_MINT.toBase58() : WXMR_MINT.toBase58(),
        outputMint: isBuying ? WXMR_MINT.toBase58() : USDC_MINT.toBase58(),
        amount: amount.toString(),
      });
      
      if (takerPubkey) {
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

  const getBuyQuote = useCallback(
    (amount: bigint, taker?: string) => getQuote(amount, true, taker),
    [getQuote]
  );
  const getSellQuote = useCallback(
    (amount: bigint, taker?: string) => getQuote(amount, false, taker),
    [getQuote]
  );

  const getSwapTransaction = useCallback(async (
    quote: JupiterQuote,
    userPublicKey: string
  ): Promise<{ swapTransaction: string } | null> => {
    try {
      // Ultra API: transaction already in quote if taker was provided
      if (quote.transaction) {
        return { swapTransaction: quote.transaction };
      }
      
      // Re-fetch with taker to get transaction
      const isBuying = quote.inputMint === USDC_MINT.toBase58();
      const newQuote = await getQuote(BigInt(quote.inAmount), isBuying, userPublicKey);
      
      if (!newQuote?.transaction) {
        return null;
      }
      return { swapTransaction: newQuote.transaction };
    } catch (e) {
      console.error('Jupiter swap error:', e);
      setError(e instanceof Error ? e.message : 'Failed to get swap transaction');
      return null;
    }
  }, [getQuote]);

  // Simulate a Jupiter swap to verify it will work
  // const simulateSwap = useCallback(async (
  //   quote: JupiterQuote,
  //   userPublicKey: string
  // ): Promise<{ success: boolean; outputAmount: bigint; error?: string }> => {
  //   try {
  //     const txData = await getSwapTransaction(quote, userPublicKey);
  //     if (!txData) {
  //       return { success: false, outputAmount: BigInt(0), error: 'No transaction available' };
  //     }

  //     // Simulate it
  //     const connection = new Connection(SOLANA_RPC);
  //     const txBuf = Buffer.from(txData.swapTransaction, 'base64');
  //     const tx = VersionedTransaction.deserialize(txBuf);

  //     const simulation = await connection.simulateTransaction(tx, {
  //       sigVerify: false,
  //       replaceRecentBlockhash: true,
  //     });

  //     if (simulation.value.err) {
  //       const errMsg = JSON.stringify(simulation.value.err);
  //       return { 
  //         success: false, 
  //         outputAmount: BigInt(0), 
  //         error: errMsg.includes('InsufficientFunds') ? 'Insufficient balance' :
  //                errMsg.includes('SlippageToleranceExceeded') ? 'Slippage too high' :
  //                'Route unavailable'
  //       };
  //     }

  //     return { 
  //       success: true, 
  //       outputAmount: BigInt(quote.outAmount) 
  //     };
  //   } catch (e) {
  //     console.error('Jupiter simulation error:', e);
  //     return { 
  //       success: false, 
  //       outputAmount: BigInt(0), 
  //       error: e instanceof Error ? e.message : 'Simulation failed' 
  //     };
  //   }
  // }, [getSwapTransaction]);

  return {
    loading,
    error,
    getQuote,
    getBuyQuote,
    getSellQuote,
    getSwapTransaction,
    // simulateSwap,
  };
}

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import type { WxmrBridge } from '@/idl/wxmr_bridge';
import IDL from '@/idl/wxmr_bridge.json';
import { useAmmPool } from '@/hooks/useAmmPool';
import { useJupiterQuote, JupiterQuote } from '@/hooks/useJupiterQuote';

// Constants
const WXMR_MINT = new PublicKey('WXMRyRZhsa19ety5erZhHg4N3xj3EVN92u94422teJp');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_BRIDGE_PROGRAM_ID || 'EzBkC8P5wxab9kwrtV5hRdynHAfB5w3UPcPXNgMseVA8');

type SwapMode = 'buy' | 'sell';
type RouteSource = 'amm' | 'jupiter' | 'none';

interface RouteQuote {
  source: RouteSource;
  inputAmount: bigint;
  outputAmount: bigint;
  pricePerWxmr: number;
  available: boolean;
  reason?: string;
}

interface SwapModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SwapModal({ isOpen, onClose }: SwapModalProps) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { connected, publicKey, signTransaction } = wallet;
  
  // AMM and Jupiter hooks
  const amm = useAmmPool();
  const jupiter = useJupiterQuote();
  
  // Form state
  const [swapMode, setSwapMode] = useState<SwapMode>('buy');
  const [inputAmount, setInputAmount] = useState('');
  const [selectedRoute, setSelectedRoute] = useState<RouteSource>('none');
  const [jupiterQuote, setJupiterQuote] = useState<JupiterQuote | null>(null);
  const [isSwapping, setIsSwapping] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  
  // Simulation results
  const [ammSimResult, setAmmSimResult] = useState<{ success: boolean; outputAmount: bigint; error?: string } | null>(null);
  const [jupiterSimResult, setJupiterSimResult] = useState<{ success: boolean; outputAmount: bigint; error?: string } | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setInputAmount('');
      setTxSignature(null);
      setAmmSimResult(null);
      setJupiterSimResult(null);
    }
  }, [isOpen]);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleEscape);
      return () => window.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, onClose]);

  // Parse input amount
  const parsedInput = useMemo(() => {
    const num = parseFloat(inputAmount);
    if (isNaN(num) || num <= 0) return BigInt(0);
    const decimals = swapMode === 'buy' ? 6 : 12;
    return BigInt(Math.floor(num * Math.pow(10, decimals)));
  }, [inputAmount, swapMode]);

  // Fetch Jupiter quote when input changes
  useEffect(() => {
    if (!isOpen) return;
    
    const fetchJupiterQuote = async () => {
      if (parsedInput <= BigInt(0)) {
        setJupiterQuote(null);
        return;
      }

      const quote = swapMode === 'buy'
        ? await jupiter.getBuyQuote(parsedInput)
        : await jupiter.getSellQuote(parsedInput);
      
      setJupiterQuote(quote);
    };

    const debounce = setTimeout(fetchJupiterQuote, 300);
    return () => clearTimeout(debounce);
  }, [parsedInput, swapMode, jupiter, isOpen]);

  // Simulate both routes when we have the data
  useEffect(() => {
    if (!isOpen) return;
    
    const simulateRoutes = async () => {
      if (parsedInput <= BigInt(0) || !publicKey) {
        setAmmSimResult(null);
        setJupiterSimResult(null);
        return;
      }

      setIsSimulating(true);

      const [ammResult, jupResult] = await Promise.all([
        (async () => {
          if (!amm.isAvailable) {
            return { 
              success: false, 
              outputAmount: BigInt(0), 
              error: !amm.pool ? 'AMM not initialized' : 
                     !amm.pool.enabled ? 'AMM disabled' :
                     amm.isPriceStale ? 'Price stale' : 'Not available'
            };
          }
          return swapMode === 'buy'
            ? await amm.simulateBuy(parsedInput, publicKey)
            : await amm.simulateSell(parsedInput, publicKey);
        })(),
        (async () => {
          if (!jupiterQuote) {
            return { success: false, outputAmount: BigInt(0), error: jupiter.error || 'No route found' };
          }
          return await jupiter.simulateSwap(jupiterQuote, publicKey.toBase58());
        })(),
      ]);

      setAmmSimResult(ammResult);
      setJupiterSimResult(jupResult);
      setIsSimulating(false);
    };

    const debounce = setTimeout(simulateRoutes, 500);
    return () => clearTimeout(debounce);
  }, [parsedInput, publicKey, swapMode, amm, jupiter, jupiterQuote, isOpen]);

  // Build AMM quote from simulation
  const ammQuote = useMemo((): RouteQuote => {
    if (!ammSimResult) {
      return {
        source: 'amm',
        inputAmount: parsedInput,
        outputAmount: BigInt(0),
        pricePerWxmr: 0,
        available: false,
        reason: !publicKey ? 'Connect wallet' : isSimulating ? 'Simulating...' : 'Enter amount',
      };
    }

    const price = amm.pool ? (swapMode === 'buy'
      ? Number(amm.pool.buyPrice) / 1e6
      : Number(amm.pool.sellPrice) / 1e6) : 0;

    return {
      source: 'amm',
      inputAmount: parsedInput,
      outputAmount: ammSimResult.outputAmount,
      pricePerWxmr: price,
      available: ammSimResult.success,
      reason: ammSimResult.error,
    };
  }, [ammSimResult, parsedInput, swapMode, amm.pool, publicKey, isSimulating]);

  // Build Jupiter quote from simulation
  const jupiterQuoteResult = useMemo((): RouteQuote => {
    if (!jupiterSimResult || !jupiterQuote) {
      return {
        source: 'jupiter',
        inputAmount: parsedInput,
        outputAmount: BigInt(0),
        pricePerWxmr: 0,
        available: false,
        reason: !publicKey ? 'Connect wallet' : isSimulating ? 'Simulating...' : jupiter.error || 'Enter amount',
      };
    }

    const outputAmount = jupiterSimResult.outputAmount;
    let pricePerWxmr: number = 0;
    if (outputAmount > BigInt(0)) {
      if (swapMode === 'buy') {
        pricePerWxmr = (Number(parsedInput) / 1e6) / (Number(outputAmount) / 1e12);
      } else {
        pricePerWxmr = (Number(outputAmount) / 1e6) / (Number(parsedInput) / 1e12);
      }
    }

    return {
      source: 'jupiter',
      inputAmount: parsedInput,
      outputAmount,
      pricePerWxmr,
      available: jupiterSimResult.success,
      reason: jupiterSimResult.error,
    };
  }, [jupiterSimResult, jupiterQuote, parsedInput, swapMode, publicKey, isSimulating, jupiter.error]);

  // Determine best route
  const bestRoute = useMemo((): RouteSource => {
    if (!ammQuote.available && !jupiterQuoteResult.available) return 'none';
    if (!ammQuote.available) return 'jupiter';
    if (!jupiterQuoteResult.available) return 'amm';
    if (ammQuote.outputAmount > jupiterQuoteResult.outputAmount) return 'amm';
    if (jupiterQuoteResult.outputAmount > ammQuote.outputAmount) return 'jupiter';
    return 'amm';
  }, [ammQuote, jupiterQuoteResult]);

  // Auto-select best route
  useEffect(() => {
    if (bestRoute !== 'none') {
      setSelectedRoute(bestRoute);
    }
  }, [bestRoute]);

  const selectedQuote = selectedRoute === 'amm' ? ammQuote : 
                        selectedRoute === 'jupiter' ? jupiterQuoteResult : null;

  // Execute swap on AMM
  const executeAmmSwap = async () => {
    if (!publicKey || !signTransaction || !amm.poolPda || !amm.pool) {
      throw new Error('Wallet not connected or AMM not available');
    }

    const provider = new AnchorProvider(connection, wallet as any, { commitment: 'confirmed' });
    const program = new Program(IDL as any, provider) as Program<WxmrBridge>;

    const userWxmr = await getAssociatedTokenAddress(WXMR_MINT, publicKey);
    const userUsdc = await getAssociatedTokenAddress(USDC_MINT, publicKey);

    let tx: any;
    if (swapMode === 'buy') {
      tx = await (program.methods as any)
        .buyWxmr(new BN(parsedInput.toString()))
        .accounts({
          pool: amm.poolPda,
          user: publicKey,
          userWxmr,
          userUsdc,
          poolWxmr: amm.pool.poolWxmr,
          poolUsdc: amm.pool.poolUsdc,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .transaction();
    } else {
      tx = await (program.methods as any)
        .sellWxmr(new BN(parsedInput.toString()))
        .accounts({
          pool: amm.poolPda,
          user: publicKey,
          userWxmr,
          userUsdc,
          poolWxmr: amm.pool.poolWxmr,
          poolUsdc: amm.pool.poolUsdc,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .transaction();
    }

    tx.feePayer = publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    const signedTx = await signTransaction(tx);
    const signature = await connection.sendRawTransaction(signedTx.serialize());
    await connection.confirmTransaction(signature, 'confirmed');
    
    return signature;
  };

  // Execute swap on Jupiter
  const executeJupiterSwap = async () => {
    if (!publicKey || !signTransaction || !jupiterQuote) {
      throw new Error('Wallet not connected or no Jupiter quote');
    }

    const swapData = await jupiter.getSwapTransaction(jupiterQuote, publicKey.toBase58());
    if (!swapData) {
      throw new Error('Failed to get Jupiter swap transaction');
    }

    const txBuf = Buffer.from(swapData.swapTransaction, 'base64');
    const tx = VersionedTransaction.deserialize(txBuf);
    const signedTx = await signTransaction(tx);
    
    const signature = await connection.sendRawTransaction(signedTx.serialize());
    await connection.confirmTransaction(signature, 'confirmed');
    
    return signature;
  };

  // Handle swap
  const handleSwap = async () => {
    if (!selectedRoute || selectedRoute === 'none') return;
    
    setIsSwapping(true);
    setTxSignature(null);
    
    try {
      const signature = selectedRoute === 'amm' 
        ? await executeAmmSwap()
        : await executeJupiterSwap();
      
      setTxSignature(signature);
      setInputAmount('');
    } catch (e) {
      console.error('Swap failed:', e);
      alert(`Swap failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setIsSwapping(false);
    }
  };

  // Format helpers
  const formatUsdc = (atomic: bigint) => (Number(atomic) / 1e6).toFixed(2);
  const formatWxmr = (atomic: bigint) => (Number(atomic) / 1e12).toFixed(6);
  const formatPrice = (price: number) => price.toFixed(2);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div 
        className="bg-[var(--card)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-[var(--border)]">
          <h2 className="text-xl font-bold">Swap</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--background)] rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Swap Mode Toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => { setSwapMode('buy'); setInputAmount(''); }}
              className={`flex-1 py-2.5 px-4 rounded-lg font-semibold transition-all text-sm ${
                swapMode === 'buy'
                  ? 'bg-[#ff6600] text-white'
                  : 'bg-[var(--background)] text-[var(--muted)] hover:bg-[var(--card-hover)] border border-[var(--border)]'
              }`}
            >
              Buy wXMR
            </button>
            <button
              onClick={() => { setSwapMode('sell'); setInputAmount(''); }}
              className={`flex-1 py-2.5 px-4 rounded-lg font-semibold transition-all text-sm ${
                swapMode === 'sell'
                  ? 'bg-[#ff6600] text-white'
                  : 'bg-[var(--background)] text-[var(--muted)] hover:bg-[var(--card-hover)] border border-[var(--border)]'
              }`}
            >
              Sell wXMR
            </button>
          </div>

          {/* Input */}
          <div className="bg-[var(--background)] rounded-xl p-4 border border-[var(--border)]">
            <label className="block text-xs text-[var(--muted)] mb-2">
              {swapMode === 'buy' ? 'You pay (USDC)' : 'You pay (wXMR)'}
            </label>
            <input
              type="number"
              value={inputAmount}
              onChange={(e) => setInputAmount(e.target.value)}
              placeholder="0.00"
              className="w-full bg-transparent text-2xl font-mono focus:outline-none"
            />
          </div>

          {/* Route Comparison */}
          {parsedInput > BigInt(0) && (
            <div className="space-y-2">
              {/* AMM Route */}
              <button
                onClick={() => ammQuote.available && setSelectedRoute('amm')}
                disabled={!ammQuote.available}
                className={`w-full p-3 rounded-xl text-left transition-all border ${
                  selectedRoute === 'amm' 
                    ? 'border-[#ff6600] bg-[#ff6600]/10' 
                    : ammQuote.available ? 'border-[var(--border)] hover:border-[#ff6600]/50 bg-[var(--background)]' : 'border-[var(--border)] bg-[var(--background)] opacity-50'
                }`}
              >
                <div className="flex justify-between items-center mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">wXMR AMM</span>
                    {bestRoute === 'amm' && ammQuote.available && (
                      <span className="px-1.5 py-0.5 bg-green-500/20 text-green-400 text-xs rounded">Best</span>
                    )}
                  </div>
                  {selectedRoute === 'amm' && <span className="text-[#ff6600] text-sm">✓</span>}
                </div>
                {ammQuote.available ? (
                  <>
                    <p className="text-lg font-mono">
                      {swapMode === 'buy' ? formatWxmr(ammQuote.outputAmount) : formatUsdc(ammQuote.outputAmount)}
                      <span className="text-sm text-[var(--muted)] ml-1">
                        {swapMode === 'buy' ? 'wXMR' : 'USDC'}
                      </span>
                    </p>
                    <p className="text-xs text-[var(--muted)]">@ ${formatPrice(ammQuote.pricePerWxmr)}/wXMR</p>
                  </>
                ) : (
                  <p className="text-sm text-[var(--muted)]">{ammQuote.reason}</p>
                )}
              </button>

              {/* Jupiter Route */}
              <button
                onClick={() => jupiterQuoteResult.available && setSelectedRoute('jupiter')}
                disabled={!jupiterQuoteResult.available}
                className={`w-full p-3 rounded-xl text-left transition-all border ${
                  selectedRoute === 'jupiter' 
                    ? 'border-[#ff6600] bg-[#ff6600]/10' 
                    : jupiterQuoteResult.available ? 'border-[var(--border)] hover:border-[#ff6600]/50 bg-[var(--background)]' : 'border-[var(--border)] bg-[var(--background)] opacity-50'
                }`}
              >
                <div className="flex justify-between items-center mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">Jupiter</span>
                    {bestRoute === 'jupiter' && jupiterQuoteResult.available && (
                      <span className="px-1.5 py-0.5 bg-green-500/20 text-green-400 text-xs rounded">Best</span>
                    )}
                  </div>
                  {selectedRoute === 'jupiter' && <span className="text-[#ff6600] text-sm">✓</span>}
                </div>
                {jupiter.loading || isSimulating ? (
                  <p className="text-sm text-[var(--muted)]">{jupiter.loading ? 'Getting quote...' : 'Simulating...'}</p>
                ) : jupiterQuoteResult.available ? (
                  <>
                    <p className="text-lg font-mono">
                      {swapMode === 'buy' ? formatWxmr(jupiterQuoteResult.outputAmount) : formatUsdc(jupiterQuoteResult.outputAmount)}
                      <span className="text-sm text-[var(--muted)] ml-1">
                        {swapMode === 'buy' ? 'wXMR' : 'USDC'}
                      </span>
                    </p>
                    <p className="text-xs text-[var(--muted)]">@ ${formatPrice(jupiterQuoteResult.pricePerWxmr)}/wXMR</p>
                  </>
                ) : (
                  <p className="text-sm text-[var(--muted)]">{jupiterQuoteResult.reason}</p>
                )}
              </button>
            </div>
          )}

          {/* Output Preview */}
          {selectedQuote && selectedQuote.available && (
            <div className="bg-[var(--background)] rounded-xl p-4 border border-[var(--border)]">
              <label className="block text-xs text-[var(--muted)] mb-2">
                {swapMode === 'buy' ? 'You receive (wXMR)' : 'You receive (USDC)'}
              </label>
              <p className="text-2xl font-mono text-[#ff6600]">
                {swapMode === 'buy' 
                  ? formatWxmr(selectedQuote.outputAmount)
                  : formatUsdc(selectedQuote.outputAmount)}
              </p>
            </div>
          )}

          {/* Swap Button */}
          <button
            onClick={handleSwap}
            disabled={!connected || !selectedQuote?.available || isSwapping}
            className="w-full xmr-btn-primary text-white px-6 py-3.5 rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {!connected 
              ? 'Connect Wallet'
              : isSwapping 
                ? 'Swapping...'
                : !selectedQuote?.available
                  ? 'Enter amount'
                  : `Swap via ${selectedRoute === 'amm' ? 'wXMR AMM' : 'Jupiter'}`}
          </button>

          {/* Success message */}
          {txSignature && (
            <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-xl">
              <p className="text-green-400 font-semibold text-sm mb-1">Swap successful!</p>
              <a
                href={`https://solscan.io/tx/${txSignature}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#ff6600] hover:underline"
              >
                View on Solscan →
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

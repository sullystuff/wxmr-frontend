'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
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

// Monero Logo SVG component
function MoneroLogo({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 3756.09 3756.49" xmlns="http://www.w3.org/2000/svg">
      <path d="M4128,2249.81C4128,3287,3287.26,4127.86,2250,4127.86S372,3287,372,2249.81,1212.76,371.75,2250,371.75,4128,1212.54,4128,2249.81Z" transform="translate(-371.96 -371.75)" fill="#fff"/>
      <path d="M2250,371.75c-1036.89,0-1879.12,842.06-1877.8,1878,0.26,207.26,33.31,406.63,95.34,593.12h561.88V1263L2250,2483.57,3470.52,1263v1579.9h562c62.12-186.48,95-385.85,95.37-593.12C4129.66,1212.76,3287,372,2250,372Z" transform="translate(-371.96 -371.75)" fill="#f26822"/>
      <path d="M1969.3,2764.17l-532.67-532.7v994.14H1029.38l-384.29.07c329.63,540.8,925.35,902.56,1604.91,902.56S3525.31,3766.4,3855,3225.6H3063.25V2231.47l-532.7,532.7-280.61,280.61-280.62-280.61h0Z" transform="translate(-371.96 -371.75)" fill="#4d4d4d"/>
    </svg>
  );
}

type SwapMode = 'buy' | 'sell';
type RouteSource = 'amm' | 'jupiter' | 'none';

interface RouteQuote {
  source: RouteSource;
  inputAmount: bigint;
  outputAmount: bigint;
  pricePerWxmr: number; // USDC per 1 wXMR
  available: boolean;
  reason?: string;
}

export default function SwapPage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { connected, publicKey, signTransaction, sendTransaction } = wallet;
  
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

  // Parse input amount
  const parsedInput = useMemo(() => {
    const num = parseFloat(inputAmount);
    if (isNaN(num) || num <= 0) return BigInt(0);
    // Convert to atomic units (6 decimals for USDC when buying, 12 for wXMR when selling)
    const decimals = swapMode === 'buy' ? 6 : 12;
    return BigInt(Math.floor(num * Math.pow(10, decimals)));
  }, [inputAmount, swapMode]);

  // Fetch Jupiter quote when input changes
  useEffect(() => {
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
  }, [parsedInput, swapMode, jupiter]);

  // Simulate both routes when we have the data
  useEffect(() => {
    const simulateRoutes = async () => {
      if (parsedInput <= BigInt(0) || !publicKey) {
        setAmmSimResult(null);
        setJupiterSimResult(null);
        return;
      }

      setIsSimulating(true);

      // Simulate both routes in parallel
      const [ammResult, jupResult] = await Promise.all([
        // AMM simulation
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
        // Jupiter simulation
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
  }, [parsedInput, publicKey, swapMode, amm, jupiter, jupiterQuote]);

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

    // Calculate price per wXMR
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
    
    // Calculate effective price per wXMR
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

  // Determine best route based on simulation results
  const bestRoute = useMemo((): RouteSource => {
    if (!ammQuote.available && !jupiterQuoteResult.available) return 'none';
    if (!ammQuote.available) return 'jupiter';
    if (!jupiterQuoteResult.available) return 'amm';

    // Compare output amounts - higher is better
    if (ammQuote.outputAmount > jupiterQuoteResult.outputAmount) return 'amm';
    if (jupiterQuoteResult.outputAmount > ammQuote.outputAmount) return 'jupiter';
    
    // If equal, prefer AMM (no external fees)
    return 'amm';
  }, [ammQuote, jupiterQuoteResult]);

  // Auto-select best route
  useEffect(() => {
    if (bestRoute !== 'none') {
      setSelectedRoute(bestRoute);
    }
  }, [bestRoute]);

  // Get selected quote
  const selectedQuote = selectedRoute === 'amm' ? ammQuote : 
                        selectedRoute === 'jupiter' ? jupiterQuoteResult : null;

  // Execute swap on AMM
  const executeAmmSwap = async () => {
    if (!publicKey || !signTransaction || !amm.poolPda || !amm.pool) {
      throw new Error('Wallet not connected or AMM not available');
    }

    const provider = new AnchorProvider(
      connection,
      wallet as any,
      { commitment: 'confirmed' }
    );
    const program = new Program(IDL as any, provider) as Program<WxmrBridge>;

    // Get user token accounts
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

    // Deserialize and sign
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

  // Savings calculation
  const savings = useMemo(() => {
    if (!ammQuote.available || !jupiterQuoteResult.available) return null;
    const diff = ammQuote.outputAmount - jupiterQuoteResult.outputAmount;
    if (diff === BigInt(0)) return null;
    const decimals = swapMode === 'buy' ? 12 : 6;
    const percentage = (Number(diff) / Number(jupiterQuoteResult.outputAmount) * 100).toFixed(2);
    return {
      amount: diff > BigInt(0) ? diff : -diff,
      percentage: diff > BigInt(0) ? `+${percentage}%` : `${percentage}%`,
      better: diff > BigInt(0) ? 'amm' : 'jupiter',
    };
  }, [ammQuote, jupiterQuoteResult, swapMode]);

  return (
    <main className="min-h-screen p-4 md:p-8 xmr-pattern">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <header className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
          <div className="flex items-center gap-4">
            <MoneroLogo className="w-12 h-12" />
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-[#ff6600] to-[#ff8533] bg-clip-text text-transparent">
                Smart Swap
              </h1>
              <p className="text-[var(--muted)] mt-0.5">Best price routing</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link 
              href="/"
              className="px-4 py-2 bg-[var(--card)] hover:bg-[var(--card-hover)] border border-[var(--border)] rounded-lg font-semibold transition-all text-sm"
            >
              Bridge
            </Link>
            <WalletMultiButton />
          </div>
        </header>

        {/* Swap Mode Toggle */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => { setSwapMode('buy'); setInputAmount(''); }}
            className={`flex-1 py-3 px-4 rounded-lg font-semibold transition-all ${
              swapMode === 'buy'
                ? 'bg-[#ff6600] text-white'
                : 'bg-[var(--card)] text-[var(--muted)] hover:bg-[var(--card-hover)] border border-[var(--border)]'
            }`}
          >
            Buy wXMR
          </button>
          <button
            onClick={() => { setSwapMode('sell'); setInputAmount(''); }}
            className={`flex-1 py-3 px-4 rounded-lg font-semibold transition-all ${
              swapMode === 'sell'
                ? 'bg-[#ff6600] text-white'
                : 'bg-[var(--card)] text-[var(--muted)] hover:bg-[var(--card-hover)] border border-[var(--border)]'
            }`}
          >
            Sell wXMR
          </button>
        </div>

        {/* Input */}
        <div className="xmr-card p-4 mb-4">
          <label className="block text-sm text-[var(--muted)] mb-2">
            {swapMode === 'buy' ? 'You pay (USDC)' : 'You pay (wXMR)'}
          </label>
          <input
            type="number"
            value={inputAmount}
            onChange={(e) => setInputAmount(e.target.value)}
            placeholder="0.00"
            className="w-full bg-[var(--background)] border border-[var(--border)] rounded-lg px-4 py-3 text-xl font-mono focus:outline-none focus:border-[#ff6600]"
          />
        </div>

        {/* Route Comparison */}
        {parsedInput > BigInt(0) && (
          <div className="space-y-3 mb-4">
            {/* AMM Route */}
            <button
              onClick={() => ammQuote.available && setSelectedRoute('amm')}
              disabled={!ammQuote.available}
              className={`w-full xmr-card p-4 text-left transition-all ${
                selectedRoute === 'amm' 
                  ? 'border-[#ff6600] bg-[#ff6600]/10' 
                  : ammQuote.available ? 'hover:border-[#ff6600]/50' : 'opacity-50'
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">wXMR AMM</span>
                  {bestRoute === 'amm' && ammQuote.available && (
                    <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full">Best</span>
                  )}
                </div>
                {selectedRoute === 'amm' && (
                  <span className="text-[#ff6600]">✓</span>
                )}
              </div>
              {ammQuote.available ? (
                <>
                  <p className="text-lg font-mono text-white">
                    {swapMode === 'buy' ? formatWxmr(ammQuote.outputAmount) : formatUsdc(ammQuote.outputAmount)}
                    <span className="text-sm text-[var(--muted)] ml-1">
                      {swapMode === 'buy' ? 'wXMR' : 'USDC'}
                    </span>
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    @ ${formatPrice(ammQuote.pricePerWxmr)}/wXMR • No fees
                  </p>
                </>
              ) : (
                <p className="text-sm text-[var(--muted)]">{ammQuote.reason}</p>
              )}
            </button>

            {/* Jupiter Route */}
            <button
              onClick={() => jupiterQuoteResult.available && setSelectedRoute('jupiter')}
              disabled={!jupiterQuoteResult.available}
              className={`w-full xmr-card p-4 text-left transition-all ${
                selectedRoute === 'jupiter' 
                  ? 'border-[#ff6600] bg-[#ff6600]/10' 
                  : jupiterQuoteResult.available ? 'hover:border-[#ff6600]/50' : 'opacity-50'
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Jupiter</span>
                  {bestRoute === 'jupiter' && jupiterQuoteResult.available && (
                    <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full">Best</span>
                  )}
                </div>
                {selectedRoute === 'jupiter' && (
                  <span className="text-[#ff6600]">✓</span>
                )}
              </div>
              {jupiter.loading || isSimulating ? (
                <p className="text-sm text-[var(--muted)]">{jupiter.loading ? 'Getting quote...' : 'Simulating...'}</p>
              ) : jupiterQuoteResult.available ? (
                <>
                  <p className="text-lg font-mono text-white">
                    {swapMode === 'buy' ? formatWxmr(jupiterQuoteResult.outputAmount) : formatUsdc(jupiterQuoteResult.outputAmount)}
                    <span className="text-sm text-[var(--muted)] ml-1">
                      {swapMode === 'buy' ? 'wXMR' : 'USDC'}
                    </span>
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    @ ${formatPrice(jupiterQuoteResult.pricePerWxmr)}/wXMR • DEX aggregator
                  </p>
                </>
              ) : (
                <p className="text-sm text-[var(--muted)]">{jupiterQuoteResult.reason}</p>
              )}
            </button>

            {/* Savings indicator */}
            {savings && (
              <div className="text-center text-sm">
                <span className="text-[var(--muted)]">
                  {savings.better === 'amm' ? 'AMM' : 'Jupiter'} gives you{' '}
                </span>
                <span className="text-green-400 font-semibold">{savings.percentage}</span>
                <span className="text-[var(--muted)]"> more</span>
              </div>
            )}
          </div>
        )}

        {/* Output Preview */}
        {selectedQuote && selectedQuote.available && (
          <div className="xmr-card p-4 mb-4 bg-[var(--background)]">
            <label className="block text-sm text-[var(--muted)] mb-2">
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
          className="w-full xmr-btn-primary text-white px-6 py-4 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
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
          <div className="mt-4 p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
            <p className="text-green-400 font-semibold mb-1">Swap successful!</p>
            <a
              href={`https://solscan.io/tx/${txSignature}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[#ff6600] hover:underline break-all"
            >
              View on Solscan →
            </a>
          </div>
        )}

        {/* Info */}
        <div className="mt-6 space-y-3 text-sm text-[var(--muted)]">
          <div className="xmr-card p-4">
            <h3 className="font-semibold text-white mb-2">How it works</h3>
            <ul className="space-y-1">
              <li>• <strong>wXMR AMM</strong>: Direct swap with oracle pricing, no fees</li>
              <li>• <strong>Jupiter</strong>: DEX aggregator, routes through liquidity pools</li>
              <li>• We automatically select the route with the best output</li>
            </ul>
          </div>
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-2 gap-4 mt-6">
          <Link
            href="/"
            className="xmr-card p-4 hover:border-[#ff6600]/50 transition-all group text-center"
          >
            <p className="font-semibold text-white">Bridge</p>
            <p className="text-xs text-[var(--muted)]">Wrap/Unwrap XMR</p>
          </Link>
          <Link
            href="/transparency"
            className="xmr-card p-4 hover:border-[#ff6600]/50 transition-all group text-center"
          >
            <p className="font-semibold text-white">Transparency</p>
            <p className="text-xs text-[var(--muted)]">Verify reserves</p>
          </Link>
        </div>

        {/* Footer */}
        <footer className="mt-12 pt-6 border-t border-[var(--border)]">
          <div className="flex justify-center">
            <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <MoneroLogo className="w-4 h-4 opacity-50" />
              <span>Powered by Monero & Solana</span>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}

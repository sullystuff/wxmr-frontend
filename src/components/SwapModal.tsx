'use client';

import { useState, useEffect, useMemo } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddress,
  getAccount,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import type { Wallet as AnchorProviderWallet } from '@coral-xyz/anchor/dist/cjs/provider';
import type { WxmrBridge } from '@/idl/wxmr_bridge';
import IDL from '@/idl/wxmr_bridge.json';
import { useAmmPool } from '@/hooks/useAmmPool';
import { useJupiterQuote, JupiterQuote } from '@/hooks/useJupiterQuote';
import { XMR_MINT, USDC_MINT } from '@/constants';
import { Modal } from '@/components/ui/Modal';

// Token icons
function UsdcIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="16" fill="#2775CA" />
      <path d="M20.5 18.5c0-2.1-1.3-2.8-3.8-3.1-1.8-.3-2.2-.7-2.2-1.4 0-.8.6-1.3 1.8-1.3 1.1 0 1.7.4 2 1.2.1.2.2.3.4.3h1c.2 0 .4-.2.3-.4-.3-1.3-1.2-2.3-2.6-2.5v-1.5c0-.2-.2-.4-.4-.4h-.9c-.2 0-.4.2-.4.4v1.5c-1.7.2-2.8 1.4-2.8 2.8 0 2 1.2 2.7 3.7 3 1.9.3 2.3.7 2.3 1.5s-.7 1.4-1.9 1.4c-1.5 0-2-.6-2.2-1.4-.1-.2-.2-.3-.4-.3h-1c-.2 0-.4.2-.3.4.3 1.5 1.3 2.4 2.9 2.7v1.5c0 .2.2.4.4.4h.9c.2 0 .4-.2.4-.4v-1.5c1.8-.3 2.8-1.4 2.8-2.9z" fill="#fff" />
    </svg>
  );
}

function XmrIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="12" fill="#ff6b1a" />
      <path d="M12 5 6 10v8h2.2v-5.2L12 16l3.8-3.2V18H18v-8z" fill="#fff" />
    </svg>
  );
}

interface SwapModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type RouteSource = 'amm' | 'jupiter';

export function SwapModal({ isOpen, onClose }: SwapModalProps) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { connected, publicKey, signTransaction, sendTransaction } = wallet;

  const amm = useAmmPool();
  const jupiter = useJupiterQuote();

  // Extract stable function references to prevent effect loops
  const { getBuyQuote, getSellQuote } = jupiter;
  const { simulateBuy, simulateSell, calculateBuyOutput, calculateSellOutput } = amm;

  // Swap direction: true = USDC -> XMR, false = XMR -> USDC
  const [isBuying, setIsBuying] = useState(true);
  const [inputAmount, setInputAmount] = useState('');
  const [selectedRoute, setSelectedRoute] = useState<RouteSource>('amm');
  const [jupiterQuote, setJupiterQuote] = useState<JupiterQuote | null>(null);
  const [isSwapping, setIsSwapping] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [showRoutes, setShowRoutes] = useState(false);

  // Simulation results
  const [ammSimResult, setAmmSimResult] = useState<{ success: boolean; outputAmount: bigint; error?: string } | null>(null);
  const [jupiterSimResult, setJupiterSimResult] = useState<{ success: boolean; outputAmount: bigint; error?: string } | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);

  // User balances
  const [userUsdcBalance, setUserUsdcBalance] = useState<bigint>(BigInt(0));
  const [userWxmrBalance, setUserWxmrBalance] = useState<bigint>(BigInt(0));

  // Pool liquidity
  const [poolUsdcBalance, setPoolUsdcBalance] = useState<bigint>(BigInt(0));
  const [poolWxmrBalance, setPoolWxmrBalance] = useState<bigint>(BigInt(0));

  // Fetch user balances
  useEffect(() => {
    if (!isOpen || !publicKey) {
      setUserUsdcBalance(BigInt(0));
      setUserWxmrBalance(BigInt(0));
      return;
    }

    const fetchBalances = async () => {
      try {
        const [usdcAta, wxmrAta] = await Promise.all([
          getAssociatedTokenAddress(USDC_MINT, publicKey),
          getAssociatedTokenAddress(XMR_MINT, publicKey),
        ]);

        const [usdcAccount, wxmrAccount] = await Promise.all([
          getAccount(connection, usdcAta).catch(() => null),
          getAccount(connection, wxmrAta).catch(() => null),
        ]);

        setUserUsdcBalance(usdcAccount ? BigInt(usdcAccount.amount.toString()) : BigInt(0));
        setUserWxmrBalance(wxmrAccount ? BigInt(wxmrAccount.amount.toString()) : BigInt(0));
      } catch (e) {
        console.error('Error fetching balances:', e);
      }
    };

    fetchBalances();
  }, [isOpen, publicKey, connection, txSignature]); // Refetch after swap

  // Fetch pool liquidity
  useEffect(() => {
    if (!isOpen || !amm.pool) {
      setPoolUsdcBalance(BigInt(0));
      setPoolWxmrBalance(BigInt(0));
      return;
    }

    const fetchPoolBalances = async () => {
      try {
        const [usdcAccount, wxmrAccount] = await Promise.all([
          getAccount(connection, amm.pool!.poolUsdc).catch(() => null),
          getAccount(connection, amm.pool!.poolWxmr).catch(() => null),
        ]);

        setPoolUsdcBalance(usdcAccount ? BigInt(usdcAccount.amount.toString()) : BigInt(0));
        setPoolWxmrBalance(wxmrAccount ? BigInt(wxmrAccount.amount.toString()) : BigInt(0));
      } catch (e) {
        console.error('Error fetching pool balances:', e);
      }
    };

    fetchPoolBalances();
  }, [isOpen, amm.pool, connection, txSignature]); // Refetch after swap

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setInputAmount('');
      setTxSignature(null);
      setAmmSimResult(null);
      setJupiterSimResult(null);
      setShowRoutes(false);
    }
  }, [isOpen]);

  // Parse input
  const parsedInput = useMemo(() => {
    const num = parseFloat(inputAmount);
    if (isNaN(num) || num <= 0) return BigInt(0);
    const decimals = isBuying ? 6 : 12; // USDC or XMR
    return BigInt(Math.floor(num * Math.pow(10, decimals)));
  }, [inputAmount, isBuying]);

  // Fetch Jupiter quote
  useEffect(() => {
    if (!isOpen) return;
    const fetchQuote = async () => {
      if (parsedInput <= BigInt(0)) {
        setJupiterQuote(null);
        return;
      }
      const taker = publicKey?.toBase58();
      const quote = isBuying
        ? await getBuyQuote(parsedInput, taker)
        : await getSellQuote(parsedInput, taker);
      setJupiterQuote(quote);
    };
    // Wait 800ms after user stops typing before fetching quote
    const debounce = setTimeout(fetchQuote, 800);
    return () => clearTimeout(debounce);
  }, [parsedInput, isBuying, getBuyQuote, getSellQuote, isOpen, publicKey]);

  // Simulate routes
  useEffect(() => {
    if (!isOpen) return;
    let isStale = false;

    const simulate = async () => {
      if (parsedInput <= BigInt(0) || !publicKey) {
        setAmmSimResult(null);
        setJupiterSimResult(null);
        return;
      }
      setIsSimulating(true);
      const [ammRes, jupRes] = await Promise.all([
        (async () => {
          if (!amm.pool) {
            return { success: false, outputAmount: BigInt(0), error: 'AMM not initialized' };
          }
          if (!amm.pool.enabled) {
            return { success: false, outputAmount: BigInt(0), error: 'AMM disabled' };
          }
          try {
            return isBuying
              ? await simulateBuy(parsedInput, publicKey)
              : await simulateSell(parsedInput, publicKey);
          } catch (e) {
            console.error('AMM simulation error:', e);
            return { success: false, outputAmount: BigInt(0), error: 'Simulation failed' };
          }
        })(),
        (async () => {
          if (!jupiterQuote) {
            return { success: false, outputAmount: BigInt(0), error: 'No route' };
          }
          return { success: true, outputAmount: BigInt(jupiterQuote.outAmount) };
        })(),
      ]);

      if (isStale) return;

      setAmmSimResult(ammRes);
      setJupiterSimResult(jupRes);
      setIsSimulating(false);

      // Auto-select best route
      if (ammRes.success && jupRes.success) {
        setSelectedRoute(ammRes.outputAmount >= jupRes.outputAmount ? 'amm' : 'jupiter');
      } else if (ammRes.success) {
        setSelectedRoute('amm');
      } else if (jupRes.success) {
        setSelectedRoute('jupiter');
      }
    };

    const debounce = setTimeout(simulate, 1000);
    return () => {
      clearTimeout(debounce);
      isStale = true;
    };
  }, [parsedInput, publicKey, isBuying, amm.pool, simulateBuy, simulateSell, jupiterQuote, isOpen]);

  // Instant previews (no simulation needed)
  const ammPreviewAmount = useMemo(() => {
    if (parsedInput <= BigInt(0) || !amm.pool) return BigInt(0);
    return isBuying ? calculateBuyOutput(parsedInput) : calculateSellOutput(parsedInput);
  }, [parsedInput, isBuying, amm.pool, calculateBuyOutput, calculateSellOutput]);

  const jupiterPreviewAmount = useMemo(() => {
    if (!jupiterQuote) return BigInt(0);
    return BigInt(jupiterQuote.outAmount);
  }, [jupiterQuote]);

  const ammOutputAmount = ammSimResult?.success ? ammSimResult.outputAmount : BigInt(0);
  const jupiterOutputAmount = jupiterSimResult?.success ? jupiterSimResult.outputAmount : BigInt(0);

  const ammAmount = ammOutputAmount > BigInt(0) ? ammOutputAmount : ammPreviewAmount;
  const jupiterAmount = jupiterOutputAmount > BigInt(0) ? jupiterOutputAmount : jupiterPreviewAmount;

  const ammIsBest = ammAmount > BigInt(0) && ammAmount >= jupiterAmount;
  const jupiterIsBest = jupiterAmount > BigInt(0) && jupiterAmount > ammAmount;

  // Auto-select best route when previews change
  useEffect(() => {
    if (ammSimResult || jupiterSimResult) return;
    if (ammIsBest) {
      setSelectedRoute('amm');
    } else if (jupiterIsBest) {
      setSelectedRoute('jupiter');
    }
  }, [ammIsBest, jupiterIsBest, ammSimResult, jupiterSimResult]);

  const outputAmount = useMemo(() => {
    if (selectedRoute === 'amm') {
      return ammOutputAmount > BigInt(0) ? ammOutputAmount : ammPreviewAmount;
    }
    if (selectedRoute === 'jupiter') {
      return jupiterOutputAmount > BigInt(0) ? jupiterOutputAmount : jupiterPreviewAmount;
    }
    return BigInt(0);
  }, [selectedRoute, ammOutputAmount, jupiterOutputAmount, ammPreviewAmount, jupiterPreviewAmount]);

  const displayAmount = outputAmount;
  const isPreview = selectedRoute === 'amm'
    ? ammOutputAmount <= BigInt(0) && ammPreviewAmount > BigInt(0)
    : jupiterOutputAmount <= BigInt(0) && jupiterPreviewAmount > BigInt(0);

  const canSwap = connected && !isSwapping && (
    (selectedRoute === 'amm' && ammAmount > BigInt(0) && amm.pool?.enabled) ||
    (selectedRoute === 'jupiter' && jupiterSimResult?.success)
  );

  const flipDirection = () => {
    setIsBuying(!isBuying);
    setInputAmount('');
  };

  // Execute AMM swap
  const executeAmmSwap = async () => {
    if (!publicKey || !amm.poolPda || !amm.pool) throw new Error('Not ready');
    const providerWallet: AnchorProviderWallet = {
      publicKey,
      signTransaction: signTransaction ?? (async (tx) => tx),
      signAllTransactions: wallet.signAllTransactions ?? (async (txs) => txs),
    };
    const provider = new AnchorProvider(connection, providerWallet, { commitment: 'confirmed' });
    const program = new Program<WxmrBridge>(IDL as WxmrBridge, provider);
    const userWxmr = await getAssociatedTokenAddress(XMR_MINT, publicKey);
    const userUsdc = await getAssociatedTokenAddress(USDC_MINT, publicKey);
    const outputAtaMint = isBuying ? XMR_MINT : USDC_MINT;
    const outputAta = isBuying ? userWxmr : userUsdc;
    const ensureOutputAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      publicKey,
      outputAta,
      publicKey,
      outputAtaMint,
      TOKEN_PROGRAM_ID
    );

    const tx = isBuying
      ? await program.methods.buyWxmr(new BN(parsedInput.toString())).accountsPartial({
          pool: amm.poolPda, user: publicKey, userWxmr, userUsdc,
          poolWxmr: amm.pool.poolWxmr, poolUsdc: amm.pool.poolUsdc, tokenProgram: TOKEN_PROGRAM_ID,
        }).preInstructions([ensureOutputAtaIx]).transaction()
      : await program.methods.sellWxmr(new BN(parsedInput.toString())).accountsPartial({
          pool: amm.poolPda, user: publicKey, userWxmr, userUsdc,
          poolWxmr: amm.pool.poolWxmr, poolUsdc: amm.pool.poolUsdc, tokenProgram: TOKEN_PROGRAM_ID,
        }).preInstructions([ensureOutputAtaIx]).transaction();

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const sig = await sendTransaction(tx, connection);

    try {
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    } catch (confirmErr) {
      console.warn('Confirmation timed out, checking tx status...', confirmErr);
      const status = await connection.getSignatureStatus(sig);
      if (!status?.value?.confirmationStatus) {
        throw confirmErr;
      }
    }
    return sig;
  };

  // Execute Jupiter swap via Ultra API
  const executeJupiterSwap = async () => {
    if (!publicKey || !signTransaction || !jupiterQuote) throw new Error('Not ready');
    const swapData = await jupiter.getSwapTransaction(jupiterQuote, publicKey.toBase58());
    if (!swapData) throw new Error('Failed to build tx');

    const binaryStr = atob(swapData.swapTransaction);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const tx = VersionedTransaction.deserialize(bytes);

    const signed = await signTransaction(tx);

    const serialized = signed.serialize();
    let binary = '';
    for (let i = 0; i < serialized.length; i++) {
      binary += String.fromCharCode(serialized[i]);
    }
    const signedBase64 = btoa(binary);

    const result = await jupiter.executeSwap(signedBase64, swapData.requestId);
    if (result.status !== 'Success') {
      throw new Error(result.error || 'Jupiter swap execution failed');
    }
    return result.signature!;
  };

  const handleSwap = async () => {
    setIsSwapping(true);
    setTxSignature(null);
    try {
      const sig = selectedRoute === 'amm' ? await executeAmmSwap() : await executeJupiterSwap();
      setTxSignature(sig);
      setInputAmount('');
    } catch (e) {
      const msg = e instanceof Error ? e.message.toLowerCase() : '';
      if (!msg.includes('reject') && !msg.includes('cancel') && !msg.includes('denied')) {
        console.error('Swap failed:', e);
      }
    } finally {
      setIsSwapping(false);
    }
  };

  const formatAmount = (amount: bigint, decimals: number) => {
    const num = Number(amount) / Math.pow(10, decimals);
    return num.toLocaleString('en-US', { maximumFractionDigits: decimals === 6 ? 2 : 6 });
  };

  const handleMax = () => {
    const userBalance = isBuying ? userUsdcBalance : userWxmrBalance;
    const decimals = isBuying ? 6 : 12;

    let maxPoolCanHandle = userBalance;
    if (amm.pool) {
      if (isBuying) {
        const buyPrice = amm.pool.buyPrice;
        if (buyPrice > BigInt(0)) {
          maxPoolCanHandle = (poolWxmrBalance * buyPrice) / BigInt('1000000000000');
        }
      } else {
        const sellPrice = amm.pool.sellPrice;
        if (sellPrice > BigInt(0)) {
          maxPoolCanHandle = (poolUsdcBalance * BigInt('1000000000000')) / sellPrice;
        }
      }
    }

    const finalAmount = userBalance < maxPoolCanHandle ? userBalance : maxPoolCanHandle;
    const formatted = (Number(finalAmount) / Math.pow(10, decimals)).toString();
    setInputAmount(formatted);
  };

  const exceedsPoolLiquidity = useMemo(() => {
    if (parsedInput <= BigInt(0)) return false;
    if (isBuying) {
      const expectedOutput = calculateBuyOutput(parsedInput);
      return expectedOutput > poolWxmrBalance;
    } else {
      const expectedOutput = calculateSellOutput(parsedInput);
      return expectedOutput > poolUsdcBalance;
    }
  }, [parsedInput, isBuying, poolWxmrBalance, poolUsdcBalance, calculateBuyOutput, calculateSellOutput]);

  const exceedsUserBalance = useMemo(() => {
    if (parsedInput <= BigInt(0)) return false;
    const balance = isBuying ? userUsdcBalance : userWxmrBalance;
    return parsedInput > balance;
  }, [parsedInput, isBuying, userUsdcBalance, userWxmrBalance]);

  if (!isOpen) return null;

  const inputToken = isBuying ? { symbol: 'USDC', icon: UsdcIcon, decimals: 6 } : { symbol: 'XMR', icon: XmrIcon, decimals: 12 };
  const outputToken = isBuying ? { symbol: 'XMR', icon: XmrIcon, decimals: 12 } : { symbol: 'USDC', icon: UsdcIcon, decimals: 6 };
  const userInputBalance = isBuying ? userUsdcBalance : userWxmrBalance;

  const routeBadge = (best: boolean) =>
    best ? <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'var(--color-success-wash)', color: 'var(--color-success)' }}>Best</span> : null;

  const RouteRow = ({ source }: { source: RouteSource }) => {
    const amount = source === 'amm' ? ammAmount : jupiterAmount;
    const simmed = source === 'amm' ? ammOutputAmount > BigInt(0) : jupiterOutputAmount > BigInt(0);
    const best = source === 'amm' ? ammIsBest : jupiterIsBest;
    const otherExists = source === 'amm' ? jupiterAmount > BigInt(0) : ammAmount > BigInt(0);
    return (
      <button
        onClick={() => { setSelectedRoute(source); setShowRoutes(false); }}
        className={`w-full flex items-center justify-between p-3 rounded-field transition-colors border ${
          selectedRoute === source ? 'border-accent bg-accent-wash' : 'border-line bg-surface hover:bg-inset'
        }`}
      >
        <div className="flex items-center gap-2">
          <div className="text-left">
            <p className="text-[13px] font-semibold text-ink">{source === 'amm' ? 'XMR AMM' : 'Jupiter'}</p>
            <p className="text-[11.5px] text-ink-3">{simmed ? (source === 'amm' ? 'Direct swap' : 'DEX aggregator') : '~estimate'}</p>
          </div>
          {otherExists && routeBadge(best)}
        </div>
        <span className="text-[13px] font-mono tnum text-ink">{formatAmount(amount, outputToken.decimals)}</span>
      </button>
    );
  };

  return (
    <Modal title="Swap" onClose={onClose} maxWidth={420}>
      <div className="px-4 pb-4 pt-4 space-y-2">
        {/* You pay */}
        <div className={`field-input p-4 ${exceedsUserBalance ? 'border-[var(--color-danger)]' : ''}`}>
          <div className="flex justify-between items-center mb-2">
            <span className="text-[12px] font-semibold text-ink-2">You pay</span>
            {connected && (
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-ink-3">
                  Balance <span className={`tnum ${exceedsUserBalance ? 'text-[var(--color-danger)]' : 'text-ink-2'}`}>{formatAmount(userInputBalance, inputToken.decimals)}</span>
                </span>
                <button onClick={handleMax} className="text-[12px] font-semibold text-accent-ink hover:underline">MAX</button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={inputAmount}
              onChange={(e) => setInputAmount(e.target.value)}
              placeholder="0"
              className="flex-1 bg-transparent text-[26px] font-semibold tnum text-ink outline-none placeholder-ink-3 min-w-0"
            />
            <span className="flex items-center gap-2 bg-sunken px-3 py-2 rounded-pill flex-shrink-0">
              <inputToken.icon className="w-5 h-5" />
              <span className="font-semibold text-[13px] text-ink">{inputToken.symbol}</span>
            </span>
          </div>
          {exceedsUserBalance && <p className="text-[12px] text-[var(--color-danger)] mt-2">Insufficient {inputToken.symbol} balance</p>}
        </div>

        {/* Flip */}
        <div className="flex justify-center -my-2 relative z-10">
          <button onClick={flipDirection} className="bg-surface border border-line p-2 rounded-[10px] text-ink-3 hover:text-ink hover:border-line-2 transition-all">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>
          </button>
        </div>

        {/* You receive */}
        <div className="field-input p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[12px] font-semibold text-ink-2">You receive</span>
            {isSimulating && <span className="text-[11.5px] text-ink-3">Finding best rate…</span>}
            {isPreview && !isSimulating && <span className="text-[11.5px] text-ink-3">~estimate</span>}
          </div>
          <div className="flex items-center gap-3">
            <span className={`flex-1 text-[26px] font-semibold tnum ${isPreview ? 'text-ink-3' : 'text-ink'}`}>
              {displayAmount > BigInt(0) ? formatAmount(displayAmount, outputToken.decimals) : '0'}
            </span>
            <span className="flex items-center gap-2 bg-sunken px-3 py-2 rounded-pill flex-shrink-0">
              <outputToken.icon className="w-5 h-5" />
              <span className="font-semibold text-[13px] text-ink">{outputToken.symbol}</span>
            </span>
          </div>
        </div>

        {/* Route info */}
        {parsedInput > BigInt(0) && (ammAmount > BigInt(0) || jupiterAmount > BigInt(0)) && (
          <button onClick={() => setShowRoutes(!showRoutes)} className="w-full flex items-center justify-between px-4 py-3 rounded-field border border-line hover:bg-inset transition-colors">
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-ink-3">via <span className="text-ink font-medium">{selectedRoute === 'amm' ? 'XMR AMM' : 'Jupiter'}</span></span>
              {ammAmount > BigInt(0) && jupiterAmount > BigInt(0) && ((selectedRoute === 'amm' && ammIsBest) || (selectedRoute === 'jupiter' && jupiterIsBest)) && routeBadge(true)}
            </div>
            <svg className={`w-4 h-4 text-ink-3 transition-transform ${showRoutes ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 9l-7 7-7-7" /></svg>
          </button>
        )}

        {/* Route list */}
        {showRoutes && (
          <div className="space-y-2 p-2 rounded-field bg-inset border border-line">
            {ammIsBest && ammAmount > BigInt(0) && <RouteRow source="amm" />}
            {jupiterIsBest && jupiterAmount > BigInt(0) && <RouteRow source="jupiter" />}
            {!ammIsBest && ammAmount > BigInt(0) && <RouteRow source="amm" />}
            {!jupiterIsBest && jupiterAmount > BigInt(0) && <RouteRow source="jupiter" />}
          </div>
        )}

        {/* Pool liquidity */}
        {amm.pool && (
          <div className="flex justify-between text-[11.5px] text-ink-3 px-1 pt-1">
            <span>Pool {formatAmount(poolWxmrBalance, 12)} XMR</span>
            <span>{formatAmount(poolUsdcBalance, 6)} USDC</span>
          </div>
        )}

        {/* Swap button */}
        <button
          onClick={handleSwap}
          disabled={!canSwap || exceedsUserBalance || (exceedsPoolLiquidity && selectedRoute === 'amm')}
          className="btn-primary w-full py-3.5 mt-1 text-[14.5px] font-semibold"
        >
          {!connected
            ? 'Connect wallet'
            : isSwapping
              ? 'Swapping…'
              : parsedInput <= BigInt(0)
                ? 'Enter an amount'
                : exceedsUserBalance
                  ? `Insufficient ${inputToken.symbol}`
                  : exceedsPoolLiquidity && selectedRoute === 'amm'
                    ? 'Exceeds pool liquidity'
                    : selectedRoute === 'jupiter' && !jupiterSimResult?.success && jupiterAmount > BigInt(0)
                      ? 'Verifying route…'
                      : displayAmount <= BigInt(0)
                        ? 'No route available'
                        : 'Swap'}
        </button>

        {/* Success */}
        {txSignature && (
          <div className="rise p-3.5 rounded-field text-center" style={{ background: 'var(--color-success-wash)' }}>
            <p className="font-semibold text-[13.5px] mb-0.5" style={{ color: 'var(--color-success)' }}>Swap successful</p>
            <a href={`https://solscan.io/tx/${txSignature}`} target="_blank" rel="noopener noreferrer" className="text-[12.5px] text-accent-ink hover:underline">View on Solscan →</a>
          </div>
        )}

        {/* AMM error (Jupiter failing is expected/quiet) */}
        {parsedInput > BigInt(0) && ammAmount <= BigInt(0) && jupiterAmount <= BigInt(0) && !isSimulating && ammSimResult?.error && ammSimResult.error !== 'AMM not initialized' && (
          <div className="p-3 rounded-field text-[12px]" style={{ background: 'var(--color-warn-wash)', color: 'var(--color-warn)' }}>
            AMM unavailable: {ammSimResult.error}
          </div>
        )}
      </div>
    </Modal>
  );
}

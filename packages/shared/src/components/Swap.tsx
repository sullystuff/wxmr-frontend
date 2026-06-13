'use client';

import { useState, useEffect, useMemo } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  getAccount,
} from '@solana/spl-token';
import { useJupiterQuote, JupiterQuote } from '../hooks/useJupiterQuote';
import { XMR_MINT, USDC_MINT } from '../constants';
import { UsdcIcon, XmrIcon } from './icons';

interface SwapPanelProps {
  /** When provided, a close button is rendered in the header (used by the modal wrapper). */
  onClose?: () => void;
}

/**
 * Core swap UI + logic. Renders a self-contained swap card and can be used either
 * standalone (full page) or inside the SwapModal wrapper.
 */
export function SwapPanel({ onClose }: SwapPanelProps) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { connected, publicKey, signTransaction } = wallet;

  const jupiter = useJupiterQuote();

  // Extract stable function references to prevent effect loops
  const { getBuyQuote, getSellQuote } = jupiter;

  // Swap direction: true = USDC -> XMR, false = XMR -> USDC
  const [isBuying, setIsBuying] = useState(true);
  const [inputAmount, setInputAmount] = useState('');
  const [jupiterQuote, setJupiterQuote] = useState<JupiterQuote | null>(null);
  const [isQuotePending, setIsQuotePending] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);

  // User balances
  const [userUsdcBalance, setUserUsdcBalance] = useState<bigint>(BigInt(0));
  const [userWxmrBalance, setUserWxmrBalance] = useState<bigint>(BigInt(0));

  // Fetch user balances
  useEffect(() => {
    if (!publicKey) {
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
  }, [publicKey, connection, txSignature]); // Refetch after swap

  // Parse input
  const parsedInput = useMemo(() => {
    const num = parseFloat(inputAmount);
    if (isNaN(num) || num <= 0) return BigInt(0);
    const decimals = isBuying ? 6 : 12; // USDC or XMR
    return BigInt(Math.floor(num * Math.pow(10, decimals)));
  }, [inputAmount, isBuying]);

  // Fetch Jupiter quote
  useEffect(() => {
    let isStale = false;

    if (parsedInput <= BigInt(0)) {
      setJupiterQuote(null);
      setIsQuotePending(false);
      return;
    }

    setJupiterQuote(null);
    setIsQuotePending(true);

    const fetchQuote = async () => {
      const taker = publicKey?.toBase58();
      const quote = isBuying
        ? await getBuyQuote(parsedInput, taker)
        : await getSellQuote(parsedInput, taker);
      if (isStale) return;
      setJupiterQuote(quote);
      setIsQuotePending(false);
    };
    // Wait 800ms after user stops typing before fetching quote
    const debounce = setTimeout(fetchQuote, 800);
    return () => {
      isStale = true;
      clearTimeout(debounce);
    };
  }, [parsedInput, isBuying, getBuyQuote, getSellQuote, publicKey]);

  const jupiterPreviewAmount = useMemo(() => {
    if (!jupiterQuote) return BigInt(0);
    return BigInt(jupiterQuote.outAmount);
  }, [jupiterQuote]);

  const jupiterAmount = jupiterPreviewAmount;

  // Display amount and whether it's a preview
  const displayAmount = jupiterAmount;
  const isPreview = jupiterAmount > BigInt(0);
  const isFindingRoute = parsedInput > BigInt(0) && (isQuotePending || jupiter.loading);

  // AMM routes are disabled because the IDL no longer exposes AMM instructions.
  const canSwap = connected && Boolean(signTransaction) && !isSwapping && jupiterAmount > BigInt(0);

  // Flip direction
  const flipDirection = () => {
    setIsBuying(!isBuying);
    setInputAmount('');
    setJupiterQuote(null);
  };

  // Execute Jupiter swap via Ultra API
  const executeJupiterSwap = async () => {
    if (!publicKey || !signTransaction || !jupiterQuote) throw new Error('Not ready');
    const swapData = await jupiter.getSwapTransaction(jupiterQuote, publicKey.toBase58());
    if (!swapData) throw new Error('Failed to build tx');

    // Decode base64 transaction using browser-native atob (no Buffer needed)
    const binaryStr = atob(swapData.swapTransaction);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const tx = VersionedTransaction.deserialize(bytes);

    // Sign with wallet
    const signed = await signTransaction(tx);

    // Re-encode signed transaction to base64 for Jupiter's /execute endpoint
    const serialized = signed.serialize();
    let binary = '';
    for (let i = 0; i < serialized.length; i++) {
      binary += String.fromCharCode(serialized[i]);
    }
    const signedBase64 = btoa(binary);

    // Submit to Jupiter Ultra's /execute endpoint (they handle broadcasting)
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
      const sig = await executeJupiterSwap();
      setTxSignature(sig);
      setInputAmount('');
      setJupiterQuote(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message.toLowerCase() : '';
      // Silently ignore user rejections
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

  // Handle max button
  const handleMax = () => {
    const userBalance = isBuying ? userUsdcBalance : userWxmrBalance;
    const decimals = isBuying ? 6 : 12;
    const formatted = (Number(userBalance) / Math.pow(10, decimals)).toString();
    setInputAmount(formatted);
  };

  // Check if amount exceeds user balance
  const exceedsUserBalance = useMemo(() => {
    if (parsedInput <= BigInt(0)) return false;
    const balance = isBuying ? userUsdcBalance : userWxmrBalance;
    return parsedInput > balance;
  }, [parsedInput, isBuying, userUsdcBalance, userWxmrBalance]);

  const inputToken = isBuying ? { symbol: 'USDC', icon: UsdcIcon, decimals: 6 } : { symbol: 'XMR', icon: XmrIcon, decimals: 12 };
  const outputToken = isBuying ? { symbol: 'XMR', icon: XmrIcon, decimals: 12 } : { symbol: 'USDC', icon: UsdcIcon, decimals: 6 };
  const userInputBalance = isBuying ? userUsdcBalance : userWxmrBalance;

  return (
    <div className="bg-[#1a1a2e] border border-[#2a2a4a] rounded-3xl w-full max-w-[420px] shadow-2xl">
      {/* Header */}
      <div className="flex justify-between items-center px-5 py-4">
        <h2 className="text-lg font-semibold text-white">Swap</h2>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <div className="px-4 pb-4 space-y-2">
        {/* You Pay */}
        <div className={`bg-[#12121f] rounded-2xl p-4 ${exceedsUserBalance ? 'border border-red-500/50' : ''}`}>
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-gray-400">You pay</span>
            {connected && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">
                  Balance: <span className={exceedsUserBalance ? 'text-red-400' : 'text-gray-300'}>{formatAmount(userInputBalance, inputToken.decimals)}</span>
                </span>
                <button
                  onClick={handleMax}
                  className="text-xs text-[#ff6600] hover:text-[#ff8533] font-semibold"
                >
                  MAX
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={inputAmount}
              onChange={(e) => setInputAmount(e.target.value)}
              placeholder="0"
              className="flex-1 bg-transparent text-3xl font-medium text-white focus:outline-none placeholder-gray-600"
            />
            <div className="flex items-center gap-2 bg-[#2a2a4a] px-3 py-2 rounded-xl cursor-default">
              <inputToken.icon className="w-6 h-6" />
              <span className="font-semibold text-white">{inputToken.symbol}</span>
            </div>
          </div>
          {exceedsUserBalance && (
            <p className="text-xs text-red-400 mt-2">Insufficient {inputToken.symbol} balance</p>
          )}
        </div>

        {/* Swap Direction Button */}
        <div className="flex justify-center -my-1 relative z-10">
          <button
            onClick={flipDirection}
            className="bg-[#2a2a4a] hover:bg-[#3a3a5a] border-4 border-[#1a1a2e] p-2 rounded-xl transition-all hover:rotate-180 duration-300"
          >
            <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </button>
        </div>

        {/* You Receive */}
        <div className="bg-[#12121f] rounded-2xl p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-gray-400">You receive</span>
            {isFindingRoute && <span className="text-xs text-gray-500">Finding route...</span>}
            {isPreview && !isFindingRoute && <span className="text-xs text-gray-500">~estimate</span>}
          </div>
          <div className="flex items-center gap-3">
            <span className={`flex-1 text-3xl font-medium ${isPreview ? 'text-gray-400' : 'text-white'}`}>
              {displayAmount > BigInt(0) ? formatAmount(displayAmount, outputToken.decimals) : '0'}
            </span>
            <div className="flex items-center gap-2 bg-[#2a2a4a] px-3 py-2 rounded-xl cursor-default">
              <outputToken.icon className="w-6 h-6" />
              <span className="font-semibold text-white">{outputToken.symbol}</span>
            </div>
          </div>
        </div>

        {/* AMM route selection is disabled because AMM instructions were removed from the IDL. */}
        {parsedInput > BigInt(0) && jupiterAmount > BigInt(0) && (
          <div className="w-full flex items-center justify-between px-4 py-3 bg-[#12121f] rounded-xl">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
              <span className="text-sm text-gray-400">
                via <span className="text-white">Jupiter</span>
              </span>
            </div>
            <span className="text-sm font-mono text-white">
              {formatAmount(jupiterAmount, outputToken.decimals)}
            </span>
          </div>
        )}

        {/* Swap Button */}
        <button
          onClick={handleSwap}
          disabled={!canSwap || exceedsUserBalance}
          className={`w-full py-4 rounded-2xl font-semibold text-lg transition-all ${
            canSwap && !exceedsUserBalance
              ? 'bg-gradient-to-r from-[#ff6600] to-[#ff8533] text-white hover:opacity-90'
              : 'bg-[#2a2a4a] text-gray-500 cursor-not-allowed'
          }`}
        >
          {!connected
            ? 'Connect Wallet'
            : isSwapping
              ? 'Swapping...'
              : parsedInput <= BigInt(0)
                ? 'Enter amount'
                : exceedsUserBalance
                  ? `Insufficient ${inputToken.symbol}`
                  : isFindingRoute || jupiter.loading
                    ? 'Finding route...'
                    : displayAmount <= BigInt(0)
                      ? 'No route available'
                      : 'Swap'}
        </button>

        {/* Success */}
        {txSignature && (
          <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-xl text-center">
            <p className="text-green-400 font-semibold mb-1">Swap successful!</p>
            <a
              href={`https://solscan.io/tx/${txSignature}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[#ff6600] hover:underline"
            >
              View on Solscan →
            </a>
          </div>
        )}

        {parsedInput > BigInt(0) && jupiter.error && displayAmount <= BigInt(0) && (
          <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl text-xs text-yellow-400">
            <p className="font-semibold mb-1">Route unavailable:</p>
            <p className="text-yellow-400/80">{jupiter.error}</p>
          </div>
        )}
      </div>
    </div>
  );
}

interface SwapModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Modal wrapper around SwapPanel: dims the background and closes on overlay click or Escape. */
export function SwapModal({ isOpen, onClose }: SwapModalProps) {
  // Escape to close
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleEscape);
      return () => window.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div className="w-full max-w-[420px]" onClick={(e) => e.stopPropagation()}>
        <SwapPanel onClose={onClose} />
      </div>
    </div>
  );
}

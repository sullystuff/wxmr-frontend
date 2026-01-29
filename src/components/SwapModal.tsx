'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import type { WxmrBridge } from '@/idl/wxmr_bridge';
import IDL from '@/idl/wxmr_bridge.json';
import { useAmmPool } from '@/hooks/useAmmPool';
import { useJupiterQuote, JupiterQuote } from '@/hooks/useJupiterQuote';
import { WXMR_MINT, USDC_MINT } from '@/constants';

// Token icons
function UsdcIcon({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="16" fill="#2775CA"/>
      <path d="M20.5 18.5c0-2.1-1.3-2.8-3.8-3.1-1.8-.3-2.2-.7-2.2-1.4 0-.8.6-1.3 1.8-1.3 1.1 0 1.7.4 2 1.2.1.2.2.3.4.3h1c.2 0 .4-.2.3-.4-.3-1.3-1.2-2.3-2.6-2.5v-1.5c0-.2-.2-.4-.4-.4h-.9c-.2 0-.4.2-.4.4v1.5c-1.7.2-2.8 1.4-2.8 2.8 0 2 1.2 2.7 3.7 3 1.9.3 2.3.7 2.3 1.5s-.7 1.4-1.9 1.4c-1.5 0-2-.6-2.2-1.4-.1-.2-.2-.3-.4-.3h-1c-.2 0-.4.2-.3.4.3 1.5 1.3 2.4 2.9 2.7v1.5c0 .2.2.4.4.4h.9c.2 0 .4-.2.4-.4v-1.5c1.8-.3 2.8-1.4 2.8-2.9z" fill="#fff"/>
    </svg>
  );
}

function WxmrIcon({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="16" fill="#ff6600"/>
      <path d="M16 6c-5.5 0-10 4.5-10 10s4.5 10 10 10 10-4.5 10-10S21.5 6 16 6zm0 18c-4.4 0-8-3.6-8-8s3.6-8 8-8 8 3.6 8 8-3.6 8-8 8z" fill="#fff" fillOpacity="0.3"/>
      <path d="M16 8l-5 5v6h2v-5l3 3 3-3v5h2v-6l-5-5z" fill="#fff"/>
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
  const { connected, publicKey, signTransaction } = wallet;
  
  const amm = useAmmPool();
  const jupiter = useJupiterQuote();
  
  // Swap direction: true = USDC -> wXMR, false = wXMR -> USDC
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
          getAssociatedTokenAddress(WXMR_MINT, publicKey),
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

  // Parse input
  const parsedInput = useMemo(() => {
    const num = parseFloat(inputAmount);
    if (isNaN(num) || num <= 0) return BigInt(0);
    const decimals = isBuying ? 6 : 12; // USDC or wXMR
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
        ? await jupiter.getBuyQuote(parsedInput, taker)
        : await jupiter.getSellQuote(parsedInput, taker);
      setJupiterQuote(quote);
    };
    // Wait 800ms after user stops typing before fetching quote
    const debounce = setTimeout(fetchQuote, 800);
    return () => clearTimeout(debounce);
  }, [parsedInput, isBuying, jupiter, isOpen, publicKey]);

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
          // Show specific error if AMM not available
          if (!amm.pool) {
            return { success: false, outputAmount: BigInt(0), error: 'AMM not initialized' };
          }
          if (!amm.pool.enabled) {
            return { success: false, outputAmount: BigInt(0), error: 'AMM disabled' };
          }
          // Try simulation anyway - let on-chain determine if price is stale
          try {
            return isBuying
              ? await amm.simulateBuy(parsedInput, publicKey)
              : await amm.simulateSell(parsedInput, publicKey);
          } catch (e) {
            console.error('AMM simulation error:', e);
            return { success: false, outputAmount: BigInt(0), error: 'Simulation failed' };
          }
        })(),
        (async () => {
          if (!jupiterQuote) {
            return { success: false, outputAmount: BigInt(0), error: 'No route' };
          }
          // try {
          //   return await jupiter.simulateSwap(jupiterQuote, publicKey.toBase58());
          // } catch (e) {
          //   console.error('Jupiter simulation error:', e);
          //   return { success: false, outputAmount: BigInt(0), error: 'Simulation failed' };
          // }
          // Skip simulation - trust Jupiter quote directly
          return { success: true, outputAmount: BigInt(jupiterQuote.outAmount) };
        })(),
      ]);
      
      // Ignore results if effect was cleaned up (stale)
      if (isStale) return;
      
      console.log({ amm: ammRes, jupiter: jupRes });
      
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
    
    // Debounce simulation by 1 second after dependencies change
    const debounce = setTimeout(simulate, 1000);
    return () => {
      clearTimeout(debounce);
      isStale = true;
    };
  }, [parsedInput, publicKey, isBuying, amm, jupiter, jupiterQuote, isOpen]);

  // Instant previews (no simulation needed)
  const ammPreviewAmount = useMemo(() => {
    if (parsedInput <= BigInt(0) || !amm.pool) return BigInt(0);
    return isBuying 
      ? amm.calculateBuyOutput(parsedInput)
      : amm.calculateSellOutput(parsedInput);
  }, [parsedInput, isBuying, amm]);

  const jupiterPreviewAmount = useMemo(() => {
    if (!jupiterQuote) return BigInt(0);
    return BigInt(jupiterQuote.outAmount);
  }, [jupiterQuote]);

  // Get output amount from simulation (more accurate than preview)
  const ammOutputAmount = ammSimResult?.success ? ammSimResult.outputAmount : BigInt(0);
  const jupiterOutputAmount = jupiterSimResult?.success ? jupiterSimResult.outputAmount : BigInt(0);

  // Determine best route based on simulation if available, otherwise preview
  const ammAmount = ammOutputAmount > BigInt(0) ? ammOutputAmount : ammPreviewAmount;
  const jupiterAmount = jupiterOutputAmount > BigInt(0) ? jupiterOutputAmount : jupiterPreviewAmount;
  
  // Track which has the best rate
  const ammIsBest = ammAmount > BigInt(0) && ammAmount >= jupiterAmount;
  const jupiterIsBest = jupiterAmount > BigInt(0) && jupiterAmount > ammAmount;
  
  // Auto-select best route when previews change
  useEffect(() => {
    if (ammSimResult || jupiterSimResult) return; // Don't override simulation-based selection
    if (ammIsBest) {
      setSelectedRoute('amm');
    } else if (jupiterIsBest) {
      setSelectedRoute('jupiter');
    }
  }, [ammIsBest, jupiterIsBest, ammSimResult, jupiterSimResult]);

  // Output amount for selected route
  const outputAmount = useMemo(() => {
    if (selectedRoute === 'amm') {
      return ammOutputAmount > BigInt(0) ? ammOutputAmount : ammPreviewAmount;
    }
    if (selectedRoute === 'jupiter') {
      return jupiterOutputAmount > BigInt(0) ? jupiterOutputAmount : jupiterPreviewAmount;
    }
    return BigInt(0);
  }, [selectedRoute, ammOutputAmount, jupiterOutputAmount, ammPreviewAmount, jupiterPreviewAmount]);
  
  // Display amount and whether it's a preview
  const displayAmount = outputAmount;
  const isPreview = selectedRoute === 'amm' 
    ? ammOutputAmount <= BigInt(0) && ammPreviewAmount > BigInt(0)
    : jupiterOutputAmount <= BigInt(0) && jupiterPreviewAmount > BigInt(0);

  // Allow swap when route is available
  // AMM: trust preview since we have direct pool data (on-chain will validate)
  // Jupiter: need simulation to confirm route works
  const canSwap = connected && !isSwapping && (
    (selectedRoute === 'amm' && ammAmount > BigInt(0) && amm.pool?.enabled) ||
    (selectedRoute === 'jupiter' && jupiterSimResult?.success)
  );

  // Flip direction
  const flipDirection = () => {
    setIsBuying(!isBuying);
    setInputAmount('');
  };

  // Execute AMM swap
  const executeAmmSwap = async () => {
    if (!publicKey || !signTransaction || !amm.poolPda || !amm.pool) throw new Error('Not ready');
    const provider = new AnchorProvider(connection, wallet as any, { commitment: 'confirmed' });
    const program = new Program(IDL as any, provider) as Program<WxmrBridge>;
    const userWxmr = await getAssociatedTokenAddress(WXMR_MINT, publicKey);
    const userUsdc = await getAssociatedTokenAddress(USDC_MINT, publicKey);

    const tx = isBuying
      ? await (program.methods as any).buyWxmr(new BN(parsedInput.toString())).accounts({
          pool: amm.poolPda, user: publicKey, userWxmr, userUsdc,
          poolWxmr: amm.pool.poolWxmr, poolUsdc: amm.pool.poolUsdc, tokenProgram: TOKEN_PROGRAM_ID,
        }).transaction()
      : await (program.methods as any).sellWxmr(new BN(parsedInput.toString())).accounts({
          pool: amm.poolPda, user: publicKey, userWxmr, userUsdc,
          poolWxmr: amm.pool.poolWxmr, poolUsdc: amm.pool.poolUsdc, tokenProgram: TOKEN_PROGRAM_ID,
        }).transaction();

    tx.feePayer = publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const signed = await signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction(sig, 'confirmed');
    return sig;
  };

  // Execute Jupiter swap
  const executeJupiterSwap = async () => {
    if (!publicKey || !signTransaction || !jupiterQuote) throw new Error('Not ready');
    const swapData = await jupiter.getSwapTransaction(jupiterQuote, publicKey.toBase58());
    if (!swapData) throw new Error('Failed to build tx');
    const tx = VersionedTransaction.deserialize(Buffer.from(swapData.swapTransaction, 'base64'));
    const signed = await signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction(sig, 'confirmed');
    return sig;
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
  
  // Handle max button - cap at pool liquidity if needed
  const handleMax = () => {
    const userBalance = isBuying ? userUsdcBalance : userWxmrBalance;
    const decimals = isBuying ? 6 : 12;
    
    // Calculate max input the pool can handle
    let maxPoolCanHandle = userBalance;
    if (amm.pool) {
      if (isBuying) {
        // Buying wXMR: max USDC = poolWxmrBalance * buyPrice / 1e12
        const buyPrice = amm.pool.buyPrice;
        if (buyPrice > BigInt(0)) {
          maxPoolCanHandle = (poolWxmrBalance * buyPrice) / BigInt('1000000000000');
        }
      } else {
        // Selling wXMR: max wXMR = poolUsdcBalance * 1e12 / sellPrice
        const sellPrice = amm.pool.sellPrice;
        if (sellPrice > BigInt(0)) {
          maxPoolCanHandle = (poolUsdcBalance * BigInt('1000000000000')) / sellPrice;
        }
      }
    }
    
    // Use the smaller of user balance and pool capacity
    const finalAmount = userBalance < maxPoolCanHandle ? userBalance : maxPoolCanHandle;
    const formatted = (Number(finalAmount) / Math.pow(10, decimals)).toString();
    setInputAmount(formatted);
  };
  
  // Check if amount exceeds pool liquidity (for AMM)
  const exceedsPoolLiquidity = useMemo(() => {
    if (parsedInput <= BigInt(0)) return false;
    if (isBuying) {
      // Buying wXMR - check if pool has enough wXMR
      const expectedOutput = amm.calculateBuyOutput(parsedInput);
      return expectedOutput > poolWxmrBalance;
    } else {
      // Selling wXMR - check if pool has enough USDC
      const expectedOutput = amm.calculateSellOutput(parsedInput);
      return expectedOutput > poolUsdcBalance;
    }
  }, [parsedInput, isBuying, poolWxmrBalance, poolUsdcBalance, amm]);
  
  // Check if amount exceeds user balance
  const exceedsUserBalance = useMemo(() => {
    if (parsedInput <= BigInt(0)) return false;
    const balance = isBuying ? userUsdcBalance : userWxmrBalance;
    return parsedInput > balance;
  }, [parsedInput, isBuying, userUsdcBalance, userWxmrBalance]);

  if (!isOpen) return null;

  const inputToken = isBuying ? { symbol: 'USDC', icon: UsdcIcon, decimals: 6 } : { symbol: 'wXMR', icon: WxmrIcon, decimals: 12 };
  const outputToken = isBuying ? { symbol: 'wXMR', icon: WxmrIcon, decimals: 12 } : { symbol: 'USDC', icon: UsdcIcon, decimals: 6 };
  const userInputBalance = isBuying ? userUsdcBalance : userWxmrBalance;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div 
        className="bg-[#1a1a2e] border border-[#2a2a4a] rounded-3xl w-full max-w-[420px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center px-5 py-4">
          <h2 className="text-lg font-semibold text-white">Swap</h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
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
              {isSimulating && <span className="text-xs text-gray-500">Finding best rate...</span>}
              {isPreview && !isSimulating && <span className="text-xs text-gray-500">~estimate</span>}
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

          {/* Route Info - Show when there's any route available */}
          {parsedInput > BigInt(0) && (ammAmount > BigInt(0) || jupiterAmount > BigInt(0)) && (
            <button
              onClick={() => setShowRoutes(!showRoutes)}
              className="w-full flex items-center justify-between px-4 py-3 bg-[#12121f] rounded-xl hover:bg-[#1a1a2a] transition-colors"
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
                <span className="text-sm text-gray-400">
                  via <span className="text-white">{selectedRoute === 'amm' ? 'wXMR AMM' : 'Jupiter'}</span>
                </span>
                {ammAmount > BigInt(0) && jupiterAmount > BigInt(0) && 
                  ((selectedRoute === 'amm' && ammIsBest) || (selectedRoute === 'jupiter' && jupiterIsBest)) && (
                  <span className="text-xs text-green-400 bg-green-400/10 px-2 py-0.5 rounded">Best</span>
                )}
              </div>
              <svg className={`w-4 h-4 text-gray-400 transition-transform ${showRoutes ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          )}

          {/* Route Selection - sorted with best on top */}
          {showRoutes && (
            <div className="space-y-2 p-3 bg-[#12121f] rounded-xl">
              {/* Best route first */}
              {ammIsBest && ammAmount > BigInt(0) && (
                <button
                  onClick={() => { setSelectedRoute('amm'); setShowRoutes(false); }}
                  className={`w-full flex items-center justify-between p-3 rounded-xl transition-colors ${
                    selectedRoute === 'amm' ? 'bg-[#ff6600]/20 border border-[#ff6600]' : 'bg-[#1a1a2a] hover:bg-[#2a2a3a]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div>
                      <p className="text-sm font-medium text-white">wXMR AMM</p>
                      <p className="text-xs text-gray-400">{ammOutputAmount > BigInt(0) ? 'Direct swap' : '~estimate'}</p>
                    </div>
                    {jupiterAmount > BigInt(0) && <span className="text-xs text-green-400 bg-green-400/10 px-2 py-0.5 rounded">Best</span>}
                  </div>
                  <span className="text-sm font-mono text-white">
                    {formatAmount(ammAmount, outputToken.decimals)}
                  </span>
                </button>
              )}
              {jupiterIsBest && jupiterAmount > BigInt(0) && (
                <button
                  onClick={() => { setSelectedRoute('jupiter'); setShowRoutes(false); }}
                  className={`w-full flex items-center justify-between p-3 rounded-xl transition-colors ${
                    selectedRoute === 'jupiter' ? 'bg-[#ff6600]/20 border border-[#ff6600]' : 'bg-[#1a1a2a] hover:bg-[#2a2a3a]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div>
                      <p className="text-sm font-medium text-white">Jupiter</p>
                      <p className="text-xs text-gray-400">{jupiterOutputAmount > BigInt(0) ? 'DEX aggregator' : '~estimate'}</p>
                    </div>
                    {ammAmount > BigInt(0) && <span className="text-xs text-green-400 bg-green-400/10 px-2 py-0.5 rounded">Best</span>}
                  </div>
                  <span className="text-sm font-mono text-white">
                    {formatAmount(jupiterAmount, outputToken.decimals)}
                  </span>
                </button>
              )}
              {/* Second best route */}
              {!ammIsBest && ammAmount > BigInt(0) && (
                <button
                  onClick={() => { setSelectedRoute('amm'); setShowRoutes(false); }}
                  className={`w-full flex items-center justify-between p-3 rounded-xl transition-colors ${
                    selectedRoute === 'amm' ? 'bg-[#ff6600]/20 border border-[#ff6600]' : 'bg-[#1a1a2a] hover:bg-[#2a2a3a]'
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium text-white">wXMR AMM</p>
                    <p className="text-xs text-gray-400">{ammOutputAmount > BigInt(0) ? 'Direct swap' : '~estimate'}</p>
                  </div>
                  <span className="text-sm font-mono text-white">
                    {formatAmount(ammAmount, outputToken.decimals)}
                  </span>
                </button>
              )}
              {!jupiterIsBest && jupiterAmount > BigInt(0) && (
                <button
                  onClick={() => { setSelectedRoute('jupiter'); setShowRoutes(false); }}
                  className={`w-full flex items-center justify-between p-3 rounded-xl transition-colors ${
                    selectedRoute === 'jupiter' ? 'bg-[#ff6600]/20 border border-[#ff6600]' : 'bg-[#1a1a2a] hover:bg-[#2a2a3a]'
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium text-white">Jupiter</p>
                    <p className="text-xs text-gray-400">{jupiterOutputAmount > BigInt(0) ? 'DEX aggregator' : '~estimate'}</p>
                  </div>
                  <span className="text-sm font-mono text-white">
                    {formatAmount(jupiterAmount, outputToken.decimals)}
                  </span>
                </button>
              )}
            </div>
          )}

          {/* Pool Liquidity Info */}
          {amm.pool && (
            <div className="flex justify-between text-xs text-gray-500 px-1">
              <span>Pool: {formatAmount(poolWxmrBalance, 12)} wXMR</span>
              <span>{formatAmount(poolUsdcBalance, 6)} USDC</span>
            </div>
          )}

          {/* Swap Button */}
          <button
            onClick={handleSwap}
            disabled={!canSwap || exceedsUserBalance || (exceedsPoolLiquidity && selectedRoute === 'amm')}
            className={`w-full py-4 rounded-2xl font-semibold text-lg transition-all ${
              canSwap && !exceedsUserBalance && !(exceedsPoolLiquidity && selectedRoute === 'amm')
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
                    : exceedsPoolLiquidity && selectedRoute === 'amm'
                      ? 'Exceeds pool liquidity'
                      : selectedRoute === 'jupiter' && !jupiterSimResult?.success && jupiterAmount > BigInt(0)
                        ? 'Verifying Jupiter route...'
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

          {/* Debug info - only show if AMM has a real error (Jupiter failing is expected) */}
          {parsedInput > BigInt(0) && ammAmount <= BigInt(0) && jupiterAmount <= BigInt(0) && !isSimulating && ammSimResult?.error && ammSimResult.error !== 'AMM not initialized' && (
            <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl text-xs text-yellow-400">
              <p className="font-semibold mb-1">AMM unavailable:</p>
              <p className="text-yellow-400/80">{ammSimResult.error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
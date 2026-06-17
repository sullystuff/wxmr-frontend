'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CHAINS,
  ERC20_ALLOWANCE_ABI,
  ERC20_APPROVE_ABI,
  MAYAN_SWIFT_EVM_SOURCE_CHAINS,
  MAYAN_SWIFT_SOURCE_CHAINS,
  XMR_DECIMALS,
  filterMayanTokensForChain,
  isValidMoneroAddress,
  type ExecutionPolicy,
  type FundingInstructions,
  type MayanEvmTxPayload,
  type MayanToken,
  type Order,
  type Quote,
  type SourceChainId,
  type SwapDirection,
} from '@wxmr/core';
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import {
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
  useSendTransaction,
  useSwitchChain,
  useWriteContract,
} from 'wagmi';
import { EVM_RPC_ENV_BY_CHAIN, EVM_RPC_URL_BY_CHAIN } from './evm-rpc';

const ORCHESTRATOR_URL = (process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || '/api').replace(/\/$/, '');
const EVM_NATIVE_TOKEN = '0x0000000000000000000000000000000000000000';
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const FORWARD_DIRECTION: SwapDirection = 'mayan-to-xmr';
const REVERSE_DIRECTION: SwapDirection = 'xmr-to-mayan';
const DEFAULT_MAYAN_CHAIN: SourceChainId = 'ethereum';
const DEFAULT_EXECUTION_POLICY: ExecutionPolicy = 'execute-anyway';
const DEFAULT_SLIPPAGE_BPS = 200;
const AUTO_REFRESH_QUOTE_MS = 10_000;
const TOKEN_RELEVANCE_BY_CHAIN: Partial<Record<SourceChainId, readonly string[]>> = {
  ethereum: ['ETH', 'USDC', 'USDT', 'WBTC', 'DAI', 'LINK', 'UNI', 'AAVE', 'ENA', 'PEPE', 'SHIB'],
  base: ['ETH', 'USDC', 'cbBTC', 'USDT', 'EURC', 'AERO', 'VIRTUAL', 'MORPHO', 'DEGEN', 'BRETT'],
  arbitrum: ['ETH', 'USDC', 'USDT', 'WBTC', 'ARB', 'GMX', 'LINK', 'PENDLE', 'DAI'],
  optimism: ['ETH', 'USDC', 'USDT', 'OP', 'WLD', 'SNX', 'VELO', 'DAI'],
  polygon: ['POL', 'MATIC', 'USDC', 'USDT', 'WBTC', 'DAI', 'AAVE', 'LINK'],
  avalanche: ['AVAX', 'USDC', 'USDT', 'BTC.b', 'JOE', 'QI'],
  bsc: ['BNB', 'USDT', 'USDC', 'BTCB', 'ETH', 'FDUSD', 'CAKE'],
  linea: ['ETH', 'USDC', 'USDT', 'DAI', 'ZERO'],
  hyperevm: ['HYPE', 'USDC', 'UBTC', 'PURR'],
  monad: ['MON', 'USDC', 'USDT', 'WBTC'],
  sui: ['SUI', 'USDC', 'USDT', 'WAL', 'DEEP', 'CETUS'],
  hyperliquid: ['USDC', 'HYPE', 'PURR'],
  solana: ['USDC', 'USDT', 'XMR', 'JUP', 'JITOSOL', 'PYUSD', 'BONK', 'RAY', 'WIF'],
} as const;
const STABLE_TOKEN_SYMBOLS = new Set(['USDC', 'USDC.E', 'USDCE', 'USDT', 'DAI', 'USDE', 'USDS', 'FRAX', 'FDUSD', 'PYUSD', 'EURC']);
const BLUE_CHIP_TOKEN_SYMBOLS = new Set([
  'ETH',
  'BTC',
  'WBTC',
  'CBBTC',
  'BTCB',
  'SOL',
  'BNB',
  'AVAX',
  'POL',
  'MATIC',
  'LINK',
  'AAVE',
  'UNI',
  'HYPE',
  'MON',
  'SUI',
]);

type RouteLeg = {
  title: string;
  caption: string;
  detail: string;
};

function MoneroLogo({ className = 'w-8 h-8' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 3756.09 3756.49" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M4128,2249.81C4128,3287,3287.26,4127.86,2250,4127.86S372,3287,372,2249.81,1212.76,371.75,2250,371.75,4128,1212.54,4128,2249.81Z" transform="translate(-371.96 -371.75)" fill="#fff" />
      <path d="M2250,371.75c-1036.89,0-1879.12,842.06-1877.8,1878,0.26,207.26,33.31,406.63,95.34,593.12h561.88V1263L2250,2483.57,3470.52,1263v1579.9h562c62.12-186.48,95-385.85,95.37-593.12C4129.66,1212.76,3287,372,2250,372Z" transform="translate(-371.96 -371.75)" fill="#f26822" />
      <path d="M1969.3,2764.17l-532.67-532.7v994.14H1029.38l-384.29.07c329.63,540.8,925.35,902.56,1604.91,902.56S3525.31,3766.4,3855,3225.6H3063.25V2231.47l-532.7,532.7-280.61,280.61-280.62-280.61h0Z" transform="translate(-371.96 -371.75)" fill="#4d4d4d" />
    </svg>
  );
}

export default function SwapPage() {
  const [direction, setDirection] = useState<SwapDirection>(FORWARD_DIRECTION);
  const [sourceChain, setSourceChain] = useState<SourceChainId>(DEFAULT_MAYAN_CHAIN);
  const [sourceTokens, setSourceTokens] = useState<MayanToken[]>([]);
  const [sourceToken, setSourceToken] = useState('');
  const [amount, setAmount] = useState('');
  const [xmrAddress, setXmrAddress] = useState('');
  const [destinationAddress, setDestinationAddress] = useState('');
  const [refundAddress, setRefundAddress] = useState('');
  const [executionPolicy, setExecutionPolicy] = useState<ExecutionPolicy>(DEFAULT_EXECUTION_POLICY);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isQuoteRefreshing, setIsQuoteRefreshing] = useState(false);
  const [isTokenPickerOpen, setIsTokenPickerOpen] = useState(false);
  const [tokenSearch, setTokenSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const quoteRequestSeq = useRef(0);

  useEffect(() => {
    const orderId = new URLSearchParams(window.location.search).get('order');
    if (!orderId) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    api<Order>(`/orders/${orderId}`)
      .then((next) => {
        if (cancelled) return;
        setOrder(next);
        setQuote(null);
        setDirection(next.direction ?? FORWARD_DIRECTION);
        setSourceChain(next.sourceChain);
        setSourceToken(next.sourceToken);
        setAmount(formatBaseUnits(next.amount, orderInputDecimals(next)));
        setXmrAddress(next.xmrAddress);
        setDestinationAddress(next.destinationAddress ?? '');
        setRefundAddress(next.refundAddress ?? '');
        setExecutionPolicy(next.executionPolicy ?? DEFAULT_EXECUTION_POLICY);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const chains = selectableMayanChains(direction);
    if (chains.includes(sourceChain)) return;
    setSourceChain(defaultMayanChain(direction));
    quoteRequestSeq.current += 1;
    setIsQuoteRefreshing(false);
    setQuote(null);
    setOrder(null);
    clearOrderUrl();
  }, [direction, sourceChain]);

  useEffect(() => {
    let cancelled = false;
    setSourceTokens([]);
    setTokenSearch('');
    api<MayanToken[]>(`/tokens/${sourceChain}`)
      .then((tokens) => {
        if (cancelled) return;
        const sortedTokens = sortTokensByRelevance(filterMayanTokensForChain(tokens, sourceChain), sourceChain);
        setSourceTokens(sortedTokens);
        const preferred = sortedTokens[0];
        setSourceToken((current) =>
          sortedTokens.some((token) => tokenAddress(token) === current) ? current : tokenAddress(preferred) ?? '',
        );
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [sourceChain]);

  useEffect(() => {
    if (!order || ['completed', 'failed', 'expired', 'refunded'].includes(order.status)) return;
    const timer = setInterval(async () => {
      const next = await api<Order>(`/orders/${order.id}`);
      setOrder(next);
    }, 3_000);
    return () => clearInterval(timer);
  }, [order]);

  const selectedToken = useMemo(
    () => sourceTokens.find((token) => tokenAddress(token) === sourceToken),
    [sourceToken, sourceTokens],
  );
  const sourceTokenDecimals = selectedToken?.decimals ?? 6;
  const inputDecimals = direction === FORWARD_DIRECTION ? sourceTokenDecimals : XMR_DECIMALS;
  const parsedAmount = useMemo(() => parseTokenAmount(amount, inputDecimals), [amount, inputDecimals]);
  const destinationAddressOk = direction === FORWARD_DIRECTION
    ? true
    : sourceChain === 'solana'
      ? isPotentialSolanaAddress(destinationAddress)
      : Boolean(destinationAddress.trim());
  const hasValidXmrAddress = isValidMoneroAddress(xmrAddress);
  const canPreviewQuote = Boolean(sourceToken) &&
    parsedAmount > BigInt(0) &&
    (direction === FORWARD_DIRECTION || (destinationAddressOk && hasValidXmrAddress));
  const quoteExpiresIn = useCountdown(quote?.expiresAt);
  const quoteExpired = quoteExpiresIn === 0;
  const canCreateOrder = Boolean(quote) &&
    !quoteExpired &&
    !isQuoteRefreshing &&
    (direction === FORWARD_DIRECTION
      ? hasValidXmrAddress
      : destinationAddressOk && hasValidXmrAddress);
  const routeLegs = buildRouteLegs({ direction, quote, selectedToken, sourceChain });
  const primaryLabel = getPrimaryLabel({ quote, order, isLoading, isQuoteRefreshing, quoteExpired, canCreateOrder });
  const primaryDisabled = getPrimaryDisabled({ canPreviewQuote, canCreateOrder, quote, order, isLoading, isQuoteRefreshing, quoteExpired });
  const receivePreview = formatReceivePreview({ direction, quote, token: selectedToken });
  const isReceivePreviewLoading = isQuoteRefreshing && canPreviewQuote;

  const resetTrade = ({ preserveQuote = false }: { preserveQuote?: boolean } = {}) => {
    quoteRequestSeq.current += 1;
    if (preserveQuote && quote) {
      setIsQuoteRefreshing(true);
    } else {
      setIsQuoteRefreshing(false);
      setQuote(null);
    }
    setOrder(null);
    clearOrderUrl();
  };

  const updateAmount = (next: string) => {
    setAmount(next);
    resetTrade({
      preserveQuote: parseTokenAmount(next, inputDecimals) > BigInt(0),
    });
  };

  const switchDirection = () => {
    setDirection((current) => (current === FORWARD_DIRECTION ? REVERSE_DIRECTION : FORWARD_DIRECTION));
    resetTrade();
  };

  const fetchQuote = useCallback(async ({ showLoading }: { showLoading: boolean }) => {
    if (!canPreviewQuote) return;
    const requestSeq = quoteRequestSeq.current + 1;
    quoteRequestSeq.current = requestSeq;
    setIsQuoteRefreshing(true);
    if (showLoading) setIsLoading(true);
    setError(null);
    try {
      const next = await api<Quote>('/quote', {
        method: 'POST',
        body: JSON.stringify({
          direction,
          sourceChain,
          sourceToken,
          amount: parsedAmount.toString(),
          xmrAddress: hasValidXmrAddress ? xmrAddress : undefined,
          destinationAddress: direction === REVERSE_DIRECTION ? destinationAddress.trim() : undefined,
          refundAddress: refundAddress || undefined,
          slippageBps: DEFAULT_SLIPPAGE_BPS,
          executionPolicy,
        }),
      });
      if (quoteRequestSeq.current !== requestSeq) return;
      setQuote(next);
      setOrder(null);
      clearOrderUrl();
    } catch (e) {
      if (quoteRequestSeq.current === requestSeq) {
        setError(errorMessage(e));
      }
    } finally {
      if (showLoading && quoteRequestSeq.current === requestSeq) {
        setIsLoading(false);
      }
      if (quoteRequestSeq.current === requestSeq) {
        setIsQuoteRefreshing(false);
      }
    }
  }, [canPreviewQuote, destinationAddress, direction, executionPolicy, hasValidXmrAddress, parsedAmount, refundAddress, sourceChain, sourceToken, xmrAddress]);

  useEffect(() => {
    if (!canPreviewQuote || order) return;
    const timer = setTimeout(() => {
      void fetchQuote({ showLoading: false });
    }, 650);
    return () => clearTimeout(timer);
  }, [canPreviewQuote, fetchQuote, order]);

  useEffect(() => {
    if (!canPreviewQuote || order || isLoading || isQuoteRefreshing) return;
    const timer = setInterval(() => {
      void fetchQuote({ showLoading: false });
    }, AUTO_REFRESH_QUOTE_MS);
    return () => clearInterval(timer);
  }, [canPreviewQuote, fetchQuote, isLoading, isQuoteRefreshing, order]);

  const requestQuote = async () => {
    await fetchQuote({ showLoading: true });
  };

  const createOrder = async () => {
    if (!quote) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await api<{ order: Order; funding: FundingInstructions }>('/orders', {
        method: 'POST',
        body: JSON.stringify({
          quoteId: quote.id,
          refundAddress: refundAddress || undefined,
          xmrAddress: xmrAddress.trim(),
          executionPolicy,
        }),
      });
      setOrder(result.order);
      setOrderUrl(result.order.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setIsLoading(false);
    }
  };

  const onPrimaryAction = () => {
    if (quote && !quoteExpired) {
      void createOrder();
      return;
    }
    void requestQuote();
  };

  const reportDeposit = async (txHash: string) => {
    if (!order) return;
    const updated = await api<Order>(`/orders/${order.id}/deposit`, {
      method: 'POST',
      body: JSON.stringify({ txHash }),
    });
    setOrder(updated);
    setOrderUrl(updated.id);
  };

  return (
    <main className="min-h-screen xmr-pattern">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-5 md:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <MoneroLogo className="h-9 w-9 shrink-0" />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-white">Swap XMR</h1>
            <p className="text-xs text-[var(--muted)]">Mayan Swift v2, Jupiter, Monero Bridge</p>
          </div>
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-[#273226] bg-[#111711] px-3 py-2 text-xs text-[#9ee6a8] sm:flex">
          <span className="h-2 w-2 rounded-full bg-[#35d071]" />
          Live route
        </div>
      </header>

      <section className="mx-auto grid w-full max-w-6xl gap-5 px-4 pb-10 md:px-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="overflow-hidden rounded-[24px] border border-[#26272d] bg-[#111216] shadow-2xl shadow-black/40">
          <div className="border-b border-[#24252b] bg-[#15161b] px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-white">Exchange</div>
                <div className="text-xs text-[var(--muted)]">
                  {direction === FORWARD_DIRECTION ? 'One wallet transaction into native Monero.' : 'Native Monero into supported assets.'}
                </div>
              </div>
              <div className="rounded-full border border-[#30333b] bg-[#0b0c10] px-3 py-1 text-xs font-medium text-[#c8cbd1]">
                {direction === FORWARD_DIRECTION ? 'To XMR' : 'From XMR'}
              </div>
            </div>
          </div>

          <div className="space-y-4 p-4 md:p-5">
            {direction === FORWARD_DIRECTION ? (
              <TradeAmountPanel
                amount={amount}
                chainId={sourceChain}
                token={selectedToken}
                label="You send"
                onAmountChange={updateAmount}
                onOpenTokenPicker={() => setIsTokenPickerOpen(true)}
              />
            ) : (
              <XmrAmountPanel
                amount={amount}
                onAmountChange={updateAmount}
              />
            )}

            <DirectionSwapButton direction={direction} onClick={switchDirection} />

            {direction === FORWARD_DIRECTION ? (
              <ReceivePanel value={receivePreview} quote={quote} isLoading={isReceivePreviewLoading} />
            ) : (
              <MayanReceivePanel
                value={receivePreview}
                chainId={sourceChain}
                token={selectedToken}
                isLoading={isReceivePreviewLoading}
                onOpenTokenPicker={() => setIsTokenPickerOpen(true)}
              />
            )}

            <RecipientPanel
              direction={direction}
              sourceChain={sourceChain}
              xmrAddress={xmrAddress}
              destinationAddress={destinationAddress}
              refundAddress={refundAddress}
              onXmrAddressChange={(next) => {
                setXmrAddress(next);
              }}
              onDestinationAddressChange={(next) => {
                setDestinationAddress(next);
                resetTrade();
              }}
              onRefundAddressChange={setRefundAddress}
            />

            <ExecutionPolicyPanel
              value={executionPolicy}
              onChange={(next) => {
                setExecutionPolicy(next);
              }}
            />

            {error && <ErrorBanner message={error} />}

            <button
              onClick={onPrimaryAction}
              disabled={primaryDisabled}
              className="xmr-btn-primary flex min-h-14 w-full items-center justify-center rounded-2xl px-5 py-4 text-base font-semibold text-white disabled:translate-y-0"
            >
              {primaryLabel}
            </button>

            {quote && (
              <QuoteSummary
                quote={quote}
                quoteExpiresIn={quoteExpiresIn}
                quoteExpired={quoteExpired}
              />
            )}

            {order?.status === 'awaiting_deposit' && (
              <FundingPanel
                order={order}
                onDeposit={reportDeposit}
                onError={(message) => setError(message)}
              />
            )}
          </div>
        </div>

        <aside className="space-y-5">
          <RoutePanel legs={routeLegs} quote={quote} />
          <OrderStatusPanel order={order} />
        </aside>
      </section>

      {isTokenPickerOpen && (
        <TokenPicker
          chainId={sourceChain}
          chains={selectableMayanChains(direction)}
          tokens={sourceTokens}
          selectedToken={sourceToken}
          search={tokenSearch}
          onSearchChange={setTokenSearch}
          onChainChange={(next) => {
            setSourceChain(next);
            resetTrade();
          }}
          onClose={() => setIsTokenPickerOpen(false)}
          onSelect={(contract) => {
            setSourceToken(contract);
            setIsTokenPickerOpen(false);
            resetTrade();
          }}
        />
      )}
    </main>
  );
}

function DirectionSwapButton({
  direction,
  onClick,
}: {
  direction: SwapDirection;
  onClick: () => void;
}) {
  const label = direction === FORWARD_DIRECTION ? 'Switch to XMR source' : 'Switch to asset source';
  return (
    <div className="flex justify-center">
      <button
        type="button"
        onClick={onClick}
        title={label}
        aria-label={label}
        className="group flex h-11 w-11 items-center justify-center rounded-full border border-[#343740] bg-[#15161b] text-[#f26822] shadow-lg shadow-black/25 transition-colors hover:border-[#f26822] hover:bg-[#1b1714] focus:outline-none focus:ring-2 focus:ring-[#f26822]/60"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
          <path
            d="M7 4v13m0 0 4-4m-4 4-4-4M17 20V7m0 0-4 4m4-4 4 4"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        </svg>
      </button>
    </div>
  );
}

function TradeAmountPanel({
  amount,
  chainId,
  token,
  label,
  onAmountChange,
  onOpenTokenPicker,
}: {
  amount: string;
  chainId: SourceChainId;
  token?: MayanToken;
  label: string;
  onAmountChange: (value: string) => void;
  onOpenTokenPicker: () => void;
}) {
  const chainName = CHAINS[chainId].name;
  return (
    <div className="rounded-2xl border border-[#292b31] bg-[#0c0d11] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm text-[#9aa0aa]">{label}</div>
        <div className="rounded-full border border-[#30333b] bg-[#17191f] px-3 py-1 text-xs text-[#9aa0aa]">
          {chainName}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(event) => onAmountChange(event.target.value)}
          placeholder="0.00"
          className="min-w-0 flex-1 bg-transparent text-4xl font-semibold text-white outline-none placeholder:text-[#3e424b] md:text-5xl"
        />
        <button
          onClick={onOpenTokenPicker}
          className="flex min-w-[132px] items-center justify-between gap-2 rounded-2xl border border-[#30333b] bg-[#17191f] px-3 py-3 text-left text-white transition-colors hover:border-[#f26822]"
        >
          <TokenLogo token={token} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{token?.symbol ?? 'Token'}</span>
            <span className="block truncate text-[11px] text-[#8f949d]">{chainName}</span>
          </span>
          <span className="text-[#8f949d]">v</span>
        </button>
      </div>
    </div>
  );
}

function XmrAmountPanel({
  amount,
  onAmountChange,
}: {
  amount: string;
  onAmountChange: (value: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-[#292b31] bg-[#0c0d11] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm text-[#9aa0aa]">You send</div>
        <div className="rounded-full border border-[#30333b] bg-[#17191f] px-3 py-1 text-xs text-[#9aa0aa]">
          Native Monero
        </div>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="number"
          min="0"
          step="0.000001"
          value={amount}
          onChange={(event) => onAmountChange(event.target.value)}
          placeholder="0.000000"
          className="min-w-0 flex-1 bg-transparent text-4xl font-semibold text-white outline-none placeholder:text-[#3e424b] md:text-5xl"
        />
        <div className="flex min-w-[132px] items-center gap-2 rounded-2xl border border-[#30333b] bg-[#17191f] px-3 py-3">
          <MoneroLogo className="h-8 w-8 shrink-0" />
          <span>
            <span className="block text-sm font-semibold text-white">XMR</span>
            <span className="block text-[11px] text-[#8f949d]">Native</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function ReceivePanel({ value, quote, isLoading }: { value: string; quote: Quote | null; isLoading: boolean }) {
  return (
    <div className="rounded-2xl border border-[#292b31] bg-[#0c0d11] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm text-[#9aa0aa]">You get</div>
        <div className="rounded-full border border-[#30333b] bg-[#17191f] px-3 py-1 text-xs text-[#9aa0aa]">
          Native Monero
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className={`min-w-0 flex-1 text-4xl font-semibold transition-colors md:text-5xl ${isLoading ? 'text-[#6f747d]' : 'text-white'}`}>
          {value}
        </div>
        <div className="flex min-w-[132px] items-center gap-2 rounded-2xl border border-[#30333b] bg-[#17191f] px-3 py-3">
          <MoneroLogo className="h-8 w-8 shrink-0" />
          <span>
            <span className="block text-sm font-semibold text-white">XMR</span>
            <span className="block text-[11px] text-[#8f949d]">{quote ? 'Estimated' : 'Quote first'}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function MayanReceivePanel({
  value,
  chainId,
  token,
  isLoading,
  onOpenTokenPicker,
}: {
  value: string;
  chainId: SourceChainId;
  token?: MayanToken;
  isLoading: boolean;
  onOpenTokenPicker: () => void;
}) {
  const chainName = CHAINS[chainId].name;
  return (
    <div className="rounded-2xl border border-[#292b31] bg-[#0c0d11] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm text-[#9aa0aa]">You get</div>
        <div className="rounded-full border border-[#30333b] bg-[#17191f] px-3 py-1 text-xs text-[#9aa0aa]">
          {chainName}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className={`min-w-0 flex-1 text-4xl font-semibold transition-colors md:text-5xl ${isLoading ? 'text-[#6f747d]' : 'text-white'}`}>
          {value}
        </div>
        <button
          onClick={onOpenTokenPicker}
          className="flex min-w-[132px] items-center justify-between gap-2 rounded-2xl border border-[#30333b] bg-[#17191f] px-3 py-3 text-left text-white transition-colors hover:border-[#f26822]"
        >
          <TokenLogo token={token} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{token?.symbol ?? 'Token'}</span>
            <span className="block truncate text-[11px] text-[#8f949d]">{chainName}</span>
          </span>
          <span className="text-[#8f949d]">v</span>
        </button>
      </div>
    </div>
  );
}

function ChainSelect({
  value,
  chains,
  onChange,
}: {
  value: SourceChainId;
  chains: readonly SourceChainId[];
  onChange: (value: SourceChainId) => void;
}) {
  return (
    <label className="relative block">
      <span className="sr-only">Network</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as SourceChainId)}
        className="w-full appearance-none rounded-xl border border-[#30333b] bg-[#17191f] py-3 pl-3 pr-9 text-sm font-medium text-white outline-none transition-colors hover:border-[#f26822] focus:border-[#f26822]"
      >
        {chains.map((chain) => (
          <option key={chain} value={chain}>{CHAINS[chain].name}</option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#8f949d]">v</span>
    </label>
  );
}

function RecipientPanel({
  direction,
  sourceChain,
  xmrAddress,
  destinationAddress,
  refundAddress,
  onXmrAddressChange,
  onDestinationAddressChange,
  onRefundAddressChange,
}: {
  direction: SwapDirection;
  sourceChain: SourceChainId;
  xmrAddress: string;
  destinationAddress: string;
  refundAddress: string;
  onXmrAddressChange: (value: string) => void;
  onDestinationAddressChange: (value: string) => void;
  onRefundAddressChange: (value: string) => void;
}) {
  const addressOk = !xmrAddress || isValidMoneroAddress(xmrAddress);
  const destinationLabel = sourceChain === 'solana' ? 'Solana receive address' : 'Destination address';
  const destinationPlaceholder = sourceChain === 'solana' ? 'Solana wallet address' : 'Wallet on the destination chain';

  return (
    <div className="grid gap-3 rounded-2xl border border-[#292b31] bg-[#0f1015] p-4">
      {direction === FORWARD_DIRECTION ? (
        <>
          <label>
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-sm text-[#9aa0aa]">XMR receive address</span>
              <span className={addressOk ? 'text-xs text-[#35d071]' : 'text-xs text-[#ff7777]'}>
                {addressOk ? 'Ready' : 'Invalid'}
              </span>
            </div>
            <textarea
              value={xmrAddress}
              onChange={(event) => onXmrAddressChange(event.target.value.trim())}
              rows={3}
              placeholder="4..."
              className="w-full resize-none rounded-xl border border-[#2c2f37] bg-[#090a0e] px-3 py-3 text-sm text-white outline-none transition-colors placeholder:text-[#444954] focus:border-[#f26822]"
            />
          </label>
          <label>
            <div className="mb-2 text-sm text-[#9aa0aa]">Solana refund address</div>
            <input
              value={refundAddress}
              onChange={(event) => onRefundAddressChange(event.target.value.trim())}
              placeholder="Optional"
              className="w-full rounded-xl border border-[#2c2f37] bg-[#090a0e] px-3 py-3 text-sm text-white outline-none transition-colors placeholder:text-[#444954] focus:border-[#f26822]"
            />
          </label>
        </>
      ) : (
        <>
          <label>
            <div className="mb-2 text-sm text-[#9aa0aa]">{destinationLabel}</div>
            <textarea
              value={destinationAddress}
              onChange={(event) => onDestinationAddressChange(event.target.value.trim())}
              rows={2}
              placeholder={destinationPlaceholder}
              className="w-full resize-none rounded-xl border border-[#2c2f37] bg-[#090a0e] px-3 py-3 text-sm text-white outline-none transition-colors placeholder:text-[#444954] focus:border-[#f26822]"
            />
          </label>
          <label>
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-sm text-[#9aa0aa]">XMR refund address</span>
              <span className={addressOk ? 'text-xs text-[#35d071]' : 'text-xs text-[#ff7777]'}>
                {addressOk ? 'Ready' : 'Invalid'}
              </span>
            </div>
            <textarea
              value={xmrAddress}
              onChange={(event) => onXmrAddressChange(event.target.value.trim())}
              rows={3}
              placeholder="4..."
              className="w-full resize-none rounded-xl border border-[#2c2f37] bg-[#090a0e] px-3 py-3 text-sm text-white outline-none transition-colors placeholder:text-[#444954] focus:border-[#f26822]"
            />
          </label>
        </>
      )}
    </div>
  );
}

function ExecutionPolicyPanel({
  value,
  onChange,
}: {
  value: ExecutionPolicy;
  onChange: (value: ExecutionPolicy) => void;
}) {
  const options: Array<{ value: ExecutionPolicy; title: string; caption: string }> = [
    {
      value: 'execute-anyway',
      title: 'Swap anyway',
      caption: 'Use the best available rate',
    },
    {
      value: 'refund-on-slippage',
      title: 'Protect my amount',
      caption: 'Refund me if I would receive over 2% less',
    },
  ];

  return (
    <div className="rounded-2xl border border-[#292b31] bg-[#0f1015] p-3">
      <div className="mb-2 text-sm text-[#9aa0aa]">If the price moves</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                selected
                  ? 'border-[#f26822] bg-[#22170f] text-white'
                  : 'border-[#30333b] bg-[#090a0e] text-[#c8cbd1] hover:border-[#f26822]'
              }`}
            >
              <span className="block text-sm font-semibold">{option.title}</span>
              <span className="mt-1 block text-xs text-[#8f949d]">{option.caption}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TokenPicker({
  chainId,
  chains,
  tokens,
  selectedToken,
  search,
  onSearchChange,
  onChainChange,
  onClose,
  onSelect,
}: {
  chainId: SourceChainId;
  chains: readonly SourceChainId[];
  tokens: MayanToken[];
  selectedToken: string;
  search: string;
  onSearchChange: (value: string) => void;
  onChainChange: (value: SourceChainId) => void;
  onClose: () => void;
  onSelect: (contract: string) => void;
}) {
  const filteredTokens = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return tokens;
    return tokens.filter((token) =>
      [token.symbol, token.name, tokenAddress(token)]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(needle)),
    );
  }, [search, tokens]);

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/75 p-3 sm:items-center sm:justify-center" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-lg overflow-hidden rounded-3xl border border-[#292b31] bg-[#111216] shadow-2xl shadow-black"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-[#24252b] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-white">Select asset</div>
              <div className="text-xs text-[#8f949d]">Choose network and token</div>
            </div>
            <button onClick={onClose} className="rounded-full border border-[#30333b] px-3 py-2 text-sm text-[#c8cbd1] hover:border-[#f26822]">
              Close
            </button>
          </div>
          <div className="mb-3 rounded-2xl border border-[#292b31] bg-[#0c0d11] p-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-[#6f747d]">Network</div>
            <ChainSelect value={chainId} chains={chains} onChange={onChainChange} />
          </div>
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search token"
            autoFocus
            className="w-full rounded-2xl border border-[#2c2f37] bg-[#090a0e] px-4 py-3 text-sm text-white outline-none placeholder:text-[#444954] focus:border-[#f26822]"
          />
        </div>
        <div className="max-h-[58vh] overflow-y-auto p-2">
          {filteredTokens.map((token) => {
            const contract = tokenAddress(token) ?? '';
            const isSelected = contract === selectedToken;
            return (
              <button
                key={contract || token.symbol || token.name}
                onClick={() => contract && onSelect(contract)}
                className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors ${
                  isSelected ? 'bg-[#22170f] ring-1 ring-[#f26822]' : 'hover:bg-[#191b21]'
                }`}
              >
                <TokenLogo token={token} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-white">{token.symbol ?? 'Token'}</span>
                  <span className="block truncate text-xs text-[#8f949d]">{token.name ?? contract}</span>
                </span>
                <span className="text-xs text-[#6f747d]">{token.standard ?? 'asset'}</span>
              </button>
            );
          })}
          {!filteredTokens.length && (
            <div className="px-4 py-8 text-center text-sm text-[#8f949d]">No matching assets</div>
          )}
        </div>
      </div>
    </div>
  );
}

function QuoteSummary({
  quote,
  quoteExpiresIn,
  quoteExpired,
}: {
  quote: Quote;
  quoteExpiresIn: number | null;
  quoteExpired: boolean;
}) {
  const mayan = quote.mayan;
  const isReverse = quote.direction === REVERSE_DIRECTION;
  const sourceDecimals = isReverse ? XMR_DECIMALS : quote.sourceTokenDecimals ?? mayan?.quote.fromToken.decimals ?? 6;
  const sourceSymbol = isReverse ? 'XMR' : quote.sourceTokenSymbol ?? mayan?.quote.fromToken.symbol ?? 'Token';
  const destinationSymbol = quote.destinationTokenSymbol ?? quote.sourceTokenSymbol ?? mayan?.quote.toToken.symbol ?? 'Token';
  const destinationDecimals = quote.destinationTokenDecimals ?? quote.sourceTokenDecimals ?? mayan?.quote.toToken.decimals ?? 6;
  const isSolanaDirect = quote.route === 'solana';
  const expectedLabel = isReverse ? `Expected ${destinationSymbol}` : 'Expected XMR';
  const expectedValue = isReverse
    ? `${formatBaseUnits(quote.estimatedDestinationOut ?? '0', destinationDecimals)} ${destinationSymbol}`
    : `${formatXmr(quote.estimatedXmrOut)} XMR`;
  const minimumLabel = isReverse ? `Minimum ${destinationSymbol}` : 'Minimum XMR';
  const minimumValue = isReverse
    ? `${formatBaseUnits(quote.minDestinationOut ?? '0', destinationDecimals)} ${destinationSymbol}`
    : `${formatXmr(quote.minXmrOut)} XMR`;
  const fees = isSolanaDirect
    ? `Jupiter + ${formatBps(quote.bridgeFeeBps)} bridge`
    : `${formatBps(mayan?.protocolBps ?? 0)} Mayan + ${formatBps(quote.bridgeFeeBps)} bridge`;

  return (
    <div className="rounded-2xl border border-[#292b31] bg-[#101116] p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">Quote ready</div>
          <div className="text-xs text-[#8f949d]">{quote.routeSummary ?? 'Mayan Swift v2 route'}</div>
        </div>
        <div className={`rounded-full px-3 py-1 text-xs font-semibold ${quoteExpired ? 'bg-[#351919] text-[#ff8c8c]' : 'bg-[#142316] text-[#9ee6a8]'}`}>
          {quoteExpired ? 'Expired' : `Expires in ${formatCountdown(quoteExpiresIn)}`}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Sending" value={`${formatBaseUnits(quote.inputAmount, sourceDecimals)} ${sourceSymbol}`} />
        <Metric label={expectedLabel} value={expectedValue} />
        <Metric label={minimumLabel} value={minimumValue} />
        <Metric label="Fees" value={fees} />
      </div>
    </div>
  );
}

function RoutePanel({ legs, quote }: { legs: RouteLeg[]; quote: Quote | null }) {
  return (
    <div className="rounded-[24px] border border-[#26272d] bg-[#111216] p-4 shadow-xl shadow-black/30">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">Route</h2>
          <p className="text-xs text-[#8f949d]">Token path and execution venues</p>
        </div>
        <div className="rounded-full bg-[#17191f] px-3 py-1 text-xs text-[#c8cbd1]">
          {quote?.route === 'solana' ? 'Direct Solana' : quote?.mayan?.clientEta ?? 'Live quote'}
        </div>
      </div>
      <div className="space-y-3">
        {legs.map((leg, index) => (
          <div key={`${leg.title}-${index}`} className="grid grid-cols-[32px_minmax(0,1fr)] gap-3">
            <div className="flex flex-col items-center">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[#363941] bg-[#17191f] text-xs font-semibold text-white">
                {index + 1}
              </div>
              {index < legs.length - 1 && <div className="h-full min-h-7 w-px bg-[#2a2d35]" />}
            </div>
            <div className="min-w-0 rounded-2xl border border-[#292b31] bg-[#0c0d11] p-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-white">{leg.title}</div>
                <div className="truncate text-xs text-[#8f949d]">{leg.caption}</div>
              </div>
              <div className="mt-2 text-xs text-[#6f747d]">{leg.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FundingPanel({
  order,
  onDeposit,
  onError,
}: {
  order: Order;
  onDeposit: (txHash: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  if (order.status !== 'awaiting_deposit') {
    return null;
  }
  if (order.funding.type === 'mayan-swift') {
    return <MayanEvmFunding funding={order.funding} onDeposit={onDeposit} onError={onError} />;
  }
  if (order.funding.type === 'deposit-address') {
    return <XmrDepositFunding order={order} funding={order.funding} />;
  }
  if (order.funding.type === 'solana-transfer') {
    return <SolanaTransferFunding funding={order.funding} onDeposit={onDeposit} onError={onError} />;
  }
  return (
    <div className="rounded-2xl border border-[#292b31] bg-[#101116] p-4 text-sm text-[#c8cbd1]">
      Unsupported funding route.
    </div>
  );
}

function SolanaTransferFunding({
  funding,
  onDeposit,
  onError,
}: {
  funding: Extract<FundingInstructions, { type: 'solana-transfer' }>;
  onDeposit: (txHash: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [isFunding, setIsFunding] = useState(false);
  const amount = formatBaseUnits(funding.amount, funding.tokenDecimals ?? 6);

  const fund = async () => {
    setIsFunding(true);
    try {
      if (!publicKey) {
        throw new Error('Connect a Solana wallet to fund this order');
      }
      const mint = new PublicKey(funding.mint);
      const destinationOwner = new PublicKey(funding.destinationOwner);
      const destinationTokenAccount = new PublicKey(funding.destinationTokenAccount);
      const expectedDestination = getAssociatedTokenAddressSync(mint, destinationOwner);
      if (!destinationTokenAccount.equals(expectedDestination)) {
        throw new Error('Order destination token account does not match the configured hot wallet');
      }

      const sourceTokenAccount = getAssociatedTokenAddressSync(mint, publicKey);
      const latestBlockhash = await connection.getLatestBlockhash('confirmed');
      const transaction = new Transaction({
        feePayer: publicKey,
        recentBlockhash: latestBlockhash.blockhash,
      }).add(
        createAssociatedTokenAccountIdempotentInstruction(
          publicKey,
          destinationTokenAccount,
          destinationOwner,
          mint,
        ),
        createTransferInstruction(
          sourceTokenAccount,
          destinationTokenAccount,
          publicKey,
          BigInt(funding.amount),
          [],
          TOKEN_PROGRAM_ID,
        ),
        new TransactionInstruction({
          programId: MEMO_PROGRAM_ID,
          keys: [],
          data: Buffer.from(funding.memo, 'utf8'),
        }),
      );

      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction({ ...latestBlockhash, signature }, 'confirmed');
      await onDeposit(signature);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setIsFunding(false);
    }
  };

  return (
    <div className="rounded-2xl border border-[#f26822]/40 bg-[#1a120c] p-4">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">Pay with Solana wallet</div>
          <div className="truncate text-xs text-[#c59a7c]">
            {publicKey ? shortAddress(publicKey.toBase58()) : 'Connect a Solana wallet'}
          </div>
        </div>
        <WalletMultiButton />
      </div>
      <div className="mb-3 grid gap-2 rounded-xl border border-[#493424] bg-[#120d09] p-3 text-sm">
        <Metric label="Amount" value={`${amount} ${funding.tokenSymbol ?? 'token'}`} />
        <Metric label="Route" value="Solana -> Jupiter -> XMR" />
      </div>
      <button
        onClick={fund}
        disabled={isFunding || !publicKey}
        className="xmr-btn-primary flex min-h-12 w-full items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold text-white disabled:translate-y-0"
      >
        {isFunding ? 'Waiting for wallet...' : `Send ${funding.tokenSymbol ?? 'token'}`}
      </button>
    </div>
  );
}

function XmrDepositFunding({
  order,
  funding,
}: {
  order: Order;
  funding: Extract<FundingInstructions, { type: 'deposit-address' }>;
}) {
  const addressReady = Boolean(funding.address);
  const amount = formatXmr(funding.expectedAmount ?? order.amount);
  const copyAddress = () => {
    if (funding.address) void navigator.clipboard?.writeText(funding.address);
  };

  return (
    <div className="rounded-2xl border border-[#f26822]/40 bg-[#1a120c] p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">Send native XMR</div>
          <div className="text-xs text-[#c59a7c]">Order {shortId(order.id)}</div>
        </div>
        <StatusBadge status={addressReady ? 'awaiting_deposit' : 'created'} />
      </div>
      <div className="space-y-3">
        <Metric label="Amount" value={`${amount} XMR`} />
        <div className="rounded-xl border border-[#493424] bg-[#120d09] p-3">
          <div className="mb-2 text-xs uppercase tracking-[0.08em] text-[#a8846d]">Deposit address</div>
          <div className="break-all font-mono text-sm text-white">
            {addressReady ? funding.address : 'Preparing deposit address...'}
          </div>
        </div>
        <button
          onClick={copyAddress}
          disabled={!addressReady}
          className="w-full rounded-2xl border border-[#493424] bg-[#23170e] px-4 py-3 text-sm font-semibold text-white transition-colors hover:border-[#f26822] disabled:text-[#7b6859]"
        >
          Copy XMR address
        </button>
      </div>
    </div>
  );
}

function MayanEvmFunding({
  funding,
  onDeposit,
  onError,
}: {
  funding: Extract<FundingInstructions, { type: 'mayan-swift' }>;
  onDeposit: (txHash: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const { address, chainId } = useAccount();
  const { connectors, connectAsync, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: funding.chainNumericId });
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();
  const [showConnect, setShowConnect] = useState(false);
  const [isFunding, setIsFunding] = useState(false);

  const fund = async () => {
    setIsFunding(true);
    try {
      if (!address) {
        setShowConnect(true);
        return;
      }
      if (chainId !== funding.chainNumericId) {
        await switchChainAsync({ chainId: funding.chainNumericId });
      }
      if (!publicClient) {
        throw new Error('No EVM RPC client is configured for this chain');
      }
      const rpcEnv = EVM_RPC_ENV_BY_CHAIN[funding.chainId];
      if (!EVM_RPC_URL_BY_CHAIN[funding.chainId]) {
        throw new Error(`${CHAINS[funding.chainId].name} receipt polling RPC is not configured. Set ${rpcEnv} and rebuild the swap app.`);
      }
      const requiredAllowance = BigInt(funding.approve.amount);
      if (funding.token.toLowerCase() !== EVM_NATIVE_TOKEN) {
        const currentAllowance = await publicClient.readContract({
          address: funding.token,
          abi: ERC20_ALLOWANCE_ABI,
          functionName: 'allowance',
          args: [address, funding.approve.spender],
        });
        if (currentAllowance < requiredAllowance) {
          const approveHash = await writeContractAsync({
            address: funding.token,
            abi: ERC20_APPROVE_ABI,
            functionName: 'approve',
            args: [funding.approve.spender, requiredAllowance],
            chainId: funding.chainNumericId,
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
      }
      const payload = await api<MayanEvmTxPayload>(`/orders/${funding.orderId}/mayan/evm-payload`, {
        method: 'POST',
        body: JSON.stringify({ swapperAddress: address }),
      });
      const swapHash = await sendTransactionAsync({
        to: payload.to,
        data: payload.data,
        value: BigInt(payload.value),
        chainId: funding.chainNumericId,
      });
      await onDeposit(swapHash);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setIsFunding(false);
    }
  };

  return (
    <div className="rounded-2xl border border-[#f26822]/40 bg-[#1a120c] p-4">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">Pay with wallet</div>
          <div className="truncate text-xs text-[#c59a7c]">{address ? shortAddress(address) : 'Connect an EVM wallet'}</div>
        </div>
        <button
          onClick={() => (address ? disconnect() : setShowConnect(true))}
          className="rounded-xl border border-[#493424] bg-[#23170e] px-3 py-2 text-sm text-white transition-colors hover:border-[#f26822]"
        >
          {address ? 'Disconnect' : 'Connect'}
        </button>
      </div>
      <button
        onClick={fund}
        disabled={isFunding}
        className="xmr-btn-primary flex min-h-12 w-full items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold text-white disabled:translate-y-0"
      >
        {isFunding ? 'Waiting for wallet...' : `Start ${funding.tokenSymbol ?? 'token'} swap`}
      </button>
      {showConnect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={() => setShowConnect(false)}>
          <div className="w-full max-w-sm rounded-3xl border border-[#292b31] bg-[#111216] p-4" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">Connect wallet</h3>
              <button onClick={() => setShowConnect(false)} className="rounded-full border border-[#30333b] px-3 py-2 text-sm text-[#c8cbd1] hover:border-[#f26822]">
                Close
              </button>
            </div>
            <div className="space-y-2">
              {connectors.map((connector) => (
                <button
                  key={connector.uid}
                  disabled={isPending}
                  onClick={async () => {
                    await connectAsync({ connector });
                    setShowConnect(false);
                  }}
                  className="w-full rounded-2xl border border-[#292b31] bg-[#0c0d11] px-3 py-3 text-left text-sm font-medium text-white transition-colors hover:border-[#f26822]"
                >
                  {connector.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OrderStatusPanel({ order }: { order: Order | null }) {
  const isSolanaDirect = order?.sourceChain === 'solana';
  const steps = order?.direction === REVERSE_DIRECTION
    ? [
        { label: 'XMR deposit', statuses: ['awaiting_deposit'] as Order['status'][] },
        { label: 'Bridge mint', statuses: ['minted'] as Order['status'][] },
        { label: 'Swap', statuses: ['swapping'] as Order['status'][] },
        { label: isSolanaDirect ? 'Solana payout' : 'Mayan payout', statuses: ['withdrawing', 'completed'] as Order['status'][] },
      ]
    : isSolanaDirect
      ? [
          { label: 'Deposit', statuses: ['awaiting_deposit', 'minted'] as Order['status'][] },
          { label: 'Swap', statuses: ['swapping'] as Order['status'][] },
          { label: 'XMR payout', statuses: ['withdrawing', 'completed'] as Order['status'][] },
        ]
      : [
        { label: 'Deposit', statuses: ['awaiting_deposit'] as Order['status'][] },
        { label: 'Bridge', statuses: ['bridging', 'minted'] as Order['status'][] },
        { label: 'Swap', statuses: ['swapping'] as Order['status'][] },
        { label: 'Payout', statuses: ['withdrawing', 'completed'] as Order['status'][] },
      ];

  return (
    <div className="rounded-[24px] border border-[#26272d] bg-[#111216] p-4 shadow-xl shadow-black/30">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">Order</h2>
          <p className="text-xs text-[#8f949d]">{order ? shortId(order.id) : 'No active order'}</p>
        </div>
        {order && <StatusBadge status={order.status} />}
      </div>
      {!order ? (
        <div className="rounded-2xl border border-dashed border-[#30333b] bg-[#0c0d11] px-4 py-8 text-center text-sm text-[#8f949d]">
          Your exchange progress appears here after an order is created.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-3">
            {steps.map((step, index) => {
              const currentIndex = steps.findIndex((candidate) => candidate.statuses.includes(order.status));
              const isActive = step.statuses.includes(order.status);
              const isDone = order.status === 'completed' || (currentIndex >= 0 && index < currentIndex);
              return (
                <div key={step.label} className="flex items-center gap-3">
                  <div className={`h-3 w-3 rounded-full ${isDone ? 'bg-[#f26822]' : isActive ? 'bg-[#35d071]' : 'bg-[#343842]'}`} />
                  <span className={isDone || isActive ? 'text-sm text-white' : 'text-sm text-[#707680]'}>{step.label}</span>
                </div>
              );
            })}
          </div>
          <div className="grid gap-2 rounded-2xl border border-[#292b31] bg-[#0c0d11] p-3 text-sm">
            {order.sourceTxHash && <ExplorerLink chain={order.sourceChain} hash={order.sourceTxHash} label={order.direction === REVERSE_DIRECTION ? 'Destination transaction' : 'Source transaction'} />}
            {order.solanaMintSignature && <ExplorerLink chain="solana" hash={order.solanaMintSignature} label={order.direction === REVERSE_DIRECTION ? 'Bridge claim' : 'Mayan delivery'} />}
            {order.swapSignature && <ExplorerLink chain="solana" hash={order.swapSignature} label="Jupiter swap" />}
            {order.withdrawalSignature && <ExplorerLink chain="solana" hash={order.withdrawalSignature} label={order.direction === REVERSE_DIRECTION ? (isSolanaDirect ? 'Solana payout' : 'Mayan payout') : 'Withdrawal request'} />}
            {order.error && <div className="text-sm text-[#ff9b9b]">{order.error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function TokenLogo({ token }: { token?: MayanToken }) {
  if (token?.logoURI) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Mayan token icons are remote asset URLs from the token list.
      <img src={token.logoURI} alt="" className="h-8 w-8 rounded-full bg-[#24272f]" />
    );
  }
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#24272f] text-xs font-semibold text-white">
      {(token?.symbol ?? '?').slice(0, 2).toUpperCase()}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-[#292b31] bg-[#0b0c10] px-3 py-3">
      <div className="truncate text-[11px] uppercase tracking-[0.08em] text-[#737982]">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold leading-snug text-white">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: Order['status'] }) {
  const palette = status === 'completed'
    ? 'bg-[#142316] text-[#9ee6a8]'
    : status === 'failed' || status === 'expired'
      ? 'bg-[#351919] text-[#ff8c8c]'
      : 'bg-[#22170f] text-[#f2a269]';
  return <div className={`rounded-full px-3 py-1 text-xs font-semibold ${palette}`}>{status.replace(/_/g, ' ')}</div>;
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-[#6d2a2a] bg-[#2a1111] px-4 py-3 text-sm text-[#ffb8b8]">
      {message}
    </div>
  );
}

function ExplorerLink({ chain, hash, label }: { chain: SourceChainId; hash: string; label: string }) {
  const explorer = CHAINS[chain].explorerTxUrl;
  if (!explorer) {
    return <div className="truncate text-[#f2a269]" title={hash}>{label}: {shortId(hash)}</div>;
  }
  return (
    <a
      href={`${explorer}${hash}`}
      target="_blank"
      rel="noreferrer"
      className="block truncate text-[#f2a269] transition-colors hover:text-[#f26822]"
      title={hash}
    >
      {label}: {shortId(hash)}
    </a>
  );
}

function buildRouteLegs({
  direction,
  quote,
  selectedToken,
  sourceChain,
}: {
  direction: SwapDirection;
  quote: Quote | null;
  selectedToken?: MayanToken;
  sourceChain: SourceChainId;
}): RouteLeg[] {
  const sourceSymbol = quote?.sourceTokenSymbol ?? selectedToken?.symbol ?? 'Token';
  if (direction === REVERSE_DIRECTION) {
    const destinationSymbol = quote?.destinationTokenSymbol ?? selectedToken?.symbol ?? 'Token';
    if (sourceChain === 'solana' || quote?.route === 'solana') {
      return [
        {
          title: 'Native XMR',
          caption: 'Monero wallet transfer',
          detail: 'You send native Monero to the order-specific bridge deposit address.',
        },
        {
          title: 'Monero Bridge',
          caption: 'native XMR to XMR-SOL',
          detail: 'The bridge mints wXMR to the order deposit owner after confirmations.',
        },
        {
          title: 'jup.ag',
          caption: `XMR-SOL to ${destinationSymbol} on Solana`,
          detail: 'Jupiter swaps the claimed wXMR into the selected Solana token.',
        },
        {
          title: 'Solana payout',
          caption: 'Direct token transfer',
          detail: 'The backend transfers the output token to your Solana receive address.',
        },
      ];
    }

    return [
      {
        title: 'Native XMR',
        caption: 'Monero wallet transfer',
        detail: 'You send native Monero to the order-specific bridge deposit address.',
      },
      {
        title: 'Monero Bridge',
        caption: 'native XMR to XMR-SOL',
        detail: 'The bridge mints wXMR to the order deposit owner after confirmations.',
      },
      {
        title: 'jup.ag',
        caption: 'XMR-SOL to USDC-SOL',
        detail: 'Jupiter swaps the claimed wXMR into Solana USDC.',
      },
      {
        title: 'Mayan Swift v2',
        caption: `USDC-SOL to ${CHAINS[sourceChain].name}`,
        detail: 'Mayan pays the selected token to your destination-chain address.',
      },
    ];
  }

  if (sourceChain === 'solana' || quote?.route === 'solana') {
    return [
      {
        title: `${sourceSymbol} on Solana`,
        caption: 'Wallet-signed Solana transfer',
        detail: 'You send the selected SPL token to the hot wallet with the order memo.',
      },
      {
        title: 'jup.ag',
        caption: `${sourceSymbol} to XMR-SOL`,
        detail: 'Jupiter swaps the selected Solana token into XMR-SOL.',
      },
      {
        title: 'Monero Bridge',
        caption: 'XMR-SOL to native XMR',
        detail: 'The bridge withdrawal request pays the final Monero address.',
      },
    ];
  }

  return [
    {
      title: `${sourceSymbol} on ${CHAINS[sourceChain].name}`,
      caption: 'Wallet-signed source transaction',
      detail: 'You keep custody until your wallet submits the Mayan Swift order.',
    },
    {
      title: 'Mayan Swift v2',
      caption: 'Cross-chain delivery to Solana',
      detail: 'Mayan routes the source asset into USDC on Solana for the hot wallet.',
    },
    {
      title: 'jup.ag',
      caption: 'USDC-SOL to XMR-SOL',
      detail: 'Jupiter swaps Solana USDC into XMR-SOL.',
    },
    {
      title: 'Monero Bridge',
      caption: 'XMR-SOL to native XMR',
      detail: 'The bridge withdrawal request pays the final Monero address.',
    },
  ];
}

function sortTokensByRelevance(tokens: MayanToken[], chainId: SourceChainId): MayanToken[] {
  return [...tokens].sort((left, right) => {
    const scoreDiff = tokenRelevanceScore(left, chainId) - tokenRelevanceScore(right, chainId);
    if (scoreDiff !== 0) return scoreDiff;
    return tokenSortLabel(left).localeCompare(tokenSortLabel(right), undefined, { sensitivity: 'base' });
  });
}

function tokenRelevanceScore(token: MayanToken, chainId: SourceChainId): number {
  const symbol = normalizedTokenSymbol(token);
  const priorityIndex = TOKEN_RELEVANCE_BY_CHAIN[chainId]?.findIndex((candidate) => candidate.toUpperCase() === symbol) ?? -1;
  let score = priorityIndex >= 0 ? priorityIndex * 100 : 10_000;

  if (isConfiguredUsdc(token, chainId)) score -= 500;
  if (isNativeToken(token, chainId)) score -= 350;
  if (STABLE_TOKEN_SYMBOLS.has(symbol)) score -= 300;
  if (BLUE_CHIP_TOKEN_SYMBOLS.has(symbol)) score -= 220;
  if (token.verified) score -= 80;
  else score += 150;
  if (token.logoURI) score -= 20;
  if (!token.symbol && !token.name) score += 200;

  return score;
}

function isConfiguredUsdc(token: MayanToken, chainId: SourceChainId): boolean {
  const configuredUsdc = CHAINS[chainId].usdc;
  const address = tokenAddress(token);
  return Boolean(
    configuredUsdc &&
      address &&
      address.toLowerCase() === String(configuredUsdc).toLowerCase(),
  );
}

function isNativeToken(token: MayanToken, chainId: SourceChainId): boolean {
  const nativeSymbol = CHAINS[chainId].nativeCurrency?.toUpperCase();
  const symbol = normalizedTokenSymbol(token);
  const standard = token.standard?.toLowerCase();
  return Boolean(
    nativeSymbol &&
      (symbol === nativeSymbol ||
        symbol === `W${nativeSymbol}` ||
        token.contract?.toLowerCase() === EVM_NATIVE_TOKEN ||
        standard === 'native'),
  );
}

function normalizedTokenSymbol(token: MayanToken): string {
  return (token.symbol ?? '').trim().toUpperCase();
}

function tokenSortLabel(token: MayanToken): string {
  return token.symbol ?? token.name ?? tokenAddress(token) ?? '';
}

function tokenAddress(token?: MayanToken): string | undefined {
  return token?.contract ?? token?.mint;
}

function selectableMayanChains(direction: SwapDirection): readonly SourceChainId[] {
  const chains = direction === FORWARD_DIRECTION ? MAYAN_SWIFT_EVM_SOURCE_CHAINS : MAYAN_SWIFT_SOURCE_CHAINS;
  return [...chains, 'solana'];
}

function defaultMayanChain(direction: SwapDirection): SourceChainId {
  const chains = selectableMayanChains(direction);
  return chains.includes(DEFAULT_MAYAN_CHAIN) ? DEFAULT_MAYAN_CHAIN : chains[0];
}

function formatReceivePreview({
  direction,
  quote,
  token,
}: {
  direction: SwapDirection;
  quote: Quote | null;
  token?: MayanToken;
}): string {
  if (!quote) return direction === FORWARD_DIRECTION ? '0.000000' : '0.00';
  if (direction === FORWARD_DIRECTION) return formatXmr(quote.estimatedXmrOut);
  return formatBaseUnits(quote.estimatedDestinationOut ?? '0', quote.destinationTokenDecimals ?? token?.decimals ?? 6);
}

function getPrimaryLabel({
  quote,
  order,
  isLoading,
  isQuoteRefreshing,
  quoteExpired,
  canCreateOrder,
}: {
  quote: Quote | null;
  order: Order | null;
  isLoading: boolean;
  isQuoteRefreshing: boolean;
  quoteExpired: boolean;
  canCreateOrder: boolean;
}): string {
  if (isLoading) return quote ? 'Creating order...' : 'Fetching route...';
  if (order) return 'Order created';
  if (quote && isQuoteRefreshing) return 'Updating quote...';
  if (quoteExpired) return 'Refresh quote';
  if (quote && !canCreateOrder) return 'Enter XMR address';
  if (quote) return 'Create order';
  return 'Preview exchange';
}

function getPrimaryDisabled({
  canPreviewQuote,
  canCreateOrder,
  quote,
  order,
  isLoading,
  isQuoteRefreshing,
  quoteExpired,
}: {
  canPreviewQuote: boolean;
  canCreateOrder: boolean;
  quote: Quote | null;
  order: Order | null;
  isLoading: boolean;
  isQuoteRefreshing: boolean;
  quoteExpired: boolean;
}): boolean {
  if (isLoading || isQuoteRefreshing || order) return true;
  if (quote && !quoteExpired) return !canCreateOrder;
  return !canPreviewQuote;
}

function useCountdown(expiresAt?: string): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
}

function parseTokenAmount(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!trimmed) return BigInt(0);
  const [whole, fraction = ''] = trimmed.split('.');
  const safeWhole = whole.replace(/\D/g, '') || '0';
  const safeFraction = fraction.replace(/\D/g, '').slice(0, decimals).padEnd(decimals, '0');
  return BigInt(safeWhole) * BigInt(10) ** BigInt(decimals) + BigInt(safeFraction || '0');
}

function formatBaseUnits(value: string, decimals: number, maxFractionDigits = 6): string {
  const amount = BigInt(value);
  const unit = BigInt(10) ** BigInt(decimals);
  const whole = amount / unit;
  const fraction = (amount % unit).toString().padStart(decimals, '0').slice(0, maxFractionDigits).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function formatXmr(value: string): string {
  const amount = BigInt(value);
  const unit = BigInt(1_000_000_000_000);
  const whole = amount / unit;
  const fraction = (amount % unit).toString().padStart(12, '0').slice(0, 6);
  return `${whole}.${fraction}`;
}

function formatBps(value: number): string {
  const percent = value / 100;
  return `${percent.toFixed(4).replace(/\.?0+$/, '')}%`;
}

function formatCountdown(value: number | null): string {
  if (value === null) return '--:--';
  const minutes = Math.floor(value / 60).toString();
  const seconds = (value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function orderInputDecimals(order: Order): number {
  return order.direction === REVERSE_DIRECTION
    ? XMR_DECIMALS
    : order.funding.type === 'mayan-swift'
      ? order.funding.tokenDecimals ?? 6
      : order.funding.type === 'solana-transfer'
        ? order.funding.tokenDecimals ?? 6
      : 6;
}

function isPotentialSolanaAddress(value: string): boolean {
  if (!value.trim()) return false;
  try {
    new PublicKey(value.trim());
    return true;
  } catch {
    return false;
  }
}

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function shortId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function setOrderUrl(orderId: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('order', orderId);
  window.history.replaceState(null, '', url.toString());
}

function clearOrderUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('order');
  window.history.replaceState(null, '', url.toString());
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const apiPath = path.startsWith('/') ? path : `/${path}`;
  const response = await fetch(`${ORCHESTRATOR_URL}${apiPath}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

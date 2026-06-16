'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CHAINS,
  ERC20_ALLOWANCE_ABI,
  ERC20_APPROVE_ABI,
  MAYAN_SWIFT_EVM_SOURCE_CHAINS,
  isValidMoneroAddress,
  type FundingInstructions,
  type MayanEvmTxPayload,
  type MayanToken,
  type Order,
  type Quote,
  type SourceChainId,
} from '@wxmr/core';
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
const TOKEN_RELEVANCE_BY_CHAIN: Partial<Record<SourceChainId, readonly string[]>> = {
  ethereum: ['ETH', 'WETH', 'USDC', 'USDT', 'WBTC', 'DAI', 'LINK', 'UNI', 'AAVE', 'ENA', 'PEPE', 'SHIB'],
  base: ['ETH', 'WETH', 'USDC', 'cbBTC', 'USDT', 'EURC', 'AERO', 'VIRTUAL', 'MORPHO', 'DEGEN', 'BRETT'],
  arbitrum: ['ETH', 'WETH', 'USDC', 'USDT', 'WBTC', 'ARB', 'GMX', 'LINK', 'PENDLE', 'DAI'],
  optimism: ['ETH', 'WETH', 'USDC', 'USDT', 'OP', 'WLD', 'SNX', 'VELO', 'DAI'],
  polygon: ['POL', 'MATIC', 'USDC', 'WETH', 'USDT', 'WBTC', 'DAI', 'AAVE', 'LINK'],
  avalanche: ['AVAX', 'WAVAX', 'USDC', 'USDT', 'BTC.b', 'WETH.e', 'JOE', 'QI'],
  bsc: ['BNB', 'WBNB', 'USDT', 'USDC', 'BTCB', 'ETH', 'FDUSD', 'CAKE'],
  linea: ['ETH', 'WETH', 'USDC', 'USDT', 'DAI', 'ZERO'],
  hyperevm: ['HYPE', 'WHYPE', 'USDC', 'UBTC', 'PURR'],
  monad: ['MON', 'WMON', 'USDC', 'USDT', 'WETH', 'WBTC'],
  sui: ['SUI', 'USDC', 'USDT', 'WAL', 'DEEP', 'CETUS'],
  hyperliquid: ['USDC', 'HYPE', 'PURR'],
} as const;
const STABLE_TOKEN_SYMBOLS = new Set(['USDC', 'USDC.E', 'USDCE', 'USDT', 'DAI', 'USDE', 'USDS', 'FRAX', 'FDUSD', 'PYUSD', 'EURC']);
const BLUE_CHIP_TOKEN_SYMBOLS = new Set([
  'ETH',
  'WETH',
  'BTC',
  'WBTC',
  'CBBTC',
  'BTCB',
  'SOL',
  'WSOL',
  'BNB',
  'WBNB',
  'AVAX',
  'WAVAX',
  'POL',
  'MATIC',
  'LINK',
  'AAVE',
  'UNI',
  'HYPE',
  'WHYPE',
  'MON',
  'WMON',
  'SUI',
]);

type RouteLeg = {
  title: string;
  caption: string;
  amount: string;
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
  const [sourceChain, setSourceChain] = useState<SourceChainId>('base');
  const [sourceTokens, setSourceTokens] = useState<MayanToken[]>([]);
  const [sourceToken, setSourceToken] = useState('');
  const [amount, setAmount] = useState('');
  const [xmrAddress, setXmrAddress] = useState('');
  const [refundAddress, setRefundAddress] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isTokenPickerOpen, setIsTokenPickerOpen] = useState(false);
  const [tokenSearch, setTokenSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

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
        setSourceChain(next.sourceChain);
        setSourceToken(next.sourceToken);
        setAmount(formatBaseUnits(next.amount, orderTokenDecimals(next)));
        setXmrAddress(next.xmrAddress);
        setRefundAddress(next.refundAddress ?? '');
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
    let cancelled = false;
    setSourceTokens([]);
    setTokenSearch('');
    api<MayanToken[]>(`/tokens/${sourceChain}`)
      .then((tokens) => {
        if (cancelled) return;
        const sortedTokens = sortTokensByRelevance(tokens, sourceChain);
        setSourceTokens(sortedTokens);
        const preferred = sortedTokens[0];
        setSourceToken((current) =>
          sortedTokens.some((token) => token.contract === current) ? current : preferred?.contract ?? '',
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
    () => sourceTokens.find((token) => token.contract === sourceToken),
    [sourceToken, sourceTokens],
  );
  const sourceTokenDecimals = selectedToken?.decimals ?? 6;
  const parsedAmount = useMemo(() => parseTokenAmount(amount, sourceTokenDecimals), [amount, sourceTokenDecimals]);
  const canQuote = Boolean(sourceToken) && parsedAmount > BigInt(0) && isValidMoneroAddress(xmrAddress);
  const quoteExpiresIn = useCountdown(quote?.expiresAt);
  const quoteExpired = quoteExpiresIn === 0;
  const routeLegs = buildRouteLegs({ quote, selectedToken, sourceChain, amount, sourceTokenDecimals });
  const primaryLabel = getPrimaryLabel({ quote, order, isLoading, quoteExpired });
  const primaryDisabled = getPrimaryDisabled({ canQuote, quote, order, isLoading, quoteExpired });
  const receivePreview = quote ? formatXmr(quote.estimatedXmrOut) : '0.000000';

  const resetTrade = () => {
    setQuote(null);
    setOrder(null);
    clearOrderUrl();
  };

  const requestQuote = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const next = await api<Quote>('/quote', {
        method: 'POST',
        body: JSON.stringify({
          sourceChain,
          sourceToken,
          amount: parsedAmount.toString(),
          xmrAddress,
          refundAddress: refundAddress || undefined,
          slippageBps: 100,
        }),
      });
      setQuote(next);
      setOrder(null);
      clearOrderUrl();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setIsLoading(false);
    }
  };

  const createOrder = async () => {
    if (!quote) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await api<{ order: Order; funding: FundingInstructions }>('/orders', {
        method: 'POST',
        body: JSON.stringify({ quoteId: quote.id, refundAddress: refundAddress || undefined }),
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
            <h1 className="truncate text-xl font-semibold text-white">Swap to native XMR</h1>
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
                <div className="text-xs text-[var(--muted)]">No account. One wallet transaction.</div>
              </div>
              <div className="grid grid-cols-2 rounded-xl bg-[#0b0c10] p-1 text-xs">
                <button className="rounded-lg bg-[#f26822] px-3 py-2 font-semibold text-white">Market</button>
                <button className="rounded-lg px-3 py-2 text-[#8f949d]" disabled>
                  Fixed
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-4 p-4 md:p-5">
            <TradeAmountPanel
              amount={amount}
              chainId={sourceChain}
              token={selectedToken}
              tokenCount={sourceTokens.length}
              onAmountChange={(next) => {
                setAmount(next);
                resetTrade();
              }}
              onChainChange={(next) => {
                setSourceChain(next);
                resetTrade();
              }}
              onOpenTokenPicker={() => setIsTokenPickerOpen(true)}
            />

            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-[#2d3037] bg-[#15161b] text-lg text-[#f26822]">
              v
            </div>

            <ReceivePanel value={receivePreview} quote={quote} />

            <RecipientPanel
              xmrAddress={xmrAddress}
              refundAddress={refundAddress}
              onXmrAddressChange={(next) => {
                setXmrAddress(next);
                resetTrade();
              }}
              onRefundAddressChange={setRefundAddress}
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
          tokens={sourceTokens}
          selectedToken={sourceToken}
          search={tokenSearch}
          onSearchChange={setTokenSearch}
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

function TradeAmountPanel({
  amount,
  chainId,
  token,
  tokenCount,
  onAmountChange,
  onChainChange,
  onOpenTokenPicker,
}: {
  amount: string;
  chainId: SourceChainId;
  token?: MayanToken;
  tokenCount: number;
  onAmountChange: (value: string) => void;
  onChainChange: (value: SourceChainId) => void;
  onOpenTokenPicker: () => void;
}) {
  return (
    <div className="rounded-2xl border border-[#292b31] bg-[#0c0d11] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm text-[#9aa0aa]">You send</div>
        <ChainSelect value={chainId} onChange={onChainChange} />
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
            <span className="block truncate text-[11px] text-[#8f949d]">{tokenCount ? `${tokenCount} assets` : 'Loading'}</span>
          </span>
          <span className="text-[#8f949d]">v</span>
        </button>
      </div>
    </div>
  );
}

function ReceivePanel({ value, quote }: { value: string; quote: Quote | null }) {
  return (
    <div className="rounded-2xl border border-[#292b31] bg-[#0c0d11] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm text-[#9aa0aa]">You get</div>
        <div className="rounded-full border border-[#30333b] bg-[#17191f] px-3 py-1 text-xs text-[#9aa0aa]">
          Native Monero
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 text-4xl font-semibold text-white md:text-5xl">{value}</div>
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

function ChainSelect({
  value,
  onChange,
}: {
  value: SourceChainId;
  onChange: (value: SourceChainId) => void;
}) {
  return (
    <label className="relative">
      <span className="sr-only">Source chain</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as SourceChainId)}
        className="appearance-none rounded-full border border-[#30333b] bg-[#17191f] py-2 pl-3 pr-8 text-xs font-medium text-white outline-none transition-colors hover:border-[#f26822] focus:border-[#f26822]"
      >
        {MAYAN_SWIFT_EVM_SOURCE_CHAINS.map((chain) => (
          <option key={chain} value={chain}>{CHAINS[chain].name}</option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#8f949d]">v</span>
    </label>
  );
}

function RecipientPanel({
  xmrAddress,
  refundAddress,
  onXmrAddressChange,
  onRefundAddressChange,
}: {
  xmrAddress: string;
  refundAddress: string;
  onXmrAddressChange: (value: string) => void;
  onRefundAddressChange: (value: string) => void;
}) {
  const addressOk = !xmrAddress || isValidMoneroAddress(xmrAddress);

  return (
    <div className="grid gap-3 rounded-2xl border border-[#292b31] bg-[#0f1015] p-4">
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
    </div>
  );
}

function TokenPicker({
  chainId,
  tokens,
  selectedToken,
  search,
  onSearchChange,
  onClose,
  onSelect,
}: {
  chainId: SourceChainId;
  tokens: MayanToken[];
  selectedToken: string;
  search: string;
  onSearchChange: (value: string) => void;
  onClose: () => void;
  onSelect: (contract: string) => void;
}) {
  const filteredTokens = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return tokens;
    return tokens.filter((token) =>
      [token.symbol, token.name, token.contract]
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
              <div className="text-xs text-[#8f949d]">{CHAINS[chainId].name}</div>
            </div>
            <button onClick={onClose} className="rounded-full border border-[#30333b] px-3 py-2 text-sm text-[#c8cbd1] hover:border-[#f26822]">
              Close
            </button>
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
            const contract = token.contract ?? '';
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
  const sourceDecimals = quote.sourceTokenDecimals ?? mayan?.quote.fromToken.decimals ?? 6;
  const sourceSymbol = quote.sourceTokenSymbol ?? mayan?.quote.fromToken.symbol ?? 'Token';

  return (
    <div className="rounded-2xl border border-[#292b31] bg-[#101116] p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">Quote ready</div>
          <div className="text-xs text-[#8f949d]">{quote.routeSummary ?? 'Mayan Swift v2 route'}</div>
        </div>
        <div className={`rounded-full px-3 py-1 text-xs font-semibold ${quoteExpired ? 'bg-[#351919] text-[#ff8c8c]' : 'bg-[#142316] text-[#9ee6a8]'}`}>
          {quoteExpired ? 'Expired' : `Locks ${formatCountdown(quoteExpiresIn)}`}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Sending" value={`${formatBaseUnits(quote.inputAmount, sourceDecimals)} ${sourceSymbol}`} />
        <Metric label="Mayan delivers" value={`${formatUsdc(mayan?.expectedSolanaUsdcOut ?? quote.inputAmount)} USDC-SOL`} />
        <Metric label="Minimum XMR" value={`${formatXmr(quote.minXmrOut)} XMR`} />
        <Metric label="Fees" value={`${formatBps(mayan?.protocolBps ?? 0)} Mayan + ${formatBps(quote.bridgeFeeBps)} bridge`} />
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
          {quote?.mayan?.clientEta ?? 'Live quote'}
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
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-white">{leg.title}</div>
                  <div className="truncate text-xs text-[#8f949d]">{leg.caption}</div>
                </div>
                <div className="shrink-0 text-right text-xs text-[#f2a269]">{leg.amount}</div>
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
  return (
    <div className="rounded-2xl border border-[#292b31] bg-[#101116] p-4 text-sm text-[#c8cbd1]">
      Unsupported funding route.
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
  const steps = [
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
            {steps.map((step) => {
              const isActive = step.statuses.includes(order.status);
              const isDone = order.status === 'completed' || stepDone(step.label, order.status);
              return (
                <div key={step.label} className="flex items-center gap-3">
                  <div className={`h-3 w-3 rounded-full ${isDone ? 'bg-[#f26822]' : isActive ? 'bg-[#35d071]' : 'bg-[#343842]'}`} />
                  <span className={isDone || isActive ? 'text-sm text-white' : 'text-sm text-[#707680]'}>{step.label}</span>
                </div>
              );
            })}
          </div>
          <div className="grid gap-2 rounded-2xl border border-[#292b31] bg-[#0c0d11] p-3 text-sm">
            {order.sourceTxHash && <ExplorerLink chain={order.sourceChain} hash={order.sourceTxHash} label="Source transaction" />}
            {order.solanaMintSignature && <ExplorerLink chain="solana" hash={order.solanaMintSignature} label="Mayan delivery" />}
            {order.swapSignature && <ExplorerLink chain="solana" hash={order.swapSignature} label="Jupiter swap" />}
            {order.withdrawalSignature && <ExplorerLink chain="solana" hash={order.withdrawalSignature} label="Withdrawal request" />}
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
      <div className="mt-1 truncate text-sm font-semibold text-white">{value}</div>
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
  return (
    <a
      href={`${CHAINS[chain].explorerTxUrl}${hash}`}
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
  quote,
  selectedToken,
  sourceChain,
  amount,
  sourceTokenDecimals,
}: {
  quote: Quote | null;
  selectedToken?: MayanToken;
  sourceChain: SourceChainId;
  amount: string;
  sourceTokenDecimals: number;
}): RouteLeg[] {
  const sourceSymbol = quote?.sourceTokenSymbol ?? selectedToken?.symbol ?? 'Token';
  const sourceAmount = quote
    ? formatBaseUnits(quote.inputAmount, quote.sourceTokenDecimals ?? sourceTokenDecimals)
    : amount || '0';
  const usdcOut = quote?.mayan?.expectedSolanaUsdcOut ? `${formatUsdc(quote.mayan.expectedSolanaUsdcOut)} USDC` : 'USDC-SOL';
  const xmrOut = quote ? `${formatXmr(quote.estimatedXmrOut)} XMR` : 'XMR-SOL';
  return [
    {
      title: `${sourceSymbol} on ${CHAINS[sourceChain].name}`,
      caption: 'Wallet-signed source transaction',
      amount: `${sourceAmount} ${sourceSymbol}`,
      detail: 'You keep custody until your wallet submits the Mayan Swift order.',
    },
    {
      title: 'Mayan Swift v2',
      caption: 'Cross-chain delivery to Solana',
      amount: usdcOut,
      detail: 'Mayan routes the source asset into USDC on Solana for the hot wallet.',
    },
    {
      title: 'jup.ag',
      caption: 'USDC-SOL to XMR-SOL',
      amount: xmrOut,
      detail: 'Jupiter executes the Solana swap with the quote minimum enforced.',
    },
    {
      title: 'Monero Bridge',
      caption: 'XMR-SOL to native XMR',
      amount: quote ? `${formatXmr(quote.minXmrOut)} min` : 'Native XMR',
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
  return Boolean(
    configuredUsdc &&
      token.contract &&
      token.contract.toLowerCase() === String(configuredUsdc).toLowerCase(),
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
  return token.symbol ?? token.name ?? token.contract ?? '';
}

function getPrimaryLabel({
  quote,
  order,
  isLoading,
  quoteExpired,
}: {
  quote: Quote | null;
  order: Order | null;
  isLoading: boolean;
  quoteExpired: boolean;
}): string {
  if (isLoading) return quote ? 'Creating order...' : 'Fetching route...';
  if (order) return 'Order created';
  if (quoteExpired) return 'Refresh quote';
  if (quote) return 'Create order';
  return 'Preview exchange';
}

function getPrimaryDisabled({
  canQuote,
  quote,
  order,
  isLoading,
  quoteExpired,
}: {
  canQuote: boolean;
  quote: Quote | null;
  order: Order | null;
  isLoading: boolean;
  quoteExpired: boolean;
}): boolean {
  if (isLoading || order) return true;
  if (quote && !quoteExpired) return false;
  return !canQuote;
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

function formatUsdc(value: string): string {
  return formatBaseUnits(value, 6);
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

function orderTokenDecimals(order: Order): number {
  return order.funding.type === 'mayan-swift' ? order.funding.tokenDecimals ?? 6 : 6;
}

function stepDone(label: string, status: Order['status']): boolean {
  const order = ['Deposit', 'Bridge', 'Swap', 'Payout'];
  const current = status === 'bridging' || status === 'minted'
    ? 'Bridge'
    : status === 'swapping'
      ? 'Swap'
      : status === 'withdrawing' || status === 'completed'
        ? 'Payout'
        : 'Deposit';
  return order.indexOf(label) < order.indexOf(current);
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

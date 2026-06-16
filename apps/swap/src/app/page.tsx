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

function MoneroLogo({ className = 'w-8 h-8' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 3756.09 3756.49" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M4128,2249.81C4128,3287,3287.26,4127.86,2250,4127.86S372,3287,372,2249.81,1212.76,371.75,2250,371.75,4128,1212.54,4128,2249.81Z" transform="translate(-371.96 -371.75)" fill="#fff"/>
      <path d="M2250,371.75c-1036.89,0-1879.12,842.06-1877.8,1878,0.26,207.26,33.31,406.63,95.34,593.12h561.88V1263L2250,2483.57,3470.52,1263v1579.9h562c62.12-186.48,95-385.85,95.37-593.12C4129.66,1212.76,3287,372,2250,372Z" transform="translate(-371.96 -371.75)" fill="#f26822"/>
      <path d="M1969.3,2764.17l-532.67-532.7v994.14H1029.38l-384.29.07c329.63,540.8,925.35,902.56,1604.91,902.56S3525.31,3766.4,3855,3225.6H3063.25V2231.47l-532.7,532.7-280.61,280.61-280.62-280.61h0Z" transform="translate(-371.96 -371.75)" fill="#4d4d4d"/>
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
    api<MayanToken[]>(`/tokens/${sourceChain}`)
      .then((tokens) => {
        if (cancelled) return;
        setSourceTokens(tokens);
        const preferred = tokens.find((token) => token.symbol?.toUpperCase() === 'USDC') ?? tokens[0];
        setSourceToken((current) =>
          tokens.some((token) => token.contract === current) ? current : preferred?.contract ?? '',
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
    <main className="min-h-screen flex flex-col xmr-pattern">
      <header className="flex justify-between items-center gap-4 max-w-6xl w-full mx-auto px-4 md:px-8 py-5">
        <div className="flex items-center gap-3">
          <MoneroLogo className="w-9 h-9" />
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-[#ff6600] to-[#ff8533] bg-clip-text text-transparent">
              Swap to native XMR
            </h1>
            <p className="text-xs text-[var(--muted)]">Mayan-supported tokens to Monero</p>
          </div>
        </div>
        <div className="hidden sm:block text-xs text-gray-500">Mayan Swift v2 route</div>
      </header>

      <section className="flex-1 w-full max-w-6xl mx-auto px-4 md:px-8 py-6 grid lg:grid-cols-[1fr_360px] gap-6 items-start">
        <div className="bg-[#1a1a2e] border border-[#2a2a4a] rounded-2xl shadow-2xl overflow-hidden">
          <div className="p-5 border-b border-[#2a2a4a]">
            <h2 className="text-lg font-semibold text-white">Cross-chain exchange</h2>
          </div>
          <div className="p-5 space-y-5">
            <label className="block">
              <span className="text-sm text-gray-400">Source chain</span>
              <select
                value={sourceChain}
                onChange={(event) => {
                  setSourceChain(event.target.value as SourceChainId);
                  setQuote(null);
                  setOrder(null);
                }}
                className="mt-2 w-full bg-[#12121f] border border-[#2a2a4a] rounded-xl px-3 py-3 text-white outline-none focus:border-[#ff6600]"
              >
                {MAYAN_SWIFT_EVM_SOURCE_CHAINS.map((chain) => (
                  <option key={chain} value={chain}>{CHAINS[chain].name}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm text-gray-400">Source token</span>
              <select
                value={sourceToken}
                onChange={(event) => {
                  setSourceToken(event.target.value);
                  setQuote(null);
                  setOrder(null);
                }}
                className="mt-2 w-full bg-[#12121f] border border-[#2a2a4a] rounded-xl px-3 py-3 text-white outline-none focus:border-[#ff6600]"
              >
                {sourceTokens.map((token) => (
                  <option key={token.contract} value={token.contract}>
                    {token.symbol ?? token.contract} {token.name ? `- ${token.name}` : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm text-gray-400">Amount</span>
              <div className="mt-2 flex items-center gap-3 bg-[#12121f] border border-[#2a2a4a] rounded-xl px-3 py-3">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.target.value);
                    setQuote(null);
                    setOrder(null);
                  }}
                  placeholder="0.00"
                  className="flex-1 min-w-0 bg-transparent text-3xl font-medium text-white outline-none placeholder-gray-600"
                />
                <span className="text-sm font-semibold text-white bg-[#2a2a4a] rounded-lg px-3 py-2">
                  {selectedToken?.symbol ?? 'TOKEN'}
                </span>
              </div>
            </label>

            <label className="block">
              <span className="text-sm text-gray-400">Monero address</span>
              <textarea
                value={xmrAddress}
                onChange={(event) => {
                  setXmrAddress(event.target.value.trim());
                  setQuote(null);
                  setOrder(null);
                }}
                rows={3}
                className="mt-2 w-full resize-none bg-[#12121f] border border-[#2a2a4a] rounded-xl px-3 py-3 text-white outline-none focus:border-[#ff6600] text-sm"
              />
            </label>

            <label className="block">
              <span className="text-sm text-gray-400">Solana refund address</span>
              <input
                value={refundAddress}
                onChange={(event) => setRefundAddress(event.target.value.trim())}
                className="mt-2 w-full bg-[#12121f] border border-[#2a2a4a] rounded-xl px-3 py-3 text-white outline-none focus:border-[#ff6600] text-sm"
              />
            </label>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={requestQuote}
                disabled={!canQuote || isLoading}
                className="flex-1 bg-[#ff6600] hover:bg-[#ff7a1a] disabled:bg-[#3a3a4f] disabled:text-gray-500 text-white font-semibold rounded-xl px-4 py-3 transition-colors"
              >
                {isLoading ? 'Working...' : 'Get quote'}
              </button>
              <button
                onClick={createOrder}
                disabled={!quote || Boolean(order) || isLoading}
                className="flex-1 bg-[#2a2a4a] hover:bg-[#34345f] disabled:bg-[#202033] disabled:text-gray-600 text-white font-semibold rounded-xl px-4 py-3 transition-colors"
              >
                Create order
              </button>
            </div>

            {error && <div className="border border-red-500/40 bg-red-500/10 rounded-xl p-3 text-sm text-red-200">{error}</div>}

            {quote && <QuotePanel quote={quote} />}
            {order?.status === 'awaiting_deposit' && (
              <FundingPanel
                order={order}
                onDeposit={reportDeposit}
                onError={(message) => setError(message)}
              />
            )}
          </div>
        </div>

        <OrderStatusPanel order={order} />
      </section>
    </main>
  );
}

function QuotePanel({ quote }: { quote: Quote }) {
  const mayan = quote.mayan;
  const fromToken = mayan?.quote.fromToken.symbol ?? quote.sourceToken;
  const toToken = mayan?.quote.toToken.symbol ?? 'USDC';
  const routeTitle = mayan ? 'Mayan Swift v2' : quote.route;
  const protocolFee = mayan?.protocolBps === undefined ? 'Included' : `${formatBps(mayan.protocolBps)}`;
  const sourceDecimals = quote.sourceTokenDecimals ?? mayan?.quote.fromToken.decimals ?? 6;

  return (
    <div className="border border-[#2a2a4a] bg-[#12121f] rounded-xl p-4 space-y-4 text-sm">
      {quote.routeSummary && (
        <div>
          <div className="text-gray-400">Route</div>
          <div className="text-white font-semibold">{quote.routeSummary}</div>
        </div>
      )}
      <div className="grid sm:grid-cols-3 gap-3">
        <Metric label="Router" value={routeTitle} />
        <Metric label="ETA" value={mayan?.clientEta ?? (mayan?.etaSeconds ? `${mayan.etaSeconds}s` : 'Quoted live')} />
        <Metric label="Mayan fee" value={protocolFee} />
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Metric label="Source" value={`${formatBaseUnits(quote.inputAmount, sourceDecimals)} ${fromToken} on ${CHAINS[quote.sourceChain].name}`} />
        <Metric label="Solana delivery" value={`${formatUsdc(mayan?.expectedSolanaUsdcOut ?? quote.inputAmount)} ${toToken}`} />
      </div>
      <div className="grid sm:grid-cols-4 gap-3">
        <Metric label="Min Solana USDC" value={`${formatUsdc(mayan?.minSolanaUsdcOut ?? quote.inputAmount)} ${toToken}`} />
        <Metric label="Estimated payout" value={`${formatXmr(quote.estimatedXmrOut)} XMR`} />
        <Metric label="Minimum payout" value={`${formatXmr(quote.minXmrOut)} XMR`} />
        <Metric label="XMR bridge fee" value={formatBps(quote.bridgeFeeBps)} />
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
    <div className="border border-[#2a2a4a] rounded-xl p-4 text-sm text-gray-300">
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
    <div className="border border-[#2a2a4a] bg-[#12121f] rounded-xl p-4 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm text-gray-400">EVM wallet</div>
          <div className="text-white text-sm truncate">{address || 'Not connected'}</div>
        </div>
        <button
          onClick={() => (address ? disconnect() : setShowConnect(true))}
          className="bg-[#2a2a4a] hover:bg-[#34345f] text-white rounded-lg px-3 py-2 text-sm"
        >
          {address ? 'Disconnect' : 'Connect'}
        </button>
      </div>
      <button
        onClick={fund}
        disabled={isFunding}
        className="w-full bg-[#ff6600] hover:bg-[#ff7a1a] disabled:bg-[#3a3a4f] text-white font-semibold rounded-xl px-4 py-3"
      >
        {isFunding ? 'Waiting for wallet...' : 'Start Mayan Swift swap'}
      </button>
      {showConnect && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setShowConnect(false)}>
          <div className="w-full max-w-sm bg-[#1a1a2e] border border-[#2a2a4a] rounded-2xl p-4" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white font-semibold">Connect wallet</h3>
              <button onClick={() => setShowConnect(false)} className="text-gray-400 hover:text-white">×</button>
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
                  className="w-full text-left bg-[#12121f] hover:bg-[#2a2a4a] border border-[#2a2a4a] rounded-xl px-3 py-3 text-white"
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
    ['Deposit', ['awaiting_deposit']],
    ['Bridge', ['bridging', 'minted']],
    ['Swap', ['swapping']],
    ['Payout', ['withdrawing', 'completed']],
  ] as const;

  return (
    <aside className="bg-[#1a1a2e] border border-[#2a2a4a] rounded-2xl shadow-2xl p-5">
      <h2 className="text-lg font-semibold text-white mb-4">Order status</h2>
      {!order ? (
        <div className="text-sm text-gray-400">No active order</div>
      ) : (
        <div className="space-y-4">
          <div className="text-sm">
            <div className="text-gray-400">Order</div>
            <div className="text-white break-all">{order.id}</div>
          </div>
          <div className="space-y-3">
            {steps.map(([label, statuses]) => {
              const isActive = statuses.includes(order.status as never);
              const isDone = order.status === 'completed' || stepDone(label, order.status);
              return (
                <div key={label} className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${isDone ? 'bg-[#ff6600]' : isActive ? 'bg-white' : 'bg-[#3a3a4f]'}`} />
                  <span className={isDone || isActive ? 'text-white' : 'text-gray-500'}>{label}</span>
                </div>
              );
            })}
          </div>
          <div className="text-sm">
            <div className="text-gray-400">Current</div>
            <div className="text-white">{order.status}</div>
          </div>
          {order.sourceTxHash && <ExplorerLink chain={order.sourceChain} hash={order.sourceTxHash} label="Source transaction" />}
          {order.solanaMintSignature && <ExplorerLink chain="solana" hash={order.solanaMintSignature} label="Mayan delivery" />}
          {order.swapSignature && <ExplorerLink chain="solana" hash={order.swapSignature} label="Jupiter swap" />}
          {order.withdrawalSignature && <ExplorerLink chain="solana" hash={order.withdrawalSignature} label="Withdrawal request" />}
          {order.error && <div className="text-sm text-red-200 break-words">{order.error}</div>}
        </div>
      )}
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-gray-400">{label}</div>
      <div className="text-white font-semibold">{value}</div>
    </div>
  );
}

function ExplorerLink({ chain, hash, label }: { chain: SourceChainId; hash: string; label: string }) {
  return (
    <a
      href={`${CHAINS[chain].explorerTxUrl}${hash}`}
      target="_blank"
      rel="noreferrer"
      className="block text-sm text-[#ff8533] hover:text-[#ff6600] break-words"
    >
      {label}
    </a>
  );
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

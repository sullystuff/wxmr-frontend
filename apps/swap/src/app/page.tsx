'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CHAINS,
  ERC20_ALLOWANCE_ABI,
  ERC20_APPROVE_ABI,
  MAYAN_SWIFT_EVM_SOURCE_CHAINS,
  MAYAN_SWIFT_SOURCE_CHAINS,
  MIN_XMR_DEPOSIT_PICONERO,
  MIN_XMR_WITHDRAWAL_PICONERO,
  WXMR_MINT_ADDRESS,
  XMR_DECIMALS,
  filterMayanTokensForChain,
  formatXmrAmount,
  isValidMoneroAddress,
  quoteHasPositiveOutput,
  type ExecutionPolicy,
  type FundingInstructions,
  type FundingMode,
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
import { PublicKey, Transaction, TransactionInstruction, VersionedTransaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import {
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
  useSendTransaction,
  useSwitchChain,
  useWriteContract,
  type Connector,
} from 'wagmi';
import { EVM_RPC_ENV_BY_CHAIN, EVM_RPC_URL_BY_CHAIN } from './evm-rpc';
import { AddressDepositFunding, DepositMethodToggle } from './address-deposit';

const ORCHESTRATOR_URL = (process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || '/api').replace(/\/$/, '');
const EVM_NATIVE_TOKEN = '0x0000000000000000000000000000000000000000';
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const FORWARD_DIRECTION: SwapDirection = 'mayan-to-xmr';
const REVERSE_DIRECTION: SwapDirection = 'xmr-to-mayan';
const ASSET_DIRECTION: SwapDirection = 'asset-to-asset';
const DEFAULT_MAYAN_CHAIN: SourceChainId = 'ethereum';
const DEFAULT_DESTINATION_CHAIN: SourceChainId = 'monero';
const DEFAULT_EXECUTION_POLICY: ExecutionPolicy = 'execute-anyway';
const DEFAULT_SLIPPAGE_BPS = 200;
const AUTO_REFRESH_QUOTE_MS = 10_000;
const QUOTE_PLACEHOLDER_XMR_ADDRESS = '45ZYpKmPaPmh3bnRP1XpMz8cASJQf1cfUgq32H8trCYA4RodzXhsmt2VYkQX9QQ65CetiGja65tH2JmKC3gEZtZjB7AzMpd';
// Bridge minimums, mirrored from the on-chain program via @wxmr/core.
const MIN_XMR_DEPOSIT_XMR = formatXmrAmount(MIN_XMR_DEPOSIT_PICONERO);
const MIN_XMR_WITHDRAWAL_XMR = formatXmrAmount(MIN_XMR_WITHDRAWAL_PICONERO);
const QUOTE_PLACEHOLDER_SOLANA_ADDRESS = '9wtvVxue6wfwVf27cG11tyfQXyHZnyz5gHR5okWh26sX';
const QUOTE_PLACEHOLDER_EVM_ADDRESS = '0x000000000000000000000000000000000000dEaD';
const QUOTE_PLACEHOLDER_SUI_ADDRESS = `0x${'1'.repeat(64)}`;
const QUOTE_PLACEHOLDER_BTC_ADDRESS = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const TOKEN_RELEVANCE_BY_CHAIN: Partial<Record<SourceChainId, readonly string[]>> = {
  bitcoin: ['BTC'],
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
const CHAIN_LOGOS: Partial<Record<SourceChainId, { fallback: string; src: string }>> = {
  bitcoin: { fallback: 'BTC', src: 'https://icons.llamao.fi/icons/chains/rsz_bitcoin.jpg' },
  ethereum: { fallback: 'ETH', src: 'https://icons.llamao.fi/icons/chains/rsz_ethereum.jpg' },
  base: { fallback: 'B', src: 'https://icons.llamao.fi/icons/chains/rsz_base.jpg' },
  arbitrum: { fallback: 'ARB', src: 'https://icons.llamao.fi/icons/chains/rsz_arbitrum.jpg' },
  optimism: { fallback: 'OP', src: 'https://icons.llamao.fi/icons/chains/rsz_optimism.jpg' },
  polygon: { fallback: 'POL', src: 'https://icons.llamao.fi/icons/chains/rsz_polygon.jpg' },
  avalanche: { fallback: 'AVAX', src: 'https://icons.llamao.fi/icons/chains/rsz_avalanche.jpg' },
  bsc: { fallback: 'BNB', src: 'https://icons.llamao.fi/icons/chains/rsz_bsc.jpg' },
  linea: { fallback: 'L', src: 'https://icons.llamao.fi/icons/chains/rsz_linea.jpg' },
  hyperevm: { fallback: 'HYPE', src: 'https://icons.llamao.fi/icons/chains/rsz_hyperevm.jpg' },
  hyperliquid: { fallback: 'HL', src: 'https://icons.llamao.fi/icons/chains/rsz_hyperliquid.jpg' },
  monad: { fallback: 'MON', src: 'https://icons.llamao.fi/icons/chains/rsz_monad.jpg' },
  sui: { fallback: 'SUI', src: 'https://icons.llamao.fi/icons/chains/rsz_sui.jpg' },
  solana: { fallback: 'SOL', src: 'https://icons.llamao.fi/icons/chains/rsz_solana.jpg' },
};
const XMR_TOKEN: MayanToken = {
  name: 'Monero',
  symbol: 'XMR',
  contract: 'XMR',
  decimals: XMR_DECIMALS,
  verified: true,
};
const WXMR_SOL_TOKEN: MayanToken = {
  name: 'XMR on Solana',
  symbol: 'XMR-SOL',
  contract: WXMR_MINT_ADDRESS,
  mint: WXMR_MINT_ADDRESS,
  decimals: XMR_DECIMALS,
  verified: true,
};

type RouteLeg = {
  title: string;
  caption: string;
  detail: string;
};

type DepositAddressLookup = {
  found: boolean;
  owner?: string;
  depositPda?: string;
  xmrDepositAddress?: string;
  status?: string;
};

type SolanaSwapTransactionPayload = {
  needsSwap: boolean;
  transaction?: string;
  requestId?: string;
  outAmount: string;
  minOutAmount: string;
};

type SolanaSwapExecutionPayload = {
  order: Order;
  outAmount: string;
  signature: string;
};

type SolanaWithdrawalTransactionPayload = {
  transaction: string;
  withdrawalPda: string;
  nonce: string;
  blockhash: string;
  lastValidBlockHeight: number;
  amount: string;
};

const FIELD_INPUT_BASE = 'w-full rounded-xl border border-[#5a6170] bg-[#090a0e] px-3 py-2.5 text-white outline-none transition-colors placeholder:text-[#8b919d] focus:border-[#f26822] focus:shadow-[0_0_0_3px_rgba(242,104,34,0.12)]';
const FIELD_INPUT = `${FIELD_INPUT_BASE} text-sm`;
const ADDRESS_INPUT = `${FIELD_INPUT_BASE} font-mono text-[13px]`;

function Chevron({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={`h-3.5 w-3.5 shrink-0 ${className}`}>
      <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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
  const [sourceChain, setSourceChain] = useState<SourceChainId>(DEFAULT_MAYAN_CHAIN);
  const [sourceTokens, setSourceTokens] = useState<MayanToken[]>([]);
  const [sourceTokensLoading, setSourceTokensLoading] = useState(true);
  const [sourceToken, setSourceToken] = useState('');
  const [destinationChain, setDestinationChain] = useState<SourceChainId>(DEFAULT_DESTINATION_CHAIN);
  const [destinationTokens, setDestinationTokens] = useState<MayanToken[]>([XMR_TOKEN]);
  const [destinationTokensLoading, setDestinationTokensLoading] = useState(false);
  const [destinationToken, setDestinationToken] = useState('XMR');
  const [amount, setAmount] = useState('');
  const [xmrAddress, setXmrAddress] = useState('');
  const [sourceAddress, setSourceAddress] = useState('');
  const [destinationAddress, setDestinationAddress] = useState('');
  const [refundAddress, setRefundAddress] = useState('');
  const [fundingMode, setFundingMode] = useState<FundingMode>('address');
  const [executionPolicy, setExecutionPolicy] = useState<ExecutionPolicy>(DEFAULT_EXECUTION_POLICY);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteKey, setQuoteKey] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isQuoteRefreshing, setIsQuoteRefreshing] = useState(false);
  const [tokenPickerTarget, setTokenPickerTarget] = useState<'source' | 'destination' | null>(null);
  const [tokenSearch, setTokenSearch] = useState('');
  const [depositAddressMatch, setDepositAddressMatch] = useState<DepositAddressLookup | null>(null);
  const [isCheckingDepositAddress, setIsCheckingDepositAddress] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const quoteRequestSeq = useRef(0);
  const depositLookupSeq = useRef(0);
  const direction: SwapDirection = sourceChain === 'monero'
    ? REVERSE_DIRECTION
    : destinationChain === 'monero'
      ? FORWARD_DIRECTION
      : ASSET_DIRECTION;

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
        setQuoteKey(null);
        const nextDirection = next.direction ?? FORWARD_DIRECTION;
        const nextSourceChain: SourceChainId = nextDirection === REVERSE_DIRECTION ? 'monero' : next.sourceChain;
        const nextSourceToken = nextDirection === REVERSE_DIRECTION ? 'XMR' : next.sourceToken;
        const nextDestinationChain: SourceChainId = next.destinationChain ?? (nextDirection === REVERSE_DIRECTION ? next.sourceChain : 'monero');
        const nextDestinationToken = next.destinationToken ?? (nextDirection === REVERSE_DIRECTION ? next.sourceToken : 'XMR');
        setSourceChain(nextSourceChain);
        setSourceToken(nextSourceToken);
        setDestinationChain(nextDestinationChain);
        setDestinationToken(nextDestinationToken);
        setAmount(formatBaseUnits(next.amount, orderInputDecimals(next)));
        setXmrAddress(next.xmrAddress);
        setSourceAddress(next.funding.type === 'deposit-address' ? next.funding.sourceAddress ?? '' : '');
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
    const chains = selectableSourceChains();
    if (chains.includes(sourceChain)) return;
    setSourceChain(DEFAULT_MAYAN_CHAIN);
    quoteRequestSeq.current += 1;
    setIsQuoteRefreshing(false);
    setQuote(null);
    setQuoteKey(null);
    setOrder(null);
    clearOrderUrl();
  }, [sourceChain]);

  useEffect(() => {
    const chains = selectableDestinationChains();
    if (chains.includes(destinationChain)) return;
    setDestinationChain(DEFAULT_DESTINATION_CHAIN);
    setDestinationToken('XMR');
    quoteRequestSeq.current += 1;
    setIsQuoteRefreshing(false);
    setQuote(null);
    setQuoteKey(null);
    setOrder(null);
    clearOrderUrl();
  }, [destinationChain]);

  useEffect(() => {
    let cancelled = false;
    setSourceTokens([]);
    setSourceTokensLoading(true);
    setTokenSearch('');
    loadTokensForChain(sourceChain)
      .then((tokens) => {
        if (cancelled) return;
        setSourceTokensLoading(false);
        setSourceTokens(tokens);
        const preferred = tokens[0];
        setSourceToken((current) =>
          tokens.some((token) => tokenAddress(token) === current) ? current : tokenAddress(preferred) ?? '',
        );
      })
      .catch((e) => {
        if (cancelled) return;
        setSourceTokensLoading(false);
        setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [sourceChain]);

  useEffect(() => {
    let cancelled = false;
    setDestinationTokens([]);
    setDestinationTokensLoading(true);
    setTokenSearch('');
    loadTokensForChain(destinationChain)
      .then((tokens) => {
        if (cancelled) return;
        setDestinationTokensLoading(false);
        setDestinationTokens(tokens);
        const preferred = tokens[0];
        setDestinationToken((current) =>
          tokens.some((token) => tokenAddress(token) === current) ? current : tokenAddress(preferred) ?? '',
        );
      })
      .catch((e) => {
        if (cancelled) return;
        setDestinationTokensLoading(false);
        setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [destinationChain]);

  useEffect(() => {
    if (!order) return;
    // Expired address-funded EVM/Solana orders stay revivable server-side
    // for 48h (a late deposit resumes them), so keep watching those while
    // the page is open.
    const revivableWhenExpired = order.funding.type === 'deposit-address' &&
      order.sourceChain !== 'monero' &&
      order.sourceChain !== 'bitcoin';
    const terminal = ['completed', 'failed', 'refunded'].includes(order.status) ||
      (order.status === 'expired' && !revivableWhenExpired);
    if (terminal) return;
    const timer = setInterval(async () => {
      const next = await api<Order>(`/orders/${order.id}`);
      setOrder(next);
    }, 3_000);
    return () => clearInterval(timer);
  }, [order]);

  useEffect(() => {
    const trimmedAddress = xmrAddress.trim();
    const shouldCheck = direction === FORWARD_DIRECTION &&
      destinationChain === 'monero' &&
      isValidMoneroAddress(trimmedAddress);
    const requestSeq = depositLookupSeq.current + 1;
    depositLookupSeq.current = requestSeq;
    setDepositAddressMatch(null);

    if (!shouldCheck) {
      setIsCheckingDepositAddress(false);
      return;
    }

    setIsCheckingDepositAddress(true);
    const timer = setTimeout(() => {
      api<DepositAddressLookup>(`/deposit-address/${encodeURIComponent(trimmedAddress)}`)
        .then((result) => {
          if (depositLookupSeq.current !== requestSeq) return;
          setDepositAddressMatch(result.found && result.owner ? result : null);
        })
        .catch(() => {
          if (depositLookupSeq.current === requestSeq) setDepositAddressMatch(null);
        })
        .finally(() => {
          if (depositLookupSeq.current === requestSeq) setIsCheckingDepositAddress(false);
        });
    }, 250);

    return () => clearTimeout(timer);
  }, [destinationChain, direction, xmrAddress]);

  const selectedToken = useMemo(
    () => sourceTokens.find((token) => tokenAddress(token) === sourceToken),
    [sourceToken, sourceTokens],
  );
  const selectedDestinationToken = useMemo(
    () => destinationTokens.find((token) => tokenAddress(token) === destinationToken),
    [destinationToken, destinationTokens],
  );
  const sourceTokenDecimals = selectedToken?.decimals ?? 6;
  const destinationTokenDecimals = selectedDestinationToken?.decimals ?? (destinationChain === 'monero' ? XMR_DECIMALS : 6);
  const inputDecimals = sourceTokenDecimals;
  const parsedAmount = useMemo(() => parseTokenAmount(amount, inputDecimals), [amount, inputDecimals]);
  const requiresDestinationAddress = destinationChain !== 'monero';
  const destinationAddressOk = !requiresDestinationAddress
    ? true
    : destinationChain === 'solana'
      ? isPotentialSolanaAddress(destinationAddress)
      : Boolean(destinationAddress.trim());
  const requiresXmrAddress = sourceChain === 'monero' || destinationChain === 'monero';
  const hasValidXmrAddress = isValidMoneroAddress(xmrAddress);
  const quoteXmrAddress = requiresXmrAddress
    ? hasValidXmrAddress ? xmrAddress.trim() : QUOTE_PLACEHOLDER_XMR_ADDRESS
    : undefined;
  const quoteDestinationAddress = requiresDestinationAddress
    ? destinationAddressOk ? destinationAddress.trim() : placeholderAddressForChain(destinationChain)
    : undefined;
  const hasBitcoinRefundAddress = Boolean(sourceAddress.trim());
  const sourceTokenReady = Boolean(sourceToken) && Boolean(selectedToken);
  const destinationTokenReady = Boolean(destinationToken) && Boolean(selectedDestinationToken);
  const isSameAsset = sourceChain === destinationChain && sourceToken.toLowerCase() === destinationToken.toLowerCase();
  const canPreviewQuote = sourceTokenReady &&
    destinationTokenReady &&
    !isSameAsset &&
    parsedAmount > BigInt(0);
  const quoteRequestKey = useMemo(() => {
    if (!canPreviewQuote) return null;
    return [
      direction,
      sourceChain,
      sourceToken,
      destinationChain,
      destinationToken,
      parsedAmount.toString(),
      quoteXmrAddress ?? '',
      quoteDestinationAddress ?? '',
      refundAddress.trim(),
      executionPolicy,
    ].join('|');
  }, [canPreviewQuote, destinationChain, destinationToken, direction, executionPolicy, parsedAmount, quoteDestinationAddress, quoteXmrAddress, refundAddress, sourceChain, sourceToken]);
  const quoteMatchesInputs = Boolean(quote && quoteKey && quoteKey === quoteRequestKey);
  const quoteExpiresIn = useCountdown(quote?.expiresAt);
  const quoteExpired = quoteExpiresIn === 0;
  const createOrderBlocker = getCreateOrderBlocker({
    direction,
    quote,
    hasPositiveQuoteOutput: !quote || quoteHasPositiveOutput(quote),
    hasBitcoinRefundAddress,
    hasValidXmrAddress,
    requiresXmrAddress,
    destinationAddressOk,
    isSameAsset,
  });
  const canCreateOrder = quoteMatchesInputs &&
    !quoteExpired &&
    !isQuoteRefreshing &&
    !createOrderBlocker;
  const routeLegs = buildRouteLegs({ direction, quote, selectedToken, sourceChain });
  const primaryLabel = getPrimaryLabel({ quote, quoteMatchesInputs, order, isLoading, isQuoteRefreshing, quoteExpired, createOrderBlocker });
  const primaryDisabled = getPrimaryDisabled({ canPreviewQuote, canCreateOrder, quote, quoteMatchesInputs, order, isLoading, isQuoteRefreshing, quoteExpired });
  const receivePreview = formatReceivePreview({ direction, quote, token: selectedDestinationToken, destinationDecimals: destinationTokenDecimals });
  const isReceivePreviewLoading = isQuoteRefreshing && canPreviewQuote;
  const pickerChain = tokenPickerTarget === 'destination' ? destinationChain : sourceChain;
  const pickerChains = tokenPickerTarget === 'destination' ? selectableDestinationChains() : selectableSourceChains();
  const pickerTokens = tokenPickerTarget === 'destination' ? destinationTokens : sourceTokens;
  const pickerSelectedToken = tokenPickerTarget === 'destination' ? destinationToken : sourceToken;

  const resetTrade = ({ preserveQuote = false }: { preserveQuote?: boolean } = {}) => {
    quoteRequestSeq.current += 1;
    if (preserveQuote && quote) {
      setIsQuoteRefreshing(true);
    } else {
      setIsQuoteRefreshing(false);
      setQuote(null);
      setQuoteKey(null);
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
    const nextSourceChain = destinationChain;
    const nextSourceToken = destinationToken;
    setDestinationChain(sourceChain);
    setDestinationToken(sourceToken);
    setSourceChain(nextSourceChain);
    setSourceToken(nextSourceToken);
    resetTrade();
  };

  const useDirectDepositRoute = () => {
    if (!depositAddressMatch?.owner) return;
    setDestinationChain('solana');
    setDestinationToken(WXMR_MINT_ADDRESS);
    setDestinationAddress(depositAddressMatch.owner);
    setTokenPickerTarget(null);
    resetTrade({ preserveQuote: parsedAmount > BigInt(0) });
  };

  const fetchQuote = useCallback(async ({ showLoading }: { showLoading: boolean }) => {
    if (!canPreviewQuote || !quoteRequestKey) return;
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
          destinationChain,
          destinationToken,
          amount: parsedAmount.toString(),
          xmrAddress: quoteXmrAddress,
          destinationAddress: quoteDestinationAddress,
          refundAddress: refundAddress || undefined,
          slippageBps: DEFAULT_SLIPPAGE_BPS,
          executionPolicy,
        }),
      });
      if (quoteRequestSeq.current !== requestSeq) return;
      setQuote(next);
      setQuoteKey(quoteRequestKey);
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
  }, [canPreviewQuote, destinationChain, destinationToken, direction, executionPolicy, parsedAmount, quoteDestinationAddress, quoteRequestKey, quoteXmrAddress, refundAddress, sourceChain, sourceToken]);

  useEffect(() => {
    if (!canPreviewQuote || !quoteRequestKey || order || quoteMatchesInputs) return;
    if (quote) setIsQuoteRefreshing(true);
    const timer = setTimeout(() => {
      void fetchQuote({ showLoading: false });
    }, quote ? 150 : 0);
    return () => clearTimeout(timer);
  }, [canPreviewQuote, fetchQuote, order, quote, quoteMatchesInputs, quoteRequestKey]);

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
          sourceAddress: sourceChain === 'bitcoin' ? sourceAddress.trim() : undefined,
          destinationAddress: requiresDestinationAddress ? destinationAddress.trim() : undefined,
          refundAddress: refundAddress || undefined,
          xmrAddress: requiresXmrAddress ? xmrAddress.trim() : undefined,
          executionPolicy,
          fundingMode,
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
    if (quoteMatchesInputs && quote && !quoteExpired) {
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
      <header className="mx-auto flex w-full max-w-[30rem] items-center justify-between gap-4 px-4 py-4 md:px-5 md:py-5">
        <div className="flex min-w-0 items-center gap-3">
          <MoneroLogo className="h-7 w-7 shrink-0" />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight text-white">Swap XMR</h1>
            <p className="hidden text-xs text-[#8b919d] sm:block">Cross-chain swaps with XMR routes built in</p>
          </div>
        </div>
        {quote && !quoteExpired && (
          <div className="hidden items-center gap-2 rounded-full border border-[#273226] bg-[#111711] px-3 py-2 text-xs font-medium text-[#9ee6a8] sm:flex">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#35d071] opacity-60 motion-reduce:hidden" style={{ animationDuration: '2.5s' }} />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#35d071]" />
            </span>
            Live quote
          </div>
        )}
      </header>

      <section className="mx-auto w-full max-w-[30rem] px-4 pb-10 md:px-5">
        <div className="overflow-hidden rounded-[20px] border border-[#26272d] bg-[#111216] shadow-2xl shadow-black/40">
          <div className="p-3 md:p-4">
            <div className="mb-3 flex items-center justify-between gap-3 px-1">
              <div className="text-base font-semibold text-white">Exchange</div>
              <div className="rounded-full bg-[#1c1e24] px-2.5 py-1 text-xs font-medium text-[#a9afba]">
                {routeModeLabel(direction)}
              </div>
            </div>

            <div className="space-y-2.5">
            <TradeAmountPanel
              amount={amount}
              chainId={sourceChain}
              token={selectedToken}
              tokenLoading={sourceTokensLoading}
              label="You send"
              onAmountChange={updateAmount}
              onOpenTokenPicker={() => setTokenPickerTarget('source')}
            />

            <DirectionSwapButton direction={direction} onClick={switchDirection} />

            <MayanReceivePanel
              value={receivePreview}
              chainId={destinationChain}
              token={selectedDestinationToken}
              tokenLoading={destinationTokensLoading}
              isLoading={isReceivePreviewLoading}
              onOpenTokenPicker={() => setTokenPickerTarget('destination')}
            />

            <RecipientPanel
              direction={direction}
              destinationChain={destinationChain}
              quote={quote}
              xmrAddress={xmrAddress}
              sourceAddress={sourceAddress}
              destinationAddress={destinationAddress}
              depositAddressMatch={depositAddressMatch}
              isCheckingDepositAddress={isCheckingDepositAddress}
              onXmrAddressChange={(next) => {
                setXmrAddress(next);
              }}
              onSourceAddressChange={(next) => {
                setSourceAddress(next);
              }}
              onDestinationAddressChange={(next) => {
                setDestinationAddress(next);
                resetTrade();
              }}
              onUseDirectDepositRoute={useDirectDepositRoute}
            />

            <SwapOptionsPanel
              direction={direction}
              sourceChain={sourceChain}
              destinationChain={destinationChain}
              refundAddress={refundAddress}
              value={executionPolicy}
              onRefundAddressChange={setRefundAddress}
              onChange={(next) => {
                setExecutionPolicy(next);
              }}
            />

            {(CHAINS[sourceChain].kind === 'evm' || sourceChain === 'solana') && !order && (
              <DepositMethodToggle value={fundingMode} onChange={setFundingMode} />
            )}

            </div>

            <div className="mt-4 space-y-2.5">
            {error && <ErrorBanner message={error} />}

            <button
              onClick={onPrimaryAction}
              disabled={primaryDisabled}
              aria-live="polite"
              className="xmr-btn-primary flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-base font-semibold text-[#0b0c10]"
            >
              {(isLoading || (isQuoteRefreshing && canPreviewQuote)) && (
                <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4 animate-spin motion-reduce:hidden">
                  <path d="M14 8a6 6 0 1 1-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              )}
              {primaryLabel}
            </button>
            </div>

            {(quote || order) && (
            <div className="mt-4 space-y-2.5">
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
                onOrderUpdate={setOrder}
                onError={(message) => setError(message)}
              />
            )}

            {(quote || order) && (
              <details className="group">
                <summary className="flex cursor-pointer select-none list-none items-center justify-between gap-3 rounded-2xl border border-[#292b31] bg-[#0c0d11] px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:border-[#f26822]/60">
                  <span>Route and order details</span>
                  <Chevron className="text-[#8b919d] transition-transform duration-200 ease-out group-open:rotate-180 motion-reduce:transition-none" />
                </summary>
                <div className="swap-reveal mt-2.5 space-y-2.5">
                  <RoutePanel legs={routeLegs} quote={quote} />
                  {order && <OrderStatusPanel order={order} />}
                </div>
              </details>
            )}
            </div>
            )}
          </div>
        </div>
      </section>

      {tokenPickerTarget && (
        <TokenPicker
          chainId={pickerChain}
          chains={pickerChains}
          tokens={pickerTokens}
          selectedToken={pickerSelectedToken}
          search={tokenSearch}
          onSearchChange={setTokenSearch}
          onChainChange={(next) => {
            if (tokenPickerTarget === 'destination') {
              setDestinationChain(next);
            } else {
              setSourceChain(next);
            }
            resetTrade({ preserveQuote: parsedAmount > BigInt(0) });
          }}
          onClose={() => setTokenPickerTarget(null)}
          onSelect={(contract) => {
            if (tokenPickerTarget === 'destination') {
              setDestinationToken(contract);
            } else {
              setSourceToken(contract);
            }
            setTokenPickerTarget(null);
            resetTrade({ preserveQuote: parsedAmount > BigInt(0) });
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
  const label = direction === FORWARD_DIRECTION
    ? 'Swap to send XMR'
    : direction === REVERSE_DIRECTION
      ? 'Swap to receive XMR'
      : 'Swap selected assets';
  return (
    <div className="pointer-events-none relative z-10 -mt-[28px] -mb-[18px] flex justify-center">
      <button
        type="button"
        onClick={onClick}
        title={label}
        aria-label={label}
        className="group pointer-events-auto relative flex h-9 w-9 items-center justify-center rounded-xl border border-[#343740] bg-[#15161b] text-[#f26822] ring-4 ring-[#111216] transition-colors after:absolute after:-inset-2 after:content-[''] hover:border-[#f26822] hover:bg-[#1b1714]"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 transition-transform duration-200 ease-out group-hover:rotate-180 motion-reduce:transition-none motion-reduce:group-hover:rotate-0"
          aria-hidden
        >
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
  tokenLoading,
  label,
  onAmountChange,
  onOpenTokenPicker,
}: {
  amount: string;
  chainId: SourceChainId;
  token?: MayanToken;
  tokenLoading: boolean;
  label: string;
  onAmountChange: (value: string) => void;
  onOpenTokenPicker: () => void;
}) {
  const chainName = CHAINS[chainId].name;
  return (
    <div className="swap-amount-panel rounded-2xl border border-[#292b31] bg-[#0c0d11] p-3 transition-colors">
      <div className="mb-2 text-sm text-[#a9afba]">{label}</div>
      <div className="flex items-center gap-3">
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={amount}
          onChange={(event) => {
            const raw = event.target.value.replace(/[\s_]/g, '');
            const next = raw.includes('.') || (raw.match(/,/g) ?? []).length > 1
              ? raw.replace(/,/g, '')
              : raw.replace(',', '.');
            if (/^\d*\.?\d*$/.test(next)) onAmountChange(next);
          }}
          placeholder="0.00"
          className="min-w-0 flex-1 bg-transparent text-2xl font-semibold tabular-nums tracking-tight text-white outline-none placeholder:text-[#8b919d] md:text-3xl"
        />
        <TokenSelectButton token={token} loading={tokenLoading} chainName={chainName} onClick={onOpenTokenPicker} />
      </div>
      {chainId === 'monero' && (
        <div className="mt-2 text-xs leading-relaxed text-pretty text-[#8b919d]">
          Minimum {MIN_XMR_DEPOSIT_XMR} XMR — the Monero bridge only mints deposits of {MIN_XMR_DEPOSIT_XMR} XMR or more.
        </div>
      )}
    </div>
  );
}

function TokenSelectButton({
  token,
  loading,
  chainName,
  onClick,
}: {
  token?: MayanToken;
  loading: boolean;
  chainName: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex min-w-[112px] items-center justify-between gap-2 rounded-xl bg-[#1c1e24] px-3 py-2 text-left text-white transition-colors hover:bg-[#262932] active:bg-[#2b2e38]"
    >
      {token ? (
        <>
          <TokenLogo token={token} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{token.symbol ?? 'Token'}</span>
            <span className="block truncate text-[11px] text-[#9aa0ac]">{chainName}</span>
          </span>
        </>
      ) : loading ? (
        <>
          <span className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-[#24272f] motion-reduce:animate-none" />
          <span className="min-w-0 flex-1 space-y-1.5">
            <span className="block h-3 w-12 animate-pulse rounded bg-[#24272f] motion-reduce:animate-none" />
            <span className="block h-2 w-16 animate-pulse rounded bg-[#1d2027] motion-reduce:animate-none" />
          </span>
        </>
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">Select token</span>
      )}
      <Chevron className="text-[#8b919d]" />
    </button>
  );
}

function MayanReceivePanel({
  value,
  chainId,
  token,
  tokenLoading,
  isLoading,
  onOpenTokenPicker,
}: {
  value: string;
  chainId: SourceChainId;
  token?: MayanToken;
  tokenLoading: boolean;
  isLoading: boolean;
  onOpenTokenPicker: () => void;
}) {
  const chainName = CHAINS[chainId].name;
  return (
    <div className="rounded-2xl border border-[#292b31] bg-[#0c0d11] p-3">
      <div className="mb-2 text-sm text-[#a9afba]">You get</div>
      <div className="flex items-center gap-3">
        <div
          title={value}
          className={`min-w-0 flex-1 truncate text-2xl font-semibold tabular-nums tracking-tight transition-colors duration-200 md:text-3xl ${isLoading ? 'text-[#8b919d]' : 'text-white'}`}
        >
          {value}
        </div>
        <TokenSelectButton token={token} loading={tokenLoading} chainName={chainName} onClick={onOpenTokenPicker} />
      </div>
    </div>
  );
}

function NetworkPillSelector({
  value,
  chains,
  onChange,
}: {
  value: SourceChainId;
  chains: readonly SourceChainId[];
  onChange: (value: SourceChainId) => void;
}) {
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {chains.map((chain) => {
        const selected = chain === value;
        return (
          <button
            key={chain}
            type="button"
            onClick={() => onChange(chain)}
            className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-2.5 text-sm transition-colors ${
              selected
                ? 'border-[#f26822] bg-[#22170f] text-white shadow-sm shadow-[#f26822]/20'
                : 'border-[#30333b] bg-[#15171c] text-[#c8cbd1] hover:border-[#f26822]/45'
            }`}
          >
            <ChainBadge chain={chain} />
            <span className="font-medium">{CHAINS[chain].name}</span>
          </button>
        );
      })}
    </div>
  );
}

function ChainBadge({ chain }: { chain: SourceChainId }) {
  const [failed, setFailed] = useState(false);
  if (chain === 'monero') {
    return <MoneroLogo className="h-6 w-6 shrink-0" />;
  }
  const logo = CHAIN_LOGOS[chain];
  const fallback = logo?.fallback ?? CHAINS[chain].name.slice(0, 2).toUpperCase();

  if (logo && !failed) {
    return (
      <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-[#24272f]">
        {/* eslint-disable-next-line @next/next/no-img-element -- Chain icons are small lazy-loaded remote assets from DefiLlama. */}
        <img
          src={logo.src}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  return (
    <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-[#30333b] px-1.5 text-[10px] font-black text-white">
      {fallback}
    </span>
  );
}

function RecipientPanel({
  direction,
  destinationChain,
  quote,
  xmrAddress,
  sourceAddress,
  destinationAddress,
  depositAddressMatch,
  isCheckingDepositAddress,
  onXmrAddressChange,
  onSourceAddressChange,
  onDestinationAddressChange,
  onUseDirectDepositRoute,
}: {
  direction: SwapDirection;
  destinationChain: SourceChainId;
  quote: Quote | null;
  xmrAddress: string;
  sourceAddress: string;
  destinationAddress: string;
  depositAddressMatch: DepositAddressLookup | null;
  isCheckingDepositAddress: boolean;
  onXmrAddressChange: (value: string) => void;
  onSourceAddressChange: (value: string) => void;
  onDestinationAddressChange: (value: string) => void;
  onUseDirectDepositRoute: () => void;
}) {
  const addressOk = !xmrAddress || isValidMoneroAddress(xmrAddress);
  const needsBitcoinRefundAddress = quote?.route === 'chainflip';
  const destinationLabel = destinationChain === 'solana' ? 'Solana receive address' : `${CHAINS[destinationChain].name} receive address`;
  const destinationPlaceholder = destinationChain === 'solana' ? 'Solana wallet address' : `Wallet on ${CHAINS[destinationChain].name}`;
  const addressStatus = !xmrAddress
    ? { label: 'Required', className: 'text-xs text-[#8b919d]' }
    : !addressOk
      ? { label: 'Invalid', className: 'text-xs text-[#ff8c8c]' }
      : isCheckingDepositAddress
        ? { label: 'Checking', className: 'text-xs text-[#8b919d]' }
        : { label: 'Ready', className: 'text-xs text-[#9ee6a8]' };

  return (
    <div className="grid gap-2.5 rounded-2xl border border-[#292b31] bg-[#0f1015] p-3">
      {direction === FORWARD_DIRECTION ? (
        <>
          <label>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <span className="text-sm text-[#a9afba]">XMR receive address</span>
              <span className={addressStatus.className}>
                {addressStatus.label}
              </span>
            </div>
            <input
              value={xmrAddress}
              onChange={(event) => onXmrAddressChange(event.target.value.trim())}
              placeholder="4..."
              className={ADDRESS_INPUT}
            />
          </label>
          <div className="text-xs leading-relaxed text-pretty text-[#8b919d]">
            The Monero bridge pays out a minimum of {MIN_XMR_WITHDRAWAL_XMR} XMR — swaps with a smaller worst-case output are rejected at quoting.
          </div>
          {depositAddressMatch?.owner && (
            <div className="rounded-lg border border-[#f26822]/35 bg-[#1a120c] p-3">
              <div className="text-sm font-semibold text-white">This is an XMR-SOL deposit address</div>
              <div className="mt-1 text-xs leading-relaxed text-[#c59a7c]">
                Send XMR-SOL directly to {shortAddress(depositAddressMatch.owner)} instead of withdrawing native XMR and depositing it again.
              </div>
              <button
                type="button"
                onClick={onUseDirectDepositRoute}
                className="mt-3 w-full rounded-xl border border-[#493424] bg-[#23170e] px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:border-[#f26822]"
              >
                Send XMR-SOL directly
              </button>
            </div>
          )}
          {needsBitcoinRefundAddress && (
            <label>
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <span className="text-sm text-[#a9afba]">BTC refund address</span>
                <span className={sourceAddress.trim() ? 'text-xs text-[#9ee6a8]' : 'text-xs text-[#8b919d]'}>
                  {sourceAddress.trim() ? 'Ready' : 'Required'}
                </span>
              </div>
              <input
                value={sourceAddress}
                onChange={(event) => onSourceAddressChange(event.target.value.trim())}
                placeholder="bc1..."
                className={ADDRESS_INPUT}
              />
            </label>
          )}
        </>
      ) : direction === REVERSE_DIRECTION ? (
        <>
          <label>
            <div className="mb-1.5 text-sm text-[#a9afba]">{destinationLabel}</div>
            <input
              value={destinationAddress}
              onChange={(event) => onDestinationAddressChange(event.target.value.trim())}
              placeholder={destinationPlaceholder}
              className={ADDRESS_INPUT}
            />
          </label>
          <label>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <span className="text-sm text-[#a9afba]">XMR refund address</span>
              <span className={!xmrAddress ? 'text-xs text-[#8b919d]' : addressOk ? 'text-xs text-[#9ee6a8]' : 'text-xs text-[#ff8c8c]'}>
                {!xmrAddress ? 'Required' : addressOk ? 'Ready' : 'Invalid'}
              </span>
            </div>
            <input
              value={xmrAddress}
              onChange={(event) => onXmrAddressChange(event.target.value.trim())}
              placeholder="4..."
              className={ADDRESS_INPUT}
            />
          </label>
        </>
      ) : (
        <>
          <label>
            <div className="mb-1.5 text-sm text-[#a9afba]">{destinationLabel}</div>
            <input
              value={destinationAddress}
              onChange={(event) => onDestinationAddressChange(event.target.value.trim())}
              placeholder={destinationPlaceholder}
              className={ADDRESS_INPUT}
            />
          </label>
          {needsBitcoinRefundAddress && (
            <label>
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <span className="text-sm text-[#a9afba]">BTC refund address</span>
                <span className={sourceAddress.trim() ? 'text-xs text-[#9ee6a8]' : 'text-xs text-[#8b919d]'}>
                  {sourceAddress.trim() ? 'Ready' : 'Required'}
                </span>
              </div>
              <input
                value={sourceAddress}
                onChange={(event) => onSourceAddressChange(event.target.value.trim())}
                placeholder="bc1..."
                className={ADDRESS_INPUT}
              />
            </label>
          )}
        </>
      )}
    </div>
  );
}

function SwapOptionsPanel({
  direction,
  sourceChain,
  destinationChain,
  refundAddress,
  value,
  onRefundAddressChange,
  onChange,
}: {
  direction: SwapDirection;
  sourceChain: SourceChainId;
  destinationChain: SourceChainId;
  refundAddress: string;
  value: ExecutionPolicy;
  onRefundAddressChange: (value: string) => void;
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

  // Address-funded EVM/Solana deposits refund on the source chain; BTC routes
  // refund Solana-side (the BTC refund is the separate source address field).
  const refundLabel = direction === FORWARD_DIRECTION || direction === ASSET_DIRECTION
    ? CHAINS[sourceChain].kind === 'evm' || sourceChain === 'solana'
      ? `${CHAINS[sourceChain].name} refund address`
      : 'Solana refund address'
    : `${CHAINS[destinationChain].name} refund address`;
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <details className="group rounded-2xl border border-[#292b31] bg-[#0f1015]">
      <summary className="flex cursor-pointer select-none list-none items-center justify-between gap-3 rounded-2xl px-3 py-2.5 text-sm text-white transition-colors hover:bg-white/[0.02]">
        <span className="font-semibold">Options</span>
        <span className="min-w-0 flex-1 truncate text-right text-xs text-[#8b919d]">{selected.title}</span>
        <Chevron className="text-[#8b919d] transition-transform duration-200 ease-out group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="swap-reveal grid gap-2 border-t border-[#292b31] p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <label className="sm:col-span-2">
          <div className="mb-1 text-xs text-[#a9afba]">{refundLabel}</div>
          <input
            value={refundAddress}
            onChange={(event) => onRefundAddressChange(event.target.value.trim())}
            placeholder="Optional"
            className={ADDRESS_INPUT}
          />
        </label>
        <div className="px-1 text-xs text-[#a9afba] sm:col-span-2">If price moves</div>
        <div className="grid gap-1.5 sm:col-span-2 sm:grid-cols-2">
          {options.map((option) => {
            const optionSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onChange(option.value)}
                className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  optionSelected
                    ? 'border-[#f26822] bg-[#22170f] text-white'
                    : 'border-[#30333b] bg-[#090a0e] text-[#c8cbd1] hover:border-[#f26822]/45'
                }`}
              >
                <span className="block text-sm font-semibold">{option.title}</span>
                <span className="mt-0.5 block text-xs leading-snug text-[#8b919d]">{option.caption}</span>
              </button>
            );
          })}
        </div>
      </div>
    </details>
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
  useEscapeKey(true, onClose);
  const dialogRef = useDialogFocus(true);
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
    <div className="swap-backdrop fixed inset-0 z-50 flex items-end bg-black/75 p-3 backdrop-blur-[2px] sm:items-center sm:justify-center" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Select asset"
        className="swap-panel-in max-h-[88vh] w-full max-w-lg overflow-hidden rounded-3xl border border-[#292b31] bg-[#111216] shadow-2xl shadow-black"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-[#24252b] p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-white">Select asset</div>
              <div className="text-xs text-[#8b919d]">Choose network and token</div>
            </div>
            <button onClick={onClose} className="rounded-full border border-[#30333b] px-3 py-2 text-sm text-[#c8cbd1] hover:border-[#f26822]">
              Close
            </button>
          </div>
          <div className="mb-2 rounded-2xl border border-[#292b31] bg-[#0c0d11] p-2">
            <div className="mb-1.5 flex items-center justify-between gap-3 px-1">
              <div className="text-xs font-medium uppercase tracking-[0.08em] text-[#8b919d]">Network</div>
              <div className="flex items-center gap-1.5 text-xs text-[#c8cbd1]">
                <ChainBadge chain={chainId} />
                {CHAINS[chainId].name}
              </div>
            </div>
            <NetworkPillSelector value={chainId} chains={chains} onChange={onChainChange} />
          </div>
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search token"
            autoFocus
            className={FIELD_INPUT}
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
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors ${
                  isSelected ? 'bg-[#22170f]' : 'hover:bg-[#191b21] active:bg-[#1d2027]'
                }`}
              >
                <TokenLogo token={token} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-white">{token.symbol ?? 'Token'}</span>
                  <span className="block truncate text-xs text-[#8b919d]">{token.name ?? contract}</span>
                </span>
                <span className="text-xs text-[#8b919d]">{token.standard ?? 'asset'}</span>
              </button>
            );
          })}
          {!filteredTokens.length && (
            <div className="px-4 py-8 text-center text-sm text-[#8b919d]">No matching assets</div>
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
  const thorchain = quote.thorchain;
  const isReverse = quote.direction === REVERSE_DIRECTION;
  const isNativeXmrOut = quote.direction === FORWARD_DIRECTION;
  const sourceDecimals = quote.sourceTokenDecimals ?? (isReverse ? XMR_DECIMALS : mayan?.quote.fromToken.decimals ?? 6);
  const sourceSymbol = quote.sourceTokenSymbol ?? (isReverse ? 'XMR' : mayan?.quote.fromToken.symbol ?? 'Token');
  const destinationSymbol = quote.destinationTokenSymbol ?? quote.sourceTokenSymbol ?? mayan?.quote.toToken.symbol ?? 'Token';
  const destinationDecimals = quote.destinationTokenDecimals ?? quote.sourceTokenDecimals ?? mayan?.quote.toToken.decimals ?? 6;
  const isSolanaDirect = quote.route === 'solana';
  const expectedLabel = isNativeXmrOut ? 'Expected' : `Expected ${destinationSymbol}`;
  const expectedValue = isNativeXmrOut
    ? `${formatXmr(quote.estimatedXmrOut)} XMR`
    : `${formatBaseUnits(quote.estimatedDestinationOut ?? '0', destinationDecimals)} ${destinationSymbol}`;
  const minimumLabel = isNativeXmrOut ? 'Minimum' : `Minimum ${destinationSymbol}`;
  const minimumValue = isNativeXmrOut
    ? `${formatXmr(quote.minXmrOut)} XMR`
    : `${formatBaseUnits(quote.minDestinationOut ?? '0', destinationDecimals)} ${destinationSymbol}`;
  const fees = quote.direction === ASSET_DIRECTION
    ? quote.route === 'mayan'
      ? `${formatBps(mayan?.protocolBps ?? 0)} Mayan`
      : quote.route === 'solana'
        ? 'Jupiter'
        : quote.route === 'chainflip'
          ? 'Chainflip + Jupiter/Mayan'
          : 'THORChain + Jupiter/Mayan'
    : isSolanaDirect
    ? `Jupiter + ${formatBps(quote.bridgeFeeBps)} bridge`
    : quote.route === 'thorchain'
      ? `${thorchain?.mode === 'eth-usdc-fallback' ? 'THORChain + Mayan' : 'THORChain'} + ${formatBps(quote.bridgeFeeBps)} bridge`
      : quote.route === 'chainflip'
        ? `Chainflip + ${formatBps(quote.bridgeFeeBps)} bridge`
      : `${formatBps(mayan?.protocolBps ?? 0)} Mayan + ${formatBps(quote.bridgeFeeBps)} bridge`;

  return (
    <div className="rounded-2xl border border-[#292b31] bg-[#101116] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white">Quote</div>
          <div className="line-clamp-2 text-xs leading-snug text-[#8b919d]">{quote.routeSummary ?? 'Mayan Swift v2 route'}</div>
        </div>
        <div className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums ${quoteExpired ? 'bg-[#351919] text-[#ff8c8c]' : 'bg-[#142316] text-[#9ee6a8]'}`}>
          {quoteExpired ? 'Expired' : `Expires in ${formatCountdown(quoteExpiresIn)}`}
        </div>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-3">
        <QuoteSummaryItem label={expectedLabel} value={expectedValue} />
        <QuoteSummaryItem label={minimumLabel} value={minimumValue} />
        <QuoteSummaryItem label="Fees" value={fees} />
      </div>
      <div className="mt-2 text-[11px] tabular-nums text-[#8b919d]">
        Sending {formatBaseUnits(quote.inputAmount, sourceDecimals)} {sourceSymbol}
      </div>
    </div>
  );
}

function QuoteSummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-[#252831] bg-[#0b0c10] px-2.5 py-2">
      <div className="truncate text-[11px] uppercase tracking-[0.08em] text-[#8b919d]">{label}</div>
      <div className="mt-0.5 break-words text-[13px] font-semibold leading-snug tabular-nums text-white">{value}</div>
    </div>
  );
}

function RoutePanel({ legs, quote }: { legs: RouteLeg[]; quote: Quote | null }) {
  return (
    <div className="rounded-2xl border border-[#292b31] bg-[#0f1015] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">Route</h2>
          <p className="text-xs text-[#8b919d]">Token path and execution venues</p>
        </div>
        <div className="rounded-full bg-[#17191f] px-3 py-1 text-xs text-[#c8cbd1]">
          {quote?.route === 'solana'
            ? 'Direct Solana'
            : quote?.route === 'chainflip'
              ? 'Chainflip'
              : quote?.route === 'thorchain'
                ? 'THORChain'
                : quote?.mayan?.clientEta ?? 'Live quote'}
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
                <div className="truncate text-xs text-[#8b919d]">{leg.caption}</div>
              </div>
              <div className="mt-2 text-xs leading-relaxed text-[#8b919d]">{leg.detail}</div>
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
  onOrderUpdate,
  onError,
}: {
  order: Order;
  onDeposit: (txHash: string) => Promise<void>;
  onOrderUpdate: (order: Order) => void;
  onError: (message: string) => void;
}) {
  if (order.status !== 'awaiting_deposit') {
    return null;
  }
  if (order.funding.type === 'mayan-swift') {
    return <MayanEvmFunding funding={order.funding} onDeposit={onDeposit} onError={onError} />;
  }
  if (order.funding.type === 'deposit-address') {
    if (order.funding.chainId === 'bitcoin') {
      return <BtcDepositFunding order={order} funding={order.funding} onDeposit={onDeposit} onError={onError} />;
    }
    if (order.funding.chainId === 'monero') {
      return <XmrDepositFunding order={order} funding={order.funding} />;
    }
    return <AddressDepositFunding order={order} funding={order.funding} />;
  }
  if (order.funding.type === 'solana-transfer') {
    return <SolanaTransferFunding funding={order.funding} onDeposit={onDeposit} onError={onError} />;
  }
  if (order.funding.type === 'solana-direct') {
    return <SolanaDirectFunding order={order} funding={order.funding} onOrderUpdate={onOrderUpdate} onError={onError} />;
  }
  return (
    <div className="rounded-2xl border border-[#292b31] bg-[#101116] p-4 text-sm text-[#c8cbd1]">
      Unsupported funding route.
    </div>
  );
}

function BtcDepositFunding({
  order,
  funding,
  onDeposit,
  onError,
}: {
  order: Order;
  funding: Extract<FundingInstructions, { type: 'deposit-address' }>;
  onDeposit: (txHash: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [txHash, setTxHash] = useState('');
  const [isReporting, setIsReporting] = useState(false);
  const addressReady = Boolean(funding.address);
  const provider = funding.provider ?? 'THORChain';
  const amount = formatBaseUnits(funding.expectedAmount ?? order.amount, 8, 8);
  const report = async () => {
    const trimmed = txHash.trim();
    if (!trimmed) {
      onError('Enter the Bitcoin transaction id after sending BTC');
      return;
    }
    setIsReporting(true);
    try {
      await onDeposit(trimmed);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setIsReporting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-[#f26822]/40 bg-[#1a120c] p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">Send BTC</div>
          <div className="text-xs text-[#c59a7c]">{provider} deposit for order {shortId(order.id)}</div>
        </div>
        <StatusBadge status={addressReady ? 'awaiting_deposit' : 'created'} />
      </div>
      <div className="space-y-3">
        <Metric label="Amount" value={`${amount} BTC`} />
        <Metric label="Route" value={`BTC -> USDC-SOL via ${provider} -> XMR-SOL -> native XMR`} />
        {funding.sourceAddress && <Metric label="BTC refund address" value={funding.sourceAddress} />}
        <div className="rounded-xl border border-[#493424] bg-[#120d09] p-3">
          <div className="mb-2 text-xs uppercase tracking-[0.08em] text-[#a8846d]">Bitcoin deposit address</div>
          <div className="break-all font-mono text-sm text-white">
            {addressReady ? funding.address : 'Preparing deposit address...'}
          </div>
        </div>
        {funding.memo && <Metric label="Memo" value={funding.memo} />}
        <CopyAddressButton label="Copy BTC address" value={funding.address} />
        <label>
          <div className="mb-2 text-sm text-[#c59a7c]">Bitcoin transaction id</div>
          <input
            value={txHash}
            onChange={(event) => setTxHash(event.target.value.trim())}
            placeholder="Paste txid after sending"
            className="w-full rounded-xl border border-[#84603f] bg-[#120d09] px-3 py-3 font-mono text-sm text-white outline-none transition-colors placeholder:text-[#a8846d] focus:border-[#f26822]"
          />
        </label>
        <button
          onClick={report}
          disabled={isReporting || !addressReady}
          className="xmr-btn-primary flex min-h-12 w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold text-[#0b0c10]"
        >
          {isReporting ? 'Saving transaction...' : 'I sent BTC'}
        </button>
      </div>
    </div>
  );
}

function SolanaDirectFunding({
  order,
  funding,
  onOrderUpdate,
  onError,
}: {
  order: Order;
  funding: Extract<FundingInstructions, { type: 'solana-direct' }>;
  onOrderUpdate: (order: Order) => void;
  onError: (message: string) => void;
}) {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [isFunding, setIsFunding] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'swap' | 'withdraw'>('idle');
  const amount = formatBaseUnits(funding.inputAmount, funding.inputTokenDecimals ?? 6);
  const expectedWxmr = formatXmr(funding.expectedWxmrOut);
  const minWxmr = formatXmr(funding.minWxmrOut);

  const submitDirectSwap = async () => {
    setIsFunding(true);
    setPhase('swap');
    try {
      if (!publicKey || !signTransaction) {
        throw new Error('Connect a Solana wallet that can sign transactions');
      }

      const taker = publicKey.toBase58();
      const swapPayload = await api<SolanaSwapTransactionPayload>(`/orders/${order.id}/solana/swap-transaction`, {
        method: 'POST',
        body: JSON.stringify({ taker }),
      });

      let swapResult: SolanaSwapExecutionPayload;
      if (swapPayload.needsSwap) {
        if (!swapPayload.transaction || !swapPayload.requestId) {
          throw new Error('Jupiter did not return a transaction');
        }
        const swapTransaction = VersionedTransaction.deserialize(Buffer.from(swapPayload.transaction, 'base64'));
        const signedSwap = await signTransaction(swapTransaction);
        swapResult = await api<SolanaSwapExecutionPayload>(`/orders/${order.id}/solana/execute-swap`, {
          method: 'POST',
          body: JSON.stringify({
            signedTransaction: Buffer.from(signedSwap.serialize()).toString('base64'),
            requestId: swapPayload.requestId,
            outAmount: swapPayload.outAmount,
          }),
        });
      } else {
        swapResult = await api<SolanaSwapExecutionPayload>(`/orders/${order.id}/solana/execute-swap`, {
          method: 'POST',
          body: JSON.stringify({
            skipped: true,
            outAmount: swapPayload.outAmount,
          }),
        });
      }
      onOrderUpdate(swapResult.order);

      setPhase('withdraw');
      const withdrawalPayload = await api<SolanaWithdrawalTransactionPayload>(`/orders/${order.id}/solana/withdrawal-transaction`, {
        method: 'POST',
        body: JSON.stringify({ owner: taker }),
      });
      const withdrawalTransaction = Transaction.from(Buffer.from(withdrawalPayload.transaction, 'base64'));
      const signedWithdrawal = await signTransaction(withdrawalTransaction);
      const withdrawalSignature = await connection.sendRawTransaction(signedWithdrawal.serialize());
      await connection.confirmTransaction({
        signature: withdrawalSignature,
        blockhash: withdrawalPayload.blockhash,
        lastValidBlockHeight: withdrawalPayload.lastValidBlockHeight,
      }, 'confirmed');
      const updated = await api<Order>(`/orders/${order.id}/solana/withdrawal`, {
        method: 'POST',
        body: JSON.stringify({
          withdrawalSignature,
          withdrawalPda: withdrawalPayload.withdrawalPda,
          amount: withdrawalPayload.amount,
        }),
      });
      onOrderUpdate(updated);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setPhase('idle');
      setIsFunding(false);
    }
  };

  const buttonLabel = phase === 'swap'
    ? 'Signing Jupiter swap...'
    : phase === 'withdraw'
      ? 'Signing withdrawal...'
      : funding.inputMint.toLowerCase() === funding.wxmrMint.toLowerCase()
        ? 'Request XMR withdrawal'
        : 'Swap and request withdrawal';

  return (
    <div className="rounded-2xl border border-[#f26822]/40 bg-[#1a120c] p-4">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">Pay with Solana wallet</div>
          <div className={`truncate text-xs text-[#c59a7c] ${publicKey ? 'font-mono' : ''}`}>
            {publicKey ? shortAddress(publicKey.toBase58()) : 'Connect a Solana wallet'}
          </div>
        </div>
        <WalletMultiButton />
      </div>
      <div className="mb-3 grid gap-2 rounded-xl border border-[#493424] bg-[#120d09] p-3 text-sm">
        <Metric label="Amount" value={`${amount} ${funding.inputTokenSymbol ?? 'token'}`} />
        <Metric label="Expected XMR-SOL" value={`${expectedWxmr} XMR-SOL`} />
        <Metric label="Minimum XMR-SOL" value={`${minWxmr} XMR-SOL`} />
        <Metric label="Route" value="Wallet-signed Jupiter swap, then wallet-signed XMR withdrawal" />
      </div>
      <button
        onClick={submitDirectSwap}
        disabled={isFunding || !publicKey || !signTransaction}
        className="xmr-btn-primary flex min-h-12 w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold text-[#0b0c10]"
      >
        {buttonLabel}
      </button>
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
          <div className={`truncate text-xs text-[#c59a7c] ${publicKey ? 'font-mono' : ''}`}>
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
        className="xmr-btn-primary flex min-h-12 w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold text-[#0b0c10]"
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
        <CopyAddressButton label="Copy XMR address" value={funding.address} />
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
  const walletOptions = useMemo(() => buildWalletOptions(connectors), [connectors]);
  const walletAvailability = useConnectorAvailability(walletOptions);
  const [showConnect, setShowConnect] = useState(false);
  const [isFunding, setIsFunding] = useState(false);
  const [connectingConnectorUid, setConnectingConnectorUid] = useState<string | null>(null);
  useEscapeKey(showConnect, () => setShowConnect(false));
  const connectDialogRef = useDialogFocus(showConnect);

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
          <div className={`truncate text-xs text-[#c59a7c] ${address ? 'font-mono' : ''}`}>{address ? shortAddress(address) : 'Connect an EVM wallet'}</div>
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
        className="xmr-btn-primary flex min-h-12 w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold text-[#0b0c10]"
      >
        {isFunding ? 'Waiting for wallet...' : `Start ${funding.tokenSymbol ?? 'token'} swap`}
      </button>
      {showConnect && (
        <div className="swap-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-[2px]" onClick={() => setShowConnect(false)}>
          <div
            ref={connectDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Connect wallet"
            className="swap-panel-in w-full max-w-sm rounded-3xl border border-[#292b31] bg-[#111216] p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">Connect wallet</h3>
              <button onClick={() => setShowConnect(false)} className="rounded-full border border-[#30333b] px-3 py-2 text-sm text-[#c8cbd1] hover:border-[#f26822]">
                Close
              </button>
            </div>
            <div className="grid gap-2">
              {walletOptions.map(({ connector, description, icon, id, name }) => {
                const isConnecting = connectingConnectorUid === connector.uid;
                const isAvailable = walletAvailability[connector.uid] ?? true;
                const status = id === 'walletconnect' ? 'QR or mobile' : isAvailable ? 'Installed' : 'Not detected';
                return (
                  <button
                    key={connector.uid}
                    disabled={isPending}
                    onClick={async () => {
                      setConnectingConnectorUid(connector.uid);
                      try {
                        await connectAsync({ connector });
                        setShowConnect(false);
                      } catch (e) {
                        onError(errorMessage(e));
                      } finally {
                        setConnectingConnectorUid(null);
                      }
                    }}
                    className="grid w-full grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-[#292b31] bg-[#0c0d11] px-3 py-3 text-left transition-colors enabled:hover:border-[#f26822] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <WalletLogo id={id} icon={icon} name={name} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-white">{name}</span>
                      <span className="block truncate text-xs text-[#8b919d]">{description}</span>
                    </span>
                    <span className="rounded-full border border-[#292b31] px-2 py-1 text-xs text-[#a9afba]">
                      {isConnecting ? 'Connecting' : status}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type WalletIconId = 'metamask' | 'rabby' | 'coinbase' | 'phantom' | 'walletconnect' | 'browser' | 'generic';

type WalletOption = {
  connector: Connector;
  description: string;
  icon?: string;
  id: WalletIconId;
  name: string;
  order: number;
};

const WALLET_META: Record<WalletIconId, Omit<WalletOption, 'connector' | 'icon'>> = {
  metamask: {
    id: 'metamask',
    name: 'MetaMask',
    description: 'Browser extension or mobile wallet',
    order: 10,
  },
  rabby: {
    id: 'rabby',
    name: 'Rabby',
    description: 'Browser extension wallet',
    order: 20,
  },
  coinbase: {
    id: 'coinbase',
    name: 'Coinbase Wallet',
    description: 'Browser extension wallet',
    order: 30,
  },
  phantom: {
    id: 'phantom',
    name: 'Phantom',
    description: 'Phantom Ethereum wallet',
    order: 40,
  },
  walletconnect: {
    id: 'walletconnect',
    name: 'WalletConnect',
    description: 'Scan with mobile or desktop wallet',
    order: 50,
  },
  browser: {
    id: 'browser',
    name: 'Browser Wallet',
    description: 'Use the active injected wallet',
    order: 60,
  },
  generic: {
    id: 'generic',
    name: 'Wallet',
    description: 'Injected EVM wallet',
    order: 70,
  },
};

function buildWalletOptions(connectors: readonly Connector[]): WalletOption[] {
  const byWallet = new Map<string, WalletOption>();
  for (const option of connectors
    .map((connector) => {
      const id = walletIconId(connector);
      const meta = WALLET_META[id];
      const name = id === 'generic' ? normalizeConnectorName(connector.name) : meta.name;
      const description = id === 'generic' ? 'EVM wallet' : meta.description;
      return {
        connector,
        description,
        icon: connector.icon,
        id,
        name,
        order: meta.order,
      };
    })) {
    const duplicateKey = option.id === 'browser' || option.id === 'generic'
      ? `${option.id}:${option.name}`
      : option.id;
    const existing = byWallet.get(duplicateKey);
    if (!existing || (!existing.icon && option.icon)) {
      byWallet.set(duplicateKey, option);
    }
  }

  return Array.from(byWallet.values())
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

function useConnectorAvailability(walletOptions: readonly WalletOption[]): Record<string, boolean> {
  const [availability, setAvailability] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      walletOptions.map(async ({ connector, id }) => {
        if (id === 'walletconnect') return [connector.uid, true] as const;
        try {
          return [connector.uid, Boolean(await connector.getProvider())] as const;
        } catch {
          return [connector.uid, false] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) setAvailability(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [walletOptions]);

  return availability;
}

function walletIconId(connector: Connector): WalletIconId {
  const id = connector.id.toLowerCase();
  const name = connector.name.toLowerCase();
  if (id.includes('metamask') || name.includes('metamask')) return 'metamask';
  if (id.includes('rabby') || name.includes('rabby')) return 'rabby';
  if (id.includes('coinbase') || name.includes('coinbase')) return 'coinbase';
  if (id.includes('phantom') || name.includes('phantom')) return 'phantom';
  if (id.includes('walletconnect') || name.includes('walletconnect')) return 'walletconnect';
  if (id === 'injected' || name === 'injected') return 'browser';
  return 'generic';
}

function normalizeConnectorName(name: string): string {
  return name === 'Injected' ? 'Browser Wallet' : name;
}

function WalletLogo({ icon, id, name }: { icon?: string; id: WalletIconId; name: string }) {
  if (icon) {
    return (
      <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white">
        <span
          aria-hidden="true"
          className="h-7 w-7 bg-contain bg-center bg-no-repeat"
          style={{ backgroundImage: `url(${icon})` }}
        />
      </span>
    );
  }

  if (id === 'walletconnect') {
    return (
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#2b6fff]">
        <svg viewBox="0 0 32 32" aria-hidden="true" className="h-7 w-7 text-white">
          <path fill="currentColor" d="M9.1 13.4a9.8 9.8 0 0 1 13.8 0l.5.5a.6.6 0 0 1 0 .8l-1.7 1.7a.4.4 0 0 1-.6 0l-.7-.7a6.3 6.3 0 0 0-8.8 0l-.8.8a.4.4 0 0 1-.6 0l-1.7-1.8a.6.6 0 0 1 0-.8l.6-.5Z" />
          <path fill="currentColor" d="m26 16.5 1.5 1.5a.6.6 0 0 1 0 .8l-6.8 6.8a.7.7 0 0 1-1 0l-4.8-4.8a.2.2 0 0 0-.3 0l-4.8 4.8a.7.7 0 0 1-1 0L2 18.8a.6.6 0 0 1 0-.8l1.5-1.5a.6.6 0 0 1 .8 0l5 5a.2.2 0 0 0 .3 0l4.8-4.8a.7.7 0 0 1 1 0l4.8 4.8a.2.2 0 0 0 .3 0l5-5a.6.6 0 0 1 .8 0Z" />
        </svg>
      </span>
    );
  }

  const styles: Record<WalletIconId, string> = {
    metamask: 'bg-[#f6851b] text-[#22170f]',
    rabby: 'bg-[#9de5ff] text-[#09131a]',
    coinbase: 'bg-[#0052ff] text-white',
    phantom: 'bg-[#ab9ff2] text-[#171020]',
    walletconnect: 'bg-[#2b6fff] text-white',
    browser: 'bg-[#252932] text-white',
    generic: 'bg-[#252932] text-white',
  };
  const label = id === 'metamask' ? 'M' : id === 'coinbase' ? 'C' : id === 'phantom' ? 'P' : id === 'rabby' ? 'R' : name.slice(0, 1).toUpperCase();

  return (
    <span className={`flex h-10 w-10 items-center justify-center rounded-xl text-base font-black ${styles[id]}`}>
      {label}
    </span>
  );
}

function OrderStatusPanel({ order }: { order: Order | null }) {
  const isSolanaDirect = order?.sourceChain === 'solana';
  const isBitcoinDeposit = order?.funding.type === 'deposit-address' && order.funding.chainId === 'bitcoin';
  const isBitcoinPayout = order?.destinationChain === 'bitcoin';
  const steps = order?.direction === REVERSE_DIRECTION
    ? [
        { label: 'XMR deposit', statuses: ['awaiting_deposit'] as Order['status'][] },
        { label: 'Bridge mint', statuses: ['minted'] as Order['status'][] },
        { label: 'Swap', statuses: ['swapping'] as Order['status'][] },
        { label: isBitcoinPayout ? 'THORChain payout' : isSolanaDirect ? 'Solana payout' : 'Mayan payout', statuses: ['withdrawing', 'completed'] as Order['status'][] },
      ]
    : isSolanaDirect
      ? [
          { label: 'Deposit', statuses: ['awaiting_deposit', 'minted'] as Order['status'][] },
          { label: 'Swap', statuses: ['swapping'] as Order['status'][] },
          { label: 'XMR payout', statuses: ['withdrawing', 'completed'] as Order['status'][] },
        ]
      : isBitcoinDeposit
        ? [
            { label: 'BTC deposit', statuses: ['awaiting_deposit'] as Order['status'][] },
            { label: 'THORChain delivery', statuses: ['bridging', 'minted'] as Order['status'][] },
            { label: 'Jupiter swap', statuses: ['swapping'] as Order['status'][] },
            { label: 'XMR payout', statuses: ['withdrawing', 'completed'] as Order['status'][] },
          ]
      : [
        { label: 'Deposit', statuses: ['awaiting_deposit'] as Order['status'][] },
        { label: 'Bridge', statuses: ['bridging', 'minted'] as Order['status'][] },
        { label: 'Swap', statuses: ['swapping'] as Order['status'][] },
        { label: 'Payout', statuses: ['withdrawing', 'completed'] as Order['status'][] },
      ];

  return (
    <div className="rounded-2xl border border-[#292b31] bg-[#0f1015] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">Order</h2>
          <p className={`text-xs text-[#8b919d] ${order ? 'font-mono' : ''}`}>{order ? shortId(order.id) : 'No active order'}</p>
        </div>
        {order && <StatusBadge status={order.status} />}
      </div>
      {!order ? (
        <div className="rounded-2xl border border-dashed border-[#30333b] bg-[#0c0d11] px-4 py-8 text-center text-sm text-[#8b919d]">
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
                  <div className={`h-2.5 w-2.5 rounded-full ${isDone ? 'bg-[#35d071]' : isActive ? 'animate-pulse bg-[#f26822] motion-reduce:animate-none' : 'bg-[#343842]'}`} />
                  <span className={isDone || isActive ? 'text-sm text-white' : 'text-sm text-[#8b919d]'}>{step.label}</span>
                </div>
              );
            })}
          </div>
          <div className="grid gap-2 rounded-2xl border border-[#292b31] bg-[#0c0d11] p-3 text-sm">
            {order.sourceTxHash && <ExplorerLink chain={isBitcoinPayout ? 'ethereum' : order.sourceChain} hash={order.sourceTxHash} label={isBitcoinPayout ? 'ETH USDC delivery' : order.direction === REVERSE_DIRECTION ? 'Destination transaction' : 'Source transaction'} />}
            {order.solanaMintSignature && <ExplorerLink chain="solana" hash={order.solanaMintSignature} label={order.direction === REVERSE_DIRECTION ? 'Bridge claim' : isBitcoinDeposit ? 'THORChain delivery' : 'Mayan delivery'} />}
            {order.swapSignature && <ExplorerLink chain="solana" hash={order.swapSignature} label="Jupiter swap" />}
            {order.withdrawalSignature && <ExplorerLink chain={isBitcoinPayout && order.status === 'completed' ? 'bitcoin' : isBitcoinPayout ? 'ethereum' : 'solana'} hash={order.withdrawalSignature} label={isBitcoinPayout ? order.status === 'completed' ? 'BTC payout' : 'THORChain funding' : order.direction === REVERSE_DIRECTION ? (isSolanaDirect ? 'Solana payout' : 'Mayan payout') : 'Withdrawal request'} />}
            {order.error && <div className="text-sm text-[#ff8c8c]">{order.error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function useDialogFocus(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const selector = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
    if (node && !node.contains(document.activeElement)) {
      node.querySelector<HTMLElement>(selector)?.focus();
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(selector));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previous?.focus?.();
    };
  }, [active]);
  return ref;
}

function useEscapeKey(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, onEscape]);
}

function useCopyFeedback(): [boolean, (value?: string) => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = (value?: string) => {
    if (!value || !navigator.clipboard) return;
    navigator.clipboard.writeText(value).then(() => setCopied(true)).catch(() => {});
  };
  return [copied, copy];
}

function CopyAddressButton({ label, value }: { label: string; value?: string }) {
  const [copied, copy] = useCopyFeedback();
  return (
    <button
      onClick={() => copy(value)}
      disabled={!value}
      className={`w-full rounded-xl border px-4 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        copied
          ? 'border-[#35d071]/50 bg-[#122316] text-[#9ee6a8]'
          : 'border-[#493424] bg-[#23170e] text-white enabled:hover:border-[#f26822]'
      }`}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

function TokenLogo({ token }: { token?: MayanToken }) {
  if (['XMR', 'XMR-SOL'].includes((token?.symbol ?? '').toUpperCase())) {
    return <MoneroLogo className="h-8 w-8 shrink-0" />;
  }
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
      <div className="truncate text-[11px] uppercase tracking-[0.08em] text-[#8b919d]">{label}</div>
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
  return <div className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${palette}`}>{status.replace(/_/g, ' ')}</div>;
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-2xl border border-[#6d2a2a] bg-[#2a1111] px-3.5 py-3 text-sm text-[#ffb8b8]">
      <svg viewBox="0 0 16 16" aria-hidden className="mt-0.5 h-4 w-4 shrink-0">
        <path d="M8 1.5 15 14H1L8 1.5Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M8 6.5v3.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="12" r="0.85" fill="currentColor" />
      </svg>
      <span className="min-w-0 break-words leading-relaxed">{message}</span>
    </div>
  );
}

function ExplorerLink({ chain, hash, label }: { chain: SourceChainId; hash: string; label: string }) {
  const explorer = CHAINS[chain].explorerTxUrl;
  if (!explorer) {
    return <div className="truncate font-mono text-[13px] text-[#f2a269]" title={hash}>{label}: {shortId(hash)}</div>;
  }
  return (
    <a
      href={`${explorer}${hash}`}
      target="_blank"
      rel="noreferrer"
      className="block truncate font-mono text-[13px] text-[#f2a269] transition-colors hover:text-[#f26822]"
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
  if (direction === ASSET_DIRECTION) {
    const destinationChain = quote?.destinationChain ?? sourceChain;
    const destinationSymbol = quote?.destinationTokenSymbol ?? 'Token';
    if (quote?.route === 'thorchain' && destinationChain === 'bitcoin') {
      return [
        {
          title: `${sourceSymbol} on ${CHAINS[sourceChain].name}`,
          caption: sourceChain === 'solana' ? 'Solana source' : 'Source wallet',
          detail: quote.routeSummary ?? 'The selected source asset starts the route.',
        },
        {
          title: 'USDC on Solana',
          caption: sourceChain === 'solana' ? 'jup.ag route' : 'Mayan Swift v2 delivery',
          detail: sourceChain === 'solana'
            ? 'Jupiter normalizes the selected Solana token into USDC when needed.'
            : 'Mayan delivers source-chain value into Solana USDC for the payout route.',
        },
        {
          title: 'USDC on Ethereum',
          caption: 'Mayan Swift v2',
          detail: 'Solana USDC is forwarded to the Ethereum hot wallet for THORChain.',
        },
        {
          title: 'BTC on Bitcoin',
          caption: 'THORChain payout',
          detail: 'THORChain swaps Ethereum USDC into native BTC for your receive address.',
        },
      ];
    }
    return [
      {
        title: `${sourceSymbol} on ${CHAINS[sourceChain].name}`,
        caption: quote?.route === 'solana' ? 'Solana source' : quote?.route === 'chainflip' ? 'Bitcoin deposit' : 'Source wallet',
        detail: quote?.routeSummary ?? 'The selected source asset starts the route.',
      },
      {
        title: `${destinationSymbol} on ${CHAINS[destinationChain].name}`,
        caption: quote?.route === 'mayan' ? 'Mayan Swift v2 delivery' : quote?.route === 'solana' ? 'jup.ag / Solana payout' : 'Final payout',
        detail: 'The selected output asset is paid to your receive address.',
      },
    ];
  }

  if (direction === REVERSE_DIRECTION) {
    const destinationSymbol = quote?.destinationTokenSymbol ?? selectedToken?.symbol ?? 'Token';
    const destinationChain = quote?.destinationChain ?? sourceChain;
    if (quote?.route === 'thorchain' && destinationChain === 'bitcoin') {
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
          caption: 'USDC-SOL to USDC-ETH',
          detail: 'Mayan forwards Solana USDC to the Ethereum hot wallet.',
        },
        {
          title: 'THORChain',
          caption: 'USDC-ETH to BTC',
          detail: 'THORChain pays native BTC to your Bitcoin receive address.',
        },
      ];
    }
    if (destinationChain === 'solana' || quote?.route === 'solana') {
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
        caption: `USDC-SOL to ${CHAINS[destinationChain].name}`,
        detail: 'Mayan pays the selected token to your destination-chain address.',
      },
    ];
  }

  if (sourceChain === 'solana' || quote?.route === 'solana') {
    return [
      {
        title: `${sourceSymbol} on Solana`,
        caption: 'Wallet-signed Jupiter swap',
        detail: 'Your wallet swaps the selected SPL token into XMR-SOL without sending tokens to the hot wallet.',
      },
      {
        title: 'jup.ag',
        caption: `${sourceSymbol} to XMR-SOL`,
        detail: 'Jupiter swaps the selected Solana token into XMR-SOL.',
      },
      {
        title: 'Monero Bridge',
        caption: 'XMR-SOL to native XMR',
        detail: 'Your wallet submits the withdrawal request for the final Monero address.',
      },
    ];
  }

  if (sourceChain === 'bitcoin' || quote?.route === 'chainflip' || quote?.route === 'thorchain') {
    if (quote?.route !== 'thorchain') {
      return [
        {
          title: 'BTC on Bitcoin',
          caption: 'Bitcoin deposit',
          detail: 'You send BTC to the order-specific Chainflip deposit address.',
        },
        {
          title: 'Chainflip',
          caption: 'BTC to USDC-SOL',
          detail: 'Chainflip swaps BTC and delivers Solana USDC to the hot wallet.',
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

    return [
      {
        title: 'BTC on Bitcoin',
        caption: 'Bitcoin deposit',
        detail: 'You send BTC to the order-specific THORChain deposit address with the generated memo.',
      },
      {
        title: 'THORChain',
        caption: quote?.thorchain?.mode === 'eth-usdc-fallback' ? 'BTC to USDC-ETH' : 'BTC to USDC-SOL',
        detail: quote?.thorchain?.mode === 'eth-usdc-fallback'
          ? 'THORChain routes BTC into Ethereum USDC for the hot wallet.'
          : 'THORChain routes BTC directly into Solana USDC for the hot wallet.',
      },
      ...(quote?.thorchain?.mode === 'eth-usdc-fallback' ? [{
        title: 'Mayan Swift v2',
        caption: 'USDC-ETH to USDC-SOL',
        detail: 'The hot wallet forwards Ethereum USDC into Solana USDC.',
      }] : []),
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

const CHAIN_DISPLAY_PRIORITY: readonly SourceChainId[] = ['monero', 'ethereum', 'solana', 'bitcoin', 'base', 'arbitrum', 'optimism', 'polygon', 'bsc', 'avalanche', 'sui', 'linea', 'hyperevm', 'hyperliquid', 'monad'];

function sortChainsForDisplay(chains: readonly SourceChainId[]): readonly SourceChainId[] {
  const rank = (chain: SourceChainId) => {
    const index = CHAIN_DISPLAY_PRIORITY.indexOf(chain);
    return index === -1 ? CHAIN_DISPLAY_PRIORITY.length : index;
  };
  return [...chains].sort((a, b) => rank(a) - rank(b));
}

function selectableSourceChains(): readonly SourceChainId[] {
  return sortChainsForDisplay(['monero', 'bitcoin', ...MAYAN_SWIFT_EVM_SOURCE_CHAINS, 'solana']);
}

function selectableDestinationChains(): readonly SourceChainId[] {
  return sortChainsForDisplay(['monero', 'bitcoin', ...MAYAN_SWIFT_SOURCE_CHAINS, 'solana']);
}

async function loadTokensForChain(chainId: SourceChainId): Promise<MayanToken[]> {
  if (chainId === 'monero') return [XMR_TOKEN];
  const tokens = await api<MayanToken[]>(`/tokens/${chainId}`);
  const filtered = filterMayanTokensForChain(tokens, chainId);
  const withWxmr = chainId === 'solana' && !filtered.some((token) => tokenAddress(token)?.toLowerCase() === WXMR_MINT_ADDRESS.toLowerCase())
    ? [WXMR_SOL_TOKEN, ...filtered]
    : filtered.map((token) => tokenAddress(token)?.toLowerCase() === WXMR_MINT_ADDRESS.toLowerCase() ? { ...WXMR_SOL_TOKEN, ...token, symbol: 'XMR-SOL' } : token);
  return sortTokensByRelevance(withWxmr, chainId);
}

function formatReceivePreview({
  direction,
  quote,
  token,
  destinationDecimals,
}: {
  direction: SwapDirection;
  quote: Quote | null;
  token?: MayanToken;
  destinationDecimals: number;
}): string {
  if (!quote) return direction === FORWARD_DIRECTION ? '0.000000' : '0.00';
  if (direction === FORWARD_DIRECTION) return formatXmr(quote.estimatedXmrOut);
  return formatBaseUnits(quote.estimatedDestinationOut ?? '0', quote.destinationTokenDecimals ?? token?.decimals ?? destinationDecimals);
}

function getPrimaryLabel({
  quote,
  quoteMatchesInputs,
  order,
  isLoading,
  isQuoteRefreshing,
  quoteExpired,
  createOrderBlocker,
}: {
  quote: Quote | null;
  quoteMatchesInputs: boolean;
  order: Order | null;
  isLoading: boolean;
  isQuoteRefreshing: boolean;
  quoteExpired: boolean;
  createOrderBlocker: string | null;
}): string {
  if (isLoading) return quote ? 'Creating order...' : 'Fetching route...';
  if (order) return 'Order created';
  if (quote && isQuoteRefreshing) return quoteMatchesInputs ? (createOrderBlocker ?? 'Create order') : 'Updating quote...';
  if (quote && !quoteMatchesInputs) return 'Refresh quote';
  if (quoteExpired) return 'Refresh quote';
  if (quote && createOrderBlocker) return createOrderBlocker;
  if (quote) return 'Create order';
  return 'Preview exchange';
}

function getCreateOrderBlocker({
  direction,
  quote,
  hasPositiveQuoteOutput,
  hasBitcoinRefundAddress,
  hasValidXmrAddress,
  requiresXmrAddress,
  destinationAddressOk,
  isSameAsset,
}: {
  direction: SwapDirection;
  quote: Quote | null;
  hasPositiveQuoteOutput: boolean;
  hasBitcoinRefundAddress: boolean;
  hasValidXmrAddress: boolean;
  requiresXmrAddress: boolean;
  destinationAddressOk: boolean;
  isSameAsset: boolean;
}): string | null {
  if (isSameAsset) return 'Choose different assets';
  if (requiresXmrAddress && !hasValidXmrAddress) {
    return direction === FORWARD_DIRECTION ? 'Enter XMR address' : 'Enter XMR refund address';
  }
  if (quote && !hasPositiveQuoteOutput) {
    return 'Quote output is zero';
  }
  if ((direction === FORWARD_DIRECTION || direction === ASSET_DIRECTION) && quote?.route === 'chainflip' && !hasBitcoinRefundAddress) {
    return 'Enter BTC refund address';
  }
  if (direction !== FORWARD_DIRECTION && !destinationAddressOk) return 'Enter destination address';
  return null;
}

function getPrimaryDisabled({
  canPreviewQuote,
  canCreateOrder,
  quote,
  quoteMatchesInputs,
  order,
  isLoading,
  isQuoteRefreshing,
  quoteExpired,
}: {
  canPreviewQuote: boolean;
  canCreateOrder: boolean;
  quote: Quote | null;
  quoteMatchesInputs: boolean;
  order: Order | null;
  isLoading: boolean;
  isQuoteRefreshing: boolean;
  quoteExpired: boolean;
}): boolean {
  if (isLoading || isQuoteRefreshing || order) return true;
  if (quote && !quoteMatchesInputs) return !canPreviewQuote;
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
  const minutes = Math.floor(value / 60).toString().padStart(2, '0');
  const seconds = (value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function routeModeLabel(direction: SwapDirection): string {
  if (direction === FORWARD_DIRECTION) return 'To XMR';
  if (direction === REVERSE_DIRECTION) return 'From XMR';
  return 'Asset swap';
}

function orderInputDecimals(order: Order): number {
  return order.direction === REVERSE_DIRECTION
    ? XMR_DECIMALS
    : order.funding.type === 'mayan-swift'
      ? order.funding.tokenDecimals ?? 6
      : order.funding.type === 'solana-direct'
        ? order.funding.inputTokenDecimals ?? 6
    : order.funding.type === 'solana-transfer'
      ? order.funding.tokenDecimals ?? 6
      : order.funding.chainId === 'bitcoin'
        ? 8
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

function placeholderAddressForChain(chainId: SourceChainId): string {
  const chain = CHAINS[chainId];
  if (chainId === 'solana') return QUOTE_PLACEHOLDER_SOLANA_ADDRESS;
  if (chainId === 'bitcoin') return QUOTE_PLACEHOLDER_BTC_ADDRESS;
  if (chainId === 'sui') return QUOTE_PLACEHOLDER_SUI_ADDRESS;
  if (chainId === 'monero') return QUOTE_PLACEHOLDER_XMR_ADDRESS;
  if (chain.kind === 'evm' || chain.kind === 'hypercore') return QUOTE_PLACEHOLDER_EVM_ADDRESS;
  return QUOTE_PLACEHOLDER_SOLANA_ADDRESS;
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

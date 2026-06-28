import { NextResponse } from 'next/server';
import { USDC_MINT_ADDRESS, WXMR_MINT_ADDRESS } from '@wxmr/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TRADE_SIZES_USD = [1, 5, 10] as const;
const USDC_DECIMALS = 6;
const XMR_DECIMALS = 12;
const JUPITER_QUOTE_URLS = [
  'https://api.jup.ag/swap/v1/quote',
  'https://lite-api.jup.ag/swap/v1/quote',
] as const;
const KUCOIN_BOOK_URL = 'https://api.kucoin.com/api/v1/market/orderbook/level2_20?symbol=XMR-USDT';
const REQUEST_TIMEOUT_MS = 8_000;
const SNAPSHOT_CACHE_MS = 10_000;
const JUPITER_REQUEST_GAP_MS = 700;
const JUPITER_MAX_ATTEMPTS = 3;
const JUPITER_RETRY_BASE_MS = 1_500;

let cachedSnapshot: {
  createdAt: number;
  payload: QuoteSnapshot;
} | null = null;

type VenueQuote = {
  ok: boolean;
  venue: 'solana' | 'kucoin';
  source: string;
  xmrAmount: number | null;
  usdAmount: number | null;
  effectivePrice: number | null;
  priceImpactPct?: number | null;
  routeCount?: number | null;
  error?: string;
};

type QuoteRow = {
  sizeUsd: number;
  sellXmrAmount: number | null;
  buy: {
    solana: VenueQuote;
    kucoin: VenueQuote;
    solanaEdgeBps: number | null;
    betterVenue: 'solana' | 'kucoin' | null;
  };
  sell: {
    solana: VenueQuote;
    kucoin: VenueQuote;
    solanaEdgeBps: number | null;
    betterVenue: 'solana' | 'kucoin' | null;
  };
};

type QuoteSnapshot = {
  timestamp: string;
  tradeSizesUsd: readonly number[];
  referencePrice: number | null;
  sources: {
    solana: string;
    kucoin: string;
  };
  notes: string[];
  rows: QuoteRow[];
};

type JupiterQuote = {
  inAmount?: string;
  outAmount?: string;
  priceImpactPct?: string;
  routePlan?: unknown[];
  error?: string;
  errorCode?: string;
  errorMessage?: string;
};

type KucoinBook = {
  bestBid: number | null;
  bestAsk: number | null;
  midPrice: number | null;
  bids: PriceLevel[];
  asks: PriceLevel[];
  error?: string;
};

type PriceLevel = {
  price: number;
  size: number;
};

type KucoinBookResponse = {
  code?: string;
  msg?: string;
  data?: {
    bids?: [string, string][];
    asks?: [string, string][];
  };
};

export async function GET() {
  if (cachedSnapshot && Date.now() - cachedSnapshot.createdAt < SNAPSHOT_CACHE_MS) {
    return quoteJson(cachedSnapshot.payload);
  }

  const timestamp = new Date().toISOString();
  const kucoinBookPromise = fetchKucoinBook();
  const solanaBuyQuotes = await fetchJupiterQuotesInOrder(TRADE_SIZES_USD.map((sizeUsd) => () => (
    fetchJupiterQuote({
      inputMint: USDC_MINT_ADDRESS,
      outputMint: WXMR_MINT_ADDRESS,
      inputAmount: usdToBaseUnits(sizeUsd),
      side: 'buy',
      sizeUsd,
    })
  )));

  const kucoinBook = await kucoinBookPromise;

  const referencePrice = getReferencePrice(kucoinBook, solanaBuyQuotes);
  const sellAmounts = TRADE_SIZES_USD.map((sizeUsd) => (
    referencePrice ? xmrToBaseUnits(sizeUsd / referencePrice) : null
  ));
  const solanaSellQuotes = await fetchJupiterQuotesInOrder(
    sellAmounts.map((amount, index) => () => (
      amount
        ? fetchJupiterQuote({
            inputMint: WXMR_MINT_ADDRESS,
            outputMint: USDC_MINT_ADDRESS,
            inputAmount: amount,
            side: 'sell',
            sizeUsd: TRADE_SIZES_USD[index],
          })
        : Promise.resolve(unavailableQuote('solana', 'Jupiter quote', 'Reference price unavailable'))
    )),
  );

  const rows: QuoteRow[] = TRADE_SIZES_USD.map((sizeUsd, index) => {
    const sellAmount = sellAmounts[index];
    const kucoinBuy = quoteKucoinBuy(kucoinBook, sizeUsd);
    const kucoinSell = sellAmount
      ? quoteKucoinSell(kucoinBook, Number(sellAmount) / 10 ** XMR_DECIMALS)
      : unavailableQuote('kucoin', 'KuCoin XMR-USDT order book', 'Reference price unavailable');

    return {
      sizeUsd,
      sellXmrAmount: sellAmount ? Number(sellAmount) / 10 ** XMR_DECIMALS : null,
      buy: {
        solana: solanaBuyQuotes[index],
        kucoin: kucoinBuy,
        ...compareOutputs(solanaBuyQuotes[index].xmrAmount, kucoinBuy.xmrAmount),
      },
      sell: {
        solana: solanaSellQuotes[index],
        kucoin: kucoinSell,
        ...compareOutputs(solanaSellQuotes[index].usdAmount, kucoinSell.usdAmount),
      },
    };
  });

  const payload: QuoteSnapshot = {
    timestamp,
    tradeSizesUsd: TRADE_SIZES_USD,
    referencePrice,
    sources: {
      solana: 'Jupiter quote USDC/XMR on Solana',
      kucoin: 'KuCoin public XMR-USDT level2_20 order book',
    },
    notes: [
      'KuCoin values are public order-book estimates before exchange account fees.',
      'Solana values are Jupiter quote estimates without a taker wallet.',
    ],
    rows,
  };
  cachedSnapshot = {
    createdAt: Date.now(),
    payload,
  };

  return quoteJson(payload);
}

function quoteJson(payload: QuoteSnapshot) {
  return NextResponse.json(payload, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

async function fetchJupiterQuotesInOrder(tasks: (() => Promise<VenueQuote>)[]): Promise<VenueQuote[]> {
  const quotes: VenueQuote[] = [];
  for (const task of tasks) {
    if (quotes.length > 0) {
      await sleep(JUPITER_REQUEST_GAP_MS);
    }
    quotes.push(await task());
  }
  return quotes;
}

async function fetchJupiterQuote({
  inputMint,
  outputMint,
  inputAmount,
  side,
  sizeUsd,
}: {
  inputMint: string;
  outputMint: string;
  inputAmount: bigint;
  side: 'buy' | 'sell';
  sizeUsd: number;
}): Promise<VenueQuote> {
  const search = new URLSearchParams({
    inputMint,
    outputMint,
    amount: inputAmount.toString(),
  });

  try {
    let data: JupiterQuote = {};
    let status = 0;
    for (let attempt = 0; attempt < JUPITER_MAX_ATTEMPTS; attempt += 1) {
      for (const baseUrl of JUPITER_QUOTE_URLS) {
        const response = await fetch(`${baseUrl}?${search}`, {
          cache: 'no-store',
          headers: jupiterHeaders(),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        status = response.status;
        data = await response.json().catch(() => ({})) as JupiterQuote;
        if (response.ok && !data.error && !data.errorCode && !data.errorMessage && data.outAmount) {
          break;
        }
      }
      if (data.outAmount && !data.error && !data.errorCode && !data.errorMessage) {
        break;
      }
      if (status !== 429 || attempt === JUPITER_MAX_ATTEMPTS - 1) {
        return unavailableQuote(
          'solana',
          'Jupiter quote',
          data.errorMessage || data.error || `Jupiter quote failed: ${status}`,
        );
      }
      await sleep(JUPITER_RETRY_BASE_MS * (attempt + 1));
    }

    if (!data.outAmount) {
      return unavailableQuote('solana', 'Jupiter quote', `Jupiter quote failed: ${status || 'no output'}`);
    }

    const xmrAmount = side === 'buy' ? Number(data.outAmount) / 10 ** XMR_DECIMALS : Number(inputAmount) / 10 ** XMR_DECIMALS;
    const usdAmount = side === 'buy' ? sizeUsd : Number(data.outAmount) / 10 ** USDC_DECIMALS;
    return {
      ok: true,
      venue: 'solana',
      source: 'Jupiter quote',
      xmrAmount,
      usdAmount,
      effectivePrice: xmrAmount > 0 ? usdAmount / xmrAmount : null,
      priceImpactPct: data.priceImpactPct === undefined ? null : Number(data.priceImpactPct),
      routeCount: Array.isArray(data.routePlan) ? data.routePlan.length : null,
    };
  } catch (error) {
    return unavailableQuote('solana', 'Jupiter quote', errorMessage(error, 'Jupiter quote failed'));
  }
}

async function fetchKucoinBook(): Promise<KucoinBook> {
  try {
    const response = await fetch(KUCOIN_BOOK_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data = await response.json().catch(() => ({})) as KucoinBookResponse;
    if (!response.ok || data.code !== '200000' || !data.data) {
      return emptyKucoinBook(data.msg || `KuCoin order book failed: ${response.status}`);
    }

    const bids = normalizeLevels(data.data.bids ?? []);
    const asks = normalizeLevels(data.data.asks ?? []);
    const bestBid = bids[0]?.price ?? null;
    const bestAsk = asks[0]?.price ?? null;
    const midPrice = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : null;

    return {
      bestBid,
      bestAsk,
      midPrice,
      bids,
      asks,
    };
  } catch (error) {
    return emptyKucoinBook(errorMessage(error, 'KuCoin order book failed'));
  }
}

function quoteKucoinBuy(book: KucoinBook, sizeUsd: number): VenueQuote {
  if (book.error) {
    return unavailableQuote('kucoin', 'KuCoin XMR-USDT order book', book.error);
  }
  if (!book.asks.length) {
    return unavailableQuote('kucoin', 'KuCoin XMR-USDT order book', 'KuCoin asks unavailable');
  }

  let remainingUsd = sizeUsd;
  let xmrAmount = 0;
  let spentUsd = 0;

  for (const level of book.asks) {
    if (remainingUsd <= 0) break;
    const maxLevelUsd = level.price * level.size;
    const spendUsd = Math.min(remainingUsd, maxLevelUsd);
    xmrAmount += spendUsd / level.price;
    spentUsd += spendUsd;
    remainingUsd -= spendUsd;
  }

  if (remainingUsd > 0.000001 || xmrAmount <= 0) {
    return unavailableQuote('kucoin', 'KuCoin XMR-USDT order book', 'Insufficient visible ask depth');
  }

  return {
    ok: true,
    venue: 'kucoin',
    source: 'KuCoin XMR-USDT order book',
    xmrAmount,
    usdAmount: spentUsd,
    effectivePrice: spentUsd / xmrAmount,
  };
}

function quoteKucoinSell(book: KucoinBook, xmrInput: number): VenueQuote {
  if (book.error) {
    return unavailableQuote('kucoin', 'KuCoin XMR-USDT order book', book.error);
  }
  if (!book.bids.length) {
    return unavailableQuote('kucoin', 'KuCoin XMR-USDT order book', 'KuCoin bids unavailable');
  }

  let remainingXmr = xmrInput;
  let soldXmr = 0;
  let receivedUsd = 0;

  for (const level of book.bids) {
    if (remainingXmr <= 0) break;
    const xmrAtLevel = Math.min(remainingXmr, level.size);
    soldXmr += xmrAtLevel;
    receivedUsd += xmrAtLevel * level.price;
    remainingXmr -= xmrAtLevel;
  }

  if (remainingXmr > 0.000000000001 || soldXmr <= 0) {
    return unavailableQuote('kucoin', 'KuCoin XMR-USDT order book', 'Insufficient visible bid depth');
  }

  return {
    ok: true,
    venue: 'kucoin',
    source: 'KuCoin XMR-USDT order book',
    xmrAmount: soldXmr,
    usdAmount: receivedUsd,
    effectivePrice: receivedUsd / soldXmr,
  };
}

function compareOutputs(solanaOutput: number | null, kucoinOutput: number | null): {
  solanaEdgeBps: number | null;
  betterVenue: 'solana' | 'kucoin' | null;
} {
  if (!solanaOutput || !kucoinOutput || solanaOutput <= 0 || kucoinOutput <= 0) {
    return {
      solanaEdgeBps: null,
      betterVenue: null,
    };
  }

  const solanaEdgeBps = (solanaOutput / kucoinOutput - 1) * 10_000;
  return {
    solanaEdgeBps,
    betterVenue: solanaEdgeBps >= 0 ? 'solana' : 'kucoin',
  };
}

function getReferencePrice(book: KucoinBook, solanaBuyQuotes: VenueQuote[]): number | null {
  if (book.midPrice && book.midPrice > 0) {
    return book.midPrice;
  }

  const firstSolanaPrice = solanaBuyQuotes.find((quote) => quote.ok && quote.effectivePrice && quote.effectivePrice > 0)?.effectivePrice;
  return firstSolanaPrice ?? null;
}

function normalizeLevels(levels: [string, string][]): PriceLevel[] {
  return levels
    .map(([price, size]) => ({
      price: Number(price),
      size: Number(size),
    }))
    .filter((level) => Number.isFinite(level.price) && level.price > 0 && Number.isFinite(level.size) && level.size > 0);
}

function emptyKucoinBook(error: string): KucoinBook {
  return {
    bestBid: null,
    bestAsk: null,
    midPrice: null,
    bids: [],
    asks: [],
    error,
  };
}

function unavailableQuote(venue: VenueQuote['venue'], source: string, error: string): VenueQuote {
  return {
    ok: false,
    venue,
    source,
    xmrAmount: null,
    usdAmount: null,
    effectivePrice: null,
    error,
  };
}

function usdToBaseUnits(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** USDC_DECIMALS));
}

function xmrToBaseUnits(amount: number): bigint {
  return BigInt(Math.max(1, Math.floor(amount * 10 ** XMR_DECIMALS)));
}

function jupiterHeaders(): Record<string, string> {
  const apiKey = process.env.JUPITER_API_KEY || process.env.NEXT_PUBLIC_JUPITER_API_KEY;
  return apiKey ? { 'x-api-key': apiKey } : {};
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

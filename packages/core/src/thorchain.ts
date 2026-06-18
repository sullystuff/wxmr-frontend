export const THORCHAIN = {
  thornodeUrl: "https://thornode.thorchain.network",
  liquifyThornodeUrl: "https://gateway.liquify.com/chain/thorchain_api",
  btcAsset: "BTC.BTC",
  ethUsdcAsset: "ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48",
  solanaUsdcAsset: "SOL.USDC-EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
} as const;

export interface ThorchainClientOptions {
  fetch?: typeof fetch;
  thornodeUrl?: string;
  clientId?: string;
}

export interface ThorchainQuoteFees {
  asset?: string;
  affiliate?: string;
  outbound?: string;
  liquidity?: string;
  total?: string;
  slippage_bps?: number;
  total_bps?: number;
  [key: string]: unknown;
}

export interface ThorchainSwapQuote {
  inbound_address?: string;
  inbound_confirmation_blocks?: number;
  inbound_confirmation_seconds?: number;
  outbound_delay_blocks?: number;
  outbound_delay_seconds?: number;
  fees?: ThorchainQuoteFees;
  router?: string;
  expiry: number;
  warning?: string;
  notes?: string;
  dust_threshold?: string;
  recommended_min_amount_in?: string;
  recommended_gas_rate?: string;
  gas_rate_units?: string;
  memo?: string;
  expected_amount_out: string;
  max_streaming_quantity?: number;
  streaming_swap_blocks?: number;
  streaming_swap_seconds?: number;
  total_swap_seconds?: number;
}

export interface ThorchainCoin {
  asset: string;
  amount: string;
  decimals?: number;
}

export interface ThorchainTx {
  id?: string;
  chain?: string;
  from_address?: string;
  to_address?: string;
  coins?: ThorchainCoin[];
  gas?: ThorchainCoin[];
  memo?: string;
}

export interface ThorchainPlannedOutTx {
  chain?: string;
  to_address?: string;
  coin?: ThorchainCoin;
  refund?: boolean;
}

export interface ThorchainTxStatus {
  tx?: ThorchainTx;
  planned_out_txs?: ThorchainPlannedOutTx[];
  out_txs?: ThorchainTx[];
  stages?: Record<string, unknown>;
}

export class ThorchainClient {
  private readonly fetchImpl: typeof fetch;
  private readonly thornodeUrl: string;
  private readonly clientId?: string;

  constructor(options: ThorchainClientOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.thornodeUrl = (options.thornodeUrl ?? THORCHAIN.thornodeUrl).replace(/\/$/, "");
    this.clientId = options.clientId;
  }

  async fetchSwapQuote(params: {
    fromAsset: string;
    toAsset: string;
    amount: string | bigint;
    destination: string;
    refundAddress?: string;
    toleranceBps?: number;
    liquidityToleranceBps?: number;
    streamingInterval?: number;
    streamingQuantity?: number;
  }): Promise<ThorchainSwapQuote> {
    const url = new URL(`${this.thornodeUrl}/thorchain/quote/swap`);
    url.searchParams.set("from_asset", params.fromAsset);
    url.searchParams.set("to_asset", params.toAsset);
    url.searchParams.set("amount", params.amount.toString());
    url.searchParams.set("destination", params.destination);
    if (params.refundAddress) url.searchParams.set("refund_address", params.refundAddress);
    if (params.toleranceBps !== undefined) url.searchParams.set("tolerance_bps", String(params.toleranceBps));
    if (params.liquidityToleranceBps !== undefined) {
      url.searchParams.set("liquidity_tolerance_bps", String(params.liquidityToleranceBps));
    }
    if (params.streamingInterval !== undefined) url.searchParams.set("streaming_interval", String(params.streamingInterval));
    if (params.streamingQuantity !== undefined) url.searchParams.set("streaming_quantity", String(params.streamingQuantity));

    const quote = await this.request<ThorchainSwapQuote>(url);
    if (!quote.expected_amount_out || !quote.expiry) {
      throw new Error("THORChain quote is missing output amount or expiry");
    }
    if (!quote.inbound_address || !quote.memo) {
      throw new Error("THORChain quote is missing deposit address or memo");
    }
    return quote;
  }

  async fetchTxStatus(hash: string): Promise<ThorchainTxStatus> {
    return this.request<ThorchainTxStatus>(new URL(`${this.thornodeUrl}/thorchain/tx/status/${hash}`));
  }

  private async request<T>(url: URL): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.clientId) headers["x-client-id"] = this.clientId;
    const response = await this.fetchImpl(url.toString(), { headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.message || data?.error || `THORChain request failed: ${response.status}`;
      throw new Error(message);
    }
    return data as T;
  }
}

export function thorchainOutTx(status: ThorchainTxStatus, asset: string, toAddress?: string): ThorchainTx | undefined {
  const expectedAsset = asset.toUpperCase();
  const expectedAddress = toAddress?.toLowerCase();
  return status.out_txs?.find((tx) => {
    if (expectedAddress && tx.to_address?.toLowerCase() !== expectedAddress) return false;
    return tx.coins?.some((coin) => coin.asset.toUpperCase() === expectedAsset && BigInt(coin.amount) > 0n);
  });
}

export function thorchainPlannedRefund(status: ThorchainTxStatus): ThorchainPlannedOutTx | undefined {
  return status.planned_out_txs?.find((tx) => tx.refund === true);
}

export function thorchainTxAmount(tx: ThorchainTx, asset: string): string {
  const expectedAsset = asset.toUpperCase();
  const coin = tx.coins?.find((candidate) => candidate.asset.toUpperCase() === expectedAsset);
  if (!coin?.amount) throw new Error(`THORChain outbound is missing ${asset} amount`);
  return coin.amount;
}

export function thorchainAmountToBaseUnits(amount: string | bigint, assetDecimals: number): string {
  const raw = BigInt(amount);
  if (assetDecimals === 8) return raw.toString();
  if (assetDecimals < 8) return (raw / 10n ** BigInt(8 - assetDecimals)).toString();
  return (raw * 10n ** BigInt(assetDecimals - 8)).toString();
}

export function baseUnitsToThorchainAmount(amount: string | bigint, assetDecimals: number): string {
  const raw = BigInt(amount);
  if (assetDecimals === 8) return raw.toString();
  if (assetDecimals < 8) return (raw * 10n ** BigInt(8 - assetDecimals)).toString();
  return (raw / 10n ** BigInt(assetDecimals - 8)).toString();
}

export function thorchainSeconds(quote: ThorchainSwapQuote): number | undefined {
  if (quote.total_swap_seconds !== undefined) return quote.total_swap_seconds;
  const inbound = quote.inbound_confirmation_seconds ?? 0;
  const streaming = quote.streaming_swap_seconds ?? 0;
  const outbound = quote.outbound_delay_seconds ?? 0;
  const total = inbound + streaming + outbound;
  return total > 0 ? total : undefined;
}

export const CHAINFLIP = {
  backendUrl: "https://chainflip-swap.chainflip.io",
  sdkVersion: "2.2.1",
  btc: { chain: "Bitcoin", asset: "BTC" },
  solanaUsdc: { chain: "Solana", asset: "USDC" },
  btcDecimals: 8,
  usdcDecimals: 6,
  blockTimeSeconds: 6,
} as const;

export interface ChainflipClientOptions {
  backendUrl?: string;
  fetch?: typeof fetch;
}

export interface ChainflipAsset {
  chain: string;
  asset: string;
}

export interface ChainflipFee {
  chain: string;
  asset: string;
  amount: string;
  type: string;
}

export interface ChainflipPoolInfo {
  baseAsset: ChainflipAsset;
  quoteAsset: ChainflipAsset;
  fee?: ChainflipFee;
}

export interface ChainflipQuote {
  intermediateAmount?: string;
  egressAmount: string;
  recommendedSlippageTolerancePercent?: number;
  recommendedLivePriceSlippageTolerancePercent?: number;
  recommendedRetryDurationMinutes?: number;
  includedFees?: ChainflipFee[];
  lowLiquidityWarning?: boolean;
  poolInfo?: ChainflipPoolInfo[];
  estimatedDurationsSeconds?: {
    deposit?: number;
    swap?: number;
    egress?: number;
  };
  estimatedDurationSeconds?: number;
  estimatedPrice: string;
  type: "REGULAR" | "DCA";
  srcAsset: ChainflipAsset;
  destAsset: ChainflipAsset;
  depositAmount: string;
  dcaParams?: {
    numberOfChunks: number;
    chunkIntervalBlocks: number;
  };
  maxBoostFeeBps?: number;
  boostQuote?: ChainflipBoostQuote;
}

export interface ChainflipBoostQuote extends ChainflipQuote {
  estimatedBoostFeeBps?: number;
  maxBoostFeeBps?: number;
}

export interface ChainflipDepositAddress {
  id: string;
  depositAddress: string;
  brokerCommissionBps: number;
  maxBoostFeeBps: number;
  issuedBlock?: number;
  srcChainExpiryBlock: string;
  estimatedExpiryTime?: number;
  channelOpeningFee: string;
}

export interface ChainflipEgress {
  amount?: string;
  txRef?: string;
  witnessedAt?: number;
  failure?: unknown;
}

export interface ChainflipDeposit {
  amount?: string;
  txRef?: string;
  failure?: unknown;
}

export interface ChainflipSwapStatus {
  state: "WAITING" | "RECEIVING" | "SWAPPING" | "SENDING" | "SENT" | "COMPLETED" | "FAILED";
  srcChain: string;
  srcAsset: string;
  destChain: string;
  destAsset: string;
  swapId: string;
  destAddress: string;
  deposit?: ChainflipDeposit;
  swapEgress?: ChainflipEgress;
  refundEgress?: ChainflipEgress;
  fallbackEgress?: ChainflipEgress;
  fees?: ChainflipFee[];
}

export class ChainflipClient {
  private readonly backendUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ChainflipClientOptions = {}) {
    this.backendUrl = (options.backendUrl ?? CHAINFLIP.backendUrl).replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? fetch;
  }

  async fetchBtcToSolanaUsdcQuote(params: {
    amount: string | bigint;
    brokerCommissionBps?: number;
  }): Promise<ChainflipQuote> {
    const url = new URL(`${this.backendUrl}/v2/quote`);
    url.searchParams.set("amount", params.amount.toString());
    url.searchParams.set("srcChain", CHAINFLIP.btc.chain);
    url.searchParams.set("srcAsset", CHAINFLIP.btc.asset);
    url.searchParams.set("destChain", CHAINFLIP.solanaUsdc.chain);
    url.searchParams.set("destAsset", CHAINFLIP.solanaUsdc.asset);
    url.searchParams.set("isVaultSwap", "false");
    url.searchParams.set("isOnChain", "false");
    url.searchParams.set("dcaV2Enabled", "true");
    if (params.brokerCommissionBps) {
      url.searchParams.set("brokerCommissionBps", String(params.brokerCommissionBps));
    }

    const quotes = await this.request<ChainflipQuote[]>(url);
    const quote = quotes.find((candidate) => candidate.type === "REGULAR") ?? quotes[0];
    if (!quote?.egressAmount || !quote.depositAmount || !quote.estimatedPrice) {
      throw new Error("Chainflip quote is missing output amount or price");
    }
    return quote;
  }

  async openDepositAddress(params: {
    quote: ChainflipQuote;
    destinationAddress: string;
    refundAddress: string;
    slippageBps: number;
  }): Promise<ChainflipDepositAddress> {
    const response = await this.post<ChainflipDepositAddress>(`${this.backendUrl}/openSwapDepositChannel`, {
      srcAsset: params.quote.srcAsset,
      destAsset: params.quote.destAsset,
      destAddress: params.destinationAddress,
      amount: params.quote.depositAmount,
      fillOrKillParams: {
        retryDurationBlocks: chainflipRetryDurationBlocks(params.quote),
        refundAddress: params.refundAddress,
        minPriceX128: chainflipMinPriceX128(params.quote.estimatedPrice, params.slippageBps),
        maxOraclePriceSlippage: chainflipLivePriceSlippageBps(params.quote),
        refundCcmMetadata: null,
      },
      dcaParams: params.quote.type === "DCA" ? params.quote.dcaParams : undefined,
      maxBoostFeeBps: params.quote.maxBoostFeeBps,
      quote: {
        intermediateAmount: params.quote.intermediateAmount,
        egressAmount: params.quote.egressAmount,
        estimatedPrice: params.quote.estimatedPrice,
        recommendedSlippageTolerancePercent: params.quote.recommendedSlippageTolerancePercent,
        recommendedLivePriceSlippageTolerancePercent: params.quote.recommendedLivePriceSlippageTolerancePercent,
      },
      takeCommission: false,
    });
    if (!response.id || !response.depositAddress) {
      throw new Error("Chainflip deposit channel is missing id or address");
    }
    return response;
  }

  async fetchStatus(id: string): Promise<ChainflipSwapStatus> {
    return this.request<ChainflipSwapStatus>(new URL(`${this.backendUrl}/v2/swaps/${id}`));
  }

  private async request<T>(url: URL): Promise<T> {
    const response = await this.fetchImpl(url.toString(), {
      headers: {
        accept: "application/json",
        "X-Chainflip-Sdk-Version": CHAINFLIP.sdkVersion,
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(chainflipErrorMessage(data, response.status));
    }
    return data as T;
  }

  private async post<T>(url: string, body: unknown): Promise<T> {
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "X-Chainflip-Sdk-Version": CHAINFLIP.sdkVersion,
      },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(chainflipErrorMessage(data, response.status));
    }
    return data as T;
  }
}

export function chainflipMinSolanaUsdcOut(quote: ChainflipQuote, slippageBps: number): string {
  return ((BigInt(quote.egressAmount) * BigInt(10_000 - slippageBps)) / 10_000n).toString();
}

export function chainflipDepositExpiresAt(deposit: ChainflipDepositAddress): string {
  if (!deposit.estimatedExpiryTime) {
    return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  }
  const millis = deposit.estimatedExpiryTime > 10_000_000_000
    ? deposit.estimatedExpiryTime
    : deposit.estimatedExpiryTime * 1000;
  return new Date(millis).toISOString();
}

export function chainflipSwapSucceeded(status: ChainflipSwapStatus): boolean {
  return status.state === "COMPLETED" && BigInt(status.swapEgress?.amount ?? "0") > 0n;
}

export function chainflipSwapFailed(status: ChainflipSwapStatus): boolean {
  return status.state === "FAILED" ||
    Boolean(status.deposit?.failure) ||
    Boolean(status.swapEgress?.failure) ||
    BigInt(status.refundEgress?.amount ?? "0") > 0n ||
    BigInt(status.fallbackEgress?.amount ?? "0") > 0n;
}

export function chainflipDeliveredBaseUnits(status: ChainflipSwapStatus): string {
  const amount = status.swapEgress?.amount;
  if (!amount || BigInt(amount) <= 0n) {
    throw new Error("Chainflip status has no delivered output amount");
  }
  return amount;
}

export function chainflipDestinationTx(status: ChainflipSwapStatus): string | undefined {
  return status.swapEgress?.txRef;
}

function chainflipRetryDurationBlocks(quote: ChainflipQuote): number {
  const minutes = quote.recommendedRetryDurationMinutes ?? 30;
  return Math.max(Math.ceil((minutes * 60) / CHAINFLIP.blockTimeSeconds), 1);
}

function chainflipLivePriceSlippageBps(quote: ChainflipQuote): number | null {
  const percent = quote.recommendedLivePriceSlippageTolerancePercent;
  return percent === undefined ? null : Math.round(percent * 100);
}

function chainflipMinPriceX128(estimatedPrice: string, slippageBps: number): string {
  const price = parseDecimal(estimatedPrice);
  let numerator = price.numerator * BigInt(10_000 - slippageBps) * (1n << 128n);
  let denominator = price.denominator * 10_000n;
  const decimalShift = CHAINFLIP.usdcDecimals - CHAINFLIP.btcDecimals;
  if (decimalShift >= 0) {
    numerator *= 10n ** BigInt(decimalShift);
  } else {
    denominator *= 10n ** BigInt(-decimalShift);
  }
  return (numerator / denominator).toString();
}

function parseDecimal(value: string): { numerator: bigint; denominator: bigint } {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid decimal value: ${value}`);
  }
  const [whole, fraction = ""] = trimmed.split(".");
  return {
    numerator: BigInt(`${whole}${fraction}`),
    denominator: 10n ** BigInt(fraction.length),
  };
}

function chainflipErrorMessage(data: unknown, status: number): string {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const message = record.message ?? record.error ?? record.details;
    if (typeof message === "string") return message;
    if (Array.isArray(message)) return message.join(", ");
  }
  return `Chainflip request failed: ${status}`;
}

import type { Address, Hex } from "viem";
import { CHAINS } from "./chains.js";
import { USDC_MINT_ADDRESS } from "./constants.js";
import type { MayanSwiftFunding, MayanSwiftQuote, MayanSwapDetails, MayanToken, SourceChainId } from "./orders.js";

export const MAYAN = {
  priceUrl: "https://price-api.mayan.finance/v3",
  explorerUrl: "https://explorer-api.mayan.finance/v3",
  forwarderContract: "0x337685fdaB40D39bd02028545a4FfA7D287cC3E2" as Address,
  solanaProgram: "FC4eXxkyrMPTjiYUpp4EAnkmwMbQyZ6NDCh1kfLn6vsf",
  sdkVersion: "14_3_0",
} as const;

export interface MayanClientOptions {
  fetch?: typeof fetch;
  priceUrl?: string;
  explorerUrl?: string;
  apiKey?: string;
}

export class MayanClient {
  private readonly fetchImpl: typeof fetch;
  private readonly priceUrl: string;
  private readonly explorerUrl: string;
  private readonly apiKey?: string;

  constructor(options: MayanClientOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.priceUrl = options.priceUrl ?? MAYAN.priceUrl;
    this.explorerUrl = options.explorerUrl ?? MAYAN.explorerUrl;
    this.apiKey = options.apiKey;
  }

  async fetchSwiftQuote(params: {
    sourceChain: SourceChainId;
    sourceToken: string;
    amount: bigint | string;
    destinationAddress: string;
    slippageBps: number;
    referrer?: string;
    referrerBps?: number;
  }): Promise<MayanSwiftQuote> {
    return this.fetchSwiftQuoteForRoute({
      fromChain: params.sourceChain,
      fromToken: params.sourceToken,
      toChain: "solana",
      toToken: USDC_MINT_ADDRESS,
      amount: params.amount,
      destinationAddress: params.destinationAddress,
      slippageBps: params.slippageBps,
      referrer: params.referrer,
      referrerBps: params.referrerBps,
    });
  }

  async fetchSwiftQuoteForRoute(params: {
    fromChain: SourceChainId;
    fromToken: string;
    toChain: SourceChainId;
    toToken: string;
    amount: bigint | string;
    destinationAddress: string;
    slippageBps: number;
    referrer?: string;
    referrerBps?: number;
  }): Promise<MayanSwiftQuote> {
    const fromChain = CHAINS[params.fromChain];
    const toChain = CHAINS[params.toChain];
    if (!fromChain?.mayanChain) {
      throw new Error(`Chain ${params.fromChain} is not a Mayan Swift source`);
    }
    if (!toChain?.mayanChain) {
      throw new Error(`Chain ${params.toChain} is not a Mayan Swift destination`);
    }

    const url = new URL(`${this.priceUrl.replace(/\/$/, "")}/quote`);
    if (this.apiKey) url.searchParams.set("apiKey", this.apiKey);

    const response = await this.fetchImpl(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        swift: true,
        mctp: false,
        fastMctp: false,
        wormhole: false,
        shuttle: false,
        gasless: false,
        onlyDirect: false,
        fullList: true,
        monoChain: false,
        solanaProgram: MAYAN.solanaProgram,
        forwarderAddress: MAYAN.forwarderContract,
        amountIn64: params.amount.toString(),
        fromToken: params.fromToken,
        fromChain: fromChain.mayanChain,
        toToken: params.toToken,
        toChain: toChain.mayanChain,
        slippageBps: params.slippageBps,
        referrer: params.referrer,
        referrerBps: params.referrerBps,
        gasDrop: 0,
        destinationAddress: params.destinationAddress,
        sdkVersion: MAYAN.sdkVersion,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.message || data?.msg || `Mayan quote failed: ${response.status}`);
    }

    const quotes = Array.isArray(data?.quotes) ? (data.quotes as MayanSwiftQuote[]) : [];
    const quote = quotes.find(
      (candidate) => candidate.type === "SWIFT" && candidate.swiftVersion === "V2" && candidate.gasless !== true,
    );
    if (!quote) throw new Error("Mayan returned no non-gasless Swift v2 route");
    if (!quote.expectedAmountOutBaseUnits || !quote.minReceivedBaseUnits) {
      throw new Error("Mayan Swift quote is missing output base-unit amounts");
    }
    return quote;
  }

  async fetchTokens(sourceChain: SourceChainId): Promise<MayanToken[]> {
    const chain = CHAINS[sourceChain];
    if (!chain?.mayanChain) {
      throw new Error(`Chain ${sourceChain} is not a Mayan source`);
    }
    const url = new URL(`${this.priceUrl.replace(/\/$/, "")}/tokens`);
    url.searchParams.set("chain", chain.mayanChain);
    if (this.apiKey) url.searchParams.set("apiKey", this.apiKey);

    const response = await this.fetchImpl(url.toString());
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.message || data?.msg || `Mayan token list failed: ${response.status}`);
    }
    const tokens = data?.[chain.mayanChain];
    if (!Array.isArray(tokens)) return [];
    return (tokens as MayanToken[]).filter((token) => token.contract && token.decimals !== undefined);
  }

  async fetchSwapByTx(txHash: string): Promise<MayanSwapDetails> {
    const response = await this.fetchImpl(`${this.explorerUrl.replace(/\/$/, "")}/swap/trx/${txHash}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error("Mayan swap pending: not indexed yet");
      }
      throw new Error(data?.message || data?.msg || `Mayan swap lookup failed: ${response.status}`);
    }
    return data as MayanSwapDetails;
  }
}

const CROSS_CHAIN_STABLE_SYMBOLS = new Set(["USDC", "USDC.E", "USDCE", "USDT", "USDT0"]);

export function filterMayanTokensForChain(tokens: MayanToken[], sourceChain: SourceChainId): MayanToken[] {
  return tokens.filter((token) => !isCrossChainStablecoinVariant(token, sourceChain));
}

export function isCrossChainStablecoinVariant(token: MayanToken, sourceChain: SourceChainId): boolean {
  if (!isFilteredStableSymbol(token.symbol)) return false;

  const configuredUsdc = CHAINS[sourceChain]?.usdc;
  const contract = token.contract?.toLowerCase();
  if (configuredUsdc && contract === String(configuredUsdc).toLowerCase()) {
    return false;
  }

  const hasOriginMismatch =
    token.realOriginChainId !== undefined &&
    token.wChainId !== undefined &&
    token.realOriginChainId !== token.wChainId;
  const hasPortalName = /\bportal from\b/i.test(token.name ?? "");

  return hasOriginMismatch || hasPortalName;
}

function isFilteredStableSymbol(symbol?: string): boolean {
  return CROSS_CHAIN_STABLE_SYMBOLS.has((symbol ?? "").trim().toUpperCase());
}

export function buildMayanSwiftFunding(params: {
  orderId: string;
  sourceChain: SourceChainId;
  amount: bigint | string;
  destinationAddress: string;
  quote: MayanSwiftQuote;
}): MayanSwiftFunding {
  const chain = CHAINS[params.sourceChain];
  if (!chain || chain.kind !== "evm" || !chain.chainId || !chain.usdc) {
    throw new Error(`Chain ${params.sourceChain} is not a Mayan Swift source`);
  }

  return {
    type: "mayan-swift",
    orderId: params.orderId,
    chainId: params.sourceChain,
    chainNumericId: chain.chainId,
    token: params.quote.fromToken.contract as Address,
    tokenSymbol: params.quote.fromToken.symbol,
    tokenDecimals: params.quote.fromToken.decimals,
    tokenStandard: params.quote.fromToken.standard,
    amount: params.amount.toString(),
    forwarder: MAYAN.forwarderContract,
    destinationAddress: params.destinationAddress,
    mayanQuote: params.quote,
    approve: {
      spender: MAYAN.forwarderContract,
      amount: params.quote.effectiveAmountIn64 ?? params.amount.toString(),
    },
  };
}

export function mayanSwapSucceeded(details: MayanSwapDetails): boolean {
  const status = mayanStatus(details);
  return ["COMPLETED", "SETTLED_ON_SOLANA", "FULFILLED", "REDEEMED", "DESTINATION_TX_CONFIRMED"].includes(status);
}

export function mayanSwapFailed(details: MayanSwapDetails): boolean {
  const status = mayanStatus(details);
  return ["REFUNDED", "CANCELED", "CANCELLED", "FAILED"].includes(status);
}

export function mayanDestinationTx(details: MayanSwapDetails): string | undefined {
  return (
    details.destinationTxHash ??
    details.destTxHash ??
    details.redeemTxHash ??
    details.fulfillTxHash ??
    details.settleTxHash ??
    details.swapTxHash
  );
}

export function mayanDeliveredBaseUnits(details: MayanSwapDetails, fallbackDecimals = 6): string {
  if (details.toAmount64) return details.toAmount64;
  if (details.toAmountBaseUnits) return details.toAmountBaseUnits;
  if (!details.toAmount) throw new Error("Mayan swap completed without a destination amount");
  return decimalToBaseUnits(details.toAmount, fallbackDecimals);
}

export function decimalToBaseUnits(value: string | number, decimals: number): string {
  let raw = String(value).trim();
  if (!raw) throw new Error("empty decimal amount");
  if (raw.includes("e") || raw.includes("E")) raw = Number(raw).toFixed(decimals);
  const negative = raw.startsWith("-");
  if (negative) raw = raw.slice(1);
  const [whole, fraction = ""] = raw.split(".");
  const padded = (fraction + "0".repeat(decimals)).slice(0, decimals);
  const units = `${whole || "0"}${padded}`.replace(/^0+(?=\d)/, "") || "0";
  return negative ? `-${units}` : units;
}

export interface MayanEvmTxPayload {
  to: Address;
  data: Hex;
  value: Hex | "0x0";
  chainId: number;
}

function mayanStatus(details: MayanSwapDetails): string {
  return String(details.clientStatus ?? details.status ?? "").toUpperCase();
}

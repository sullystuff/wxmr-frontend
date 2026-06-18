import type { Address } from "viem";

export type SourceChainId =
  | "monero"
  | "ethereum"
  | "bsc"
  | "base"
  | "arbitrum"
  | "optimism"
  | "polygon"
  | "avalanche"
  | "linea"
  | "hyperevm"
  | "monad"
  | "sui"
  | "hyperliquid"
  | "solana"
  | "bitcoin";

export type SwapDirection = "mayan-to-xmr" | "xmr-to-mayan";
export type ExecutionPolicy = "refund-on-slippage" | "execute-anyway";

export type OrderStatus =
  | "created"
  | "awaiting_deposit"
  | "bridging"
  | "minted"
  | "swapping"
  | "withdrawing"
  | "completed"
  | "expired"
  | "failed"
  | "refunding"
  | "refunded";

export interface QuoteRequest {
  direction?: SwapDirection;
  sourceChain: SourceChainId;
  sourceToken: string;
  amount: string;
  sourceAddress?: string;
  xmrAddress?: string;
  destinationAddress?: string;
  refundAddress?: string;
  slippageBps?: number;
  executionPolicy?: ExecutionPolicy;
}

export interface Quote {
  id: string;
  direction: SwapDirection;
  sourceChain: SourceChainId;
  sourceToken: string;
  sourceTokenSymbol?: string;
  sourceTokenDecimals?: number;
  inputAmount: string;
  sourceAddress?: string;
  xmrAddress: string;
  destinationAddress?: string;
  destinationTokenSymbol?: string;
  destinationTokenDecimals?: number;
  estimatedDestinationOut?: string;
  minDestinationOut?: string;
  refundAddress?: string;
  estimatedWxmrOut: string;
  estimatedXmrOut: string;
  minWxmrOut: string;
  minXmrOut: string;
  bridgeFeeBps: number;
  serviceFeeBps: number;
  executionPolicy: ExecutionPolicy;
  jupiterPriceImpactPct: string;
  expiresAt: string;
  route: "mayan" | "solana" | "thorchain";
  routeSummary?: string;
  mayan?: MayanQuoteMetadata;
  thorchain?: ThorchainQuoteMetadata;
}

export type FundingInstructions =
  | MayanSwiftFunding
  | SolanaTransferFunding
  | DepositAddressFunding;

export interface MayanQuoteMetadata {
  quote: MayanSwiftQuote;
  expectedSolanaUsdcOut: string;
  minSolanaUsdcOut: string;
  etaSeconds?: number;
  clientEta?: string;
  protocolBps?: number;
  quoteId?: string;
}

export interface ThorchainQuoteMetadata {
  mode: "direct-solana" | "eth-usdc-fallback";
  fromAsset: string;
  toAsset: string;
  expectedOut: string;
  expectedSolanaUsdcOut: string;
  minSolanaUsdcOut: string;
  inboundAddress: string;
  memo: string;
  expiry: number;
  estimatedTimeSeconds?: number;
  fees?: unknown;
  mayan?: MayanQuoteMetadata;
}

export interface MayanSwiftFunding {
  type: "mayan-swift";
  orderId: string;
  chainId: SourceChainId;
  chainNumericId: number;
  token: Address;
  tokenSymbol?: string;
  tokenDecimals?: number;
  tokenStandard?: string;
  amount: string;
  forwarder: Address;
  destinationAddress: string;
  mayanQuote: MayanSwiftQuote;
  approve: {
    spender: Address;
    amount: string;
  };
}

export interface MayanToken {
  name?: string;
  symbol?: string;
  contract?: string;
  mint?: string;
  standard?: string;
  verified?: boolean;
  decimals?: number;
  logoURI?: string;
  chainId?: number;
  wChainId?: number;
  realOriginContractAddress?: string;
  realOriginChainId?: number;
}

export interface MayanSwiftQuote {
  type: "SWIFT";
  swiftVersion: "V1" | "V2";
  gasless: boolean;
  quoteId?: string;
  fromChain: string;
  toChain: string;
  fromToken: MayanToken;
  toToken: MayanToken;
  effectiveAmountIn64: string;
  expectedAmountOutBaseUnits: string;
  minAmountOutBaseUnits?: string;
  minReceivedBaseUnits: string;
  expectedAmountOut: number;
  minAmountOut: number;
  minReceived: number;
  slippageBps: number;
  etaSeconds?: number;
  clientEta?: string;
  protocolBps?: number;
  bridgeFee?: number;
  priceImpact?: number | null;
  priceStat?: { status?: string; ratio?: number };
  deadline64: string;
  refundRelayerFee64?: string | null;
  cancelRelayerFee64?: string | null;
  submitRelayerFee64?: string | null;
  swiftMayanContract?: string;
  swiftAuctionMode?: number;
  swiftInputContract: string;
  swiftInputDecimals: number;
  swiftWrapAndLock: boolean;
  swiftInputContractStandard?: string;
  minMiddleAmount?: number;
  gasDrop?: number;
  signature?: string;
  [key: string]: unknown;
}

export interface MayanSwapDetails {
  id?: string;
  clientStatus?: string;
  status?: string;
  sourceTxHash?: string;
  destinationTxHash?: string;
  destTxHash?: string;
  redeemTxHash?: string;
  fulfillTxHash?: string;
  settleTxHash?: string;
  swapTxHash?: string;
  destAddress?: string;
  toTokenAddress?: string;
  toTokenSymbol?: string;
  toAmount?: string;
  toAmount64?: string;
  toAmountBaseUnits?: string;
  error?: string;
  [key: string]: unknown;
}

export interface SolanaTransferFunding {
  type: "solana-transfer";
  orderId: string;
  chainId: "solana";
  mint: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  amount: string;
  destinationTokenAccount: string;
  destinationOwner: string;
  memo: string;
}

export interface DepositAddressFunding {
  type: "deposit-address";
  orderId: string;
  chainId: SourceChainId;
  asset: string;
  address: string;
  memo?: string;
  expiresAt: string;
  expectedAmount?: string;
  sourceAddress?: string;
  provider?: string;
  targetAsset?: string;
  depositOwner?: string;
  depositPda?: string;
  createSignature?: string;
}

export interface Order {
  id: string;
  quoteId: string;
  direction: SwapDirection;
  status: OrderStatus;
  sourceChain: SourceChainId;
  sourceToken: string;
  amount: string;
  xmrAddress: string;
  destinationAddress?: string;
  destinationTokenSymbol?: string;
  destinationTokenDecimals?: number;
  refundAddress?: string;
  executionPolicy: ExecutionPolicy;
  funding: FundingInstructions;
  sourceTxHash?: string;
  destinationAmount?: string;
  solanaMintSignature?: string;
  swapSignature?: string;
  withdrawalSignature?: string;
  withdrawalPda?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface DepositReference {
  txHash: string;
}

import type { Address } from "viem";

export type SourceChainId =
  | "ethereum"
  | "base"
  | "arbitrum"
  | "optimism"
  | "polygon"
  | "avalanche"
  | "solana"
  | "bitcoin";

export type OrderStatus =
  | "created"
  | "awaiting_deposit"
  | "attesting"
  | "minted"
  | "swapping"
  | "withdrawing"
  | "completed"
  | "expired"
  | "failed"
  | "refunding"
  | "refunded";

export interface QuoteRequest {
  sourceChain: SourceChainId;
  sourceToken: "USDC" | string;
  amount: string;
  xmrAddress: string;
  refundAddress?: string;
  slippageBps?: number;
}

export interface Quote {
  id: string;
  sourceChain: SourceChainId;
  sourceToken: string;
  inputAmount: string;
  xmrAddress: string;
  refundAddress?: string;
  estimatedWxmrOut: string;
  estimatedXmrOut: string;
  minWxmrOut: string;
  minXmrOut: string;
  bridgeFeeBps: number;
  serviceFeeBps: number;
  jupiterPriceImpactPct: string;
  expiresAt: string;
  route: "cctp" | "mayan" | "thorchain";
}

export type FundingInstructions =
  | EvmCctpBurnFunding
  | SolanaTransferFunding
  | DepositAddressFunding;

export interface EvmCctpBurnFunding {
  type: "evm-cctp-burn";
  orderId: string;
  chainId: SourceChainId;
  chainNumericId: number;
  tokenMessenger: Address;
  usdc: Address;
  amount: string;
  destinationDomain: number;
  mintRecipient: `0x${string}`;
  destinationCaller: `0x${string}`;
  maxFee: string;
  minFinalityThreshold: number;
  approve: {
    spender: Address;
    amount: string;
  };
  depositForBurn: {
    abi: readonly unknown[];
    functionName: "depositForBurn";
    args: readonly [
      string,
      number,
      `0x${string}`,
      Address,
      `0x${string}`,
      string,
      number,
    ];
  };
}

export interface SolanaTransferFunding {
  type: "solana-transfer";
  orderId: string;
  chainId: "solana";
  mint: string;
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
}

export interface Order {
  id: string;
  quoteId: string;
  status: OrderStatus;
  sourceChain: SourceChainId;
  sourceToken: string;
  amount: string;
  xmrAddress: string;
  refundAddress?: string;
  funding: FundingInstructions;
  sourceTxHash?: string;
  cctpMessage?: string;
  cctpAttestation?: string;
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

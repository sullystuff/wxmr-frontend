import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import type { Address } from "viem";
import { CCTP_DOMAIN, CHAINS } from "./chains.js";
import type { EvmCctpBurnFunding, SourceChainId } from "./orders.js";

export const CCTP_V2 = {
  standardMinFinalityThreshold: 2000,
  maxFee: 0n,
  solanaDestinationDomain: CCTP_DOMAIN.solana,
  attestationUrl: "https://iris-api.circle.com/v2/messages",
  solana: {
    messageTransmitter: "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC",
    tokenMessengerMinter: "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe",
  },
  evm: {
    tokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d" as Address,
    messageTransmitter: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64" as Address,
  },
} as const;

export const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const TOKEN_MESSENGER_V2_ABI = [
  {
    type: "function",
    name: "depositForBurn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
    ],
    outputs: [],
  },
] as const;

export interface CctpAttestationResponse {
  messages?: Array<{
    message: `0x${string}`;
    attestation: `0x${string}` | "PENDING";
    eventNonce?: string;
    status?: string;
  }>;
  error?: string;
}

export function solanaPublicKeyToBytes32(publicKey: string | PublicKey): `0x${string}` {
  const key = typeof publicKey === "string" ? new PublicKey(publicKey) : publicKey;
  return `0x${Buffer.from(key.toBytes()).toString("hex")}`;
}

export function bytes32ToSolanaPublicKey(bytes32: string): PublicKey {
  const hex = bytes32.startsWith("0x") ? bytes32.slice(2) : bytes32;
  return new PublicKey(Buffer.from(hex, "hex"));
}

export function solanaPublicKeyToBase58Bytes32(publicKey: string | PublicKey): string {
  const key = typeof publicKey === "string" ? new PublicKey(publicKey) : publicKey;
  return bs58.encode(Buffer.from(key.toBytes()));
}

export function getCctpAttestationUrl(
  sourceDomain: number,
  transactionHash: string,
  baseUrl: string = CCTP_V2.attestationUrl,
): string {
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/${sourceDomain}`);
  url.searchParams.set("transactionHash", transactionHash);
  return url.toString();
}

export function getEvmCctpConfig(sourceChain: SourceChainId): {
  sourceChain: SourceChainId;
  sourceDomain: number;
  chainNumericId: number;
  tokenMessenger: Address;
  messageTransmitter: Address;
  usdc: Address;
} {
  const chain = CHAINS[sourceChain];
  if (!chain || chain.kind !== "evm" || !chain.chainId || chain.cctpDomain === undefined || !chain.usdc) {
    throw new Error(`Chain ${sourceChain} is not an EVM CCTP source`);
  }

  return {
    sourceChain,
    sourceDomain: chain.cctpDomain,
    chainNumericId: chain.chainId,
    tokenMessenger: CCTP_V2.evm.tokenMessenger,
    messageTransmitter: CCTP_V2.evm.messageTransmitter,
    usdc: chain.usdc as Address,
  };
}

export function buildEvmCctpBurnFunding(params: {
  orderId: string;
  sourceChain: SourceChainId;
  amount: bigint | string;
  mintRecipient: string | PublicKey;
  destinationCaller: string | PublicKey;
}): EvmCctpBurnFunding {
  const config = getEvmCctpConfig(params.sourceChain);
  const amount = BigInt(params.amount);
  const mintRecipient = solanaPublicKeyToBytes32(params.mintRecipient);
  const destinationCaller = solanaPublicKeyToBytes32(params.destinationCaller);

  return {
    type: "evm-cctp-burn",
    orderId: params.orderId,
    chainId: params.sourceChain,
    chainNumericId: config.chainNumericId,
    tokenMessenger: config.tokenMessenger,
    usdc: config.usdc,
    amount: amount.toString(),
    destinationDomain: CCTP_V2.solanaDestinationDomain,
    mintRecipient,
    destinationCaller,
    maxFee: CCTP_V2.maxFee.toString(),
    minFinalityThreshold: CCTP_V2.standardMinFinalityThreshold,
    approve: {
      spender: config.tokenMessenger,
      amount: amount.toString(),
    },
    depositForBurn: {
      abi: TOKEN_MESSENGER_V2_ABI,
      functionName: "depositForBurn",
      args: [
        amount.toString(),
        CCTP_V2.solanaDestinationDomain,
        mintRecipient,
        config.usdc,
        destinationCaller,
        CCTP_V2.maxFee.toString(),
        CCTP_V2.standardMinFinalityThreshold,
      ],
    },
  };
}

export function decodeCctpV2Nonce(messageHex: string): Buffer {
  const hex = messageHex.startsWith("0x") ? messageHex.slice(2) : messageHex;
  const message = Buffer.from(hex, "hex");
  return message.subarray(12, 44);
}

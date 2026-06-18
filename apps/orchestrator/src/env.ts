import { createRequire } from "module";
import bs58 from "bs58";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { BRIDGE_PROGRAM_ID, USDC_MINT } from "@wxmr/core";

const require = createRequire(import.meta.url);
const envLoader = require("../../../scripts/load-wxmr-env.cjs") as {
  loadWxmrEnv(): void;
};

envLoader.loadWxmrEnv();

export interface Env {
  host: string;
  port: number;
  dbPath: string;
  solanaRpcUrl: string;
  solanaHotWallet: Keypair;
  hotWalletUsdcAta: PublicKey;
  bridgeProgramId: string;
  serviceFeeBps: number;
  jupiterApiKey?: string;
  mayanApiKey?: string;
  thornodeUrl?: string;
  thornodeClientId?: string;
  evmHotWalletPrivateKey?: Hex;
  evmHotWalletAddress?: Address;
  ethereumRpcUrl?: string;
}

export function loadEnv(): Env {
  const solanaHotWallet = parseKeypair(mustGet("SOLANA_HOTWALLET_SECRET"));
  const evmHotWalletPrivateKey = parseEvmPrivateKey(process.env.EVM_HOTWALLET_PRIVATE_KEY);
  const evmHotWalletAddress = evmHotWalletPrivateKey ? privateKeyToAccount(evmHotWalletPrivateKey).address : undefined;
  return {
    host: process.env.ORCH_HOST ?? "127.0.0.1",
    port: Number(process.env.ORCH_PORT ?? 3002),
    dbPath: process.env.ORCH_DB_PATH ?? "./orchestrator.sqlite",
    solanaRpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
    solanaHotWallet,
    hotWalletUsdcAta: getAssociatedTokenAddressSync(USDC_MINT, solanaHotWallet.publicKey),
    bridgeProgramId: process.env.BRIDGE_PROGRAM_ID ?? BRIDGE_PROGRAM_ID,
    serviceFeeBps: Number(process.env.SERVICE_FEE_BPS ?? 0),
    jupiterApiKey: process.env.JUPITER_API_KEY,
    mayanApiKey: process.env.MAYAN_API_KEY,
    thornodeUrl: process.env.THORNODE_URL,
    thornodeClientId: process.env.THORNODE_CLIENT_ID,
    evmHotWalletPrivateKey,
    evmHotWalletAddress,
    ethereumRpcUrl: process.env.ETHEREUM_RPC_URL,
  };
}

function mustGet(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseKeypair(secret: string): Keypair {
  const trimmed = secret.trim();
  if (trimmed.startsWith("[")) {
    const bytes = Uint8Array.from(JSON.parse(trimmed) as number[]);
    return Keypair.fromSecretKey(bytes);
  }
  return Keypair.fromSecretKey(bs58.decode(trimmed));
}

function parseEvmPrivateKey(secret: string | undefined): Hex | undefined {
  const trimmed = secret?.trim();
  if (!trimmed) return undefined;
  return (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as Hex;
}

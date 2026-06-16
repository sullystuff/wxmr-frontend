import "dotenv/config";
import bs58 from "bs58";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BRIDGE_PROGRAM_ID, USDC_MINT } from "@wxmr/core";

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
}

export function loadEnv(): Env {
  const solanaHotWallet = parseKeypair(mustGet("SOLANA_HOTWALLET_SECRET"));
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

import { createHash } from "node:crypto";
import { Keypair } from "@solana/web3.js";

export function deriveReverseDepositOwner(hotWallet: Keypair, orderId: string): Keypair {
  const seed = createHash("sha256")
    .update(Buffer.from(hotWallet.secretKey))
    .update(orderId)
    .digest()
    .subarray(0, 32);
  return Keypair.fromSeed(seed);
}

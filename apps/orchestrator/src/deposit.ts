import { createHash } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import type { Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

// Per-order deposit keys are derived from the hot-wallet secrets so that no
// extra key material has to be provisioned or backed up: as long as the hot
// wallet secret survives, every order's deposit address can be re-derived and
// swept. Domain tags keep these derivations disjoint from
// deriveReverseDepositOwner (which hashes secretKey || orderId with no tag).

export function deriveSolanaDepositOwner(hotWallet: Keypair, orderId: string): Keypair {
  const seed = createHash("sha256")
    .update(Buffer.from(hotWallet.secretKey))
    .update("wxmr-svm-deposit:")
    .update(orderId)
    .digest()
    .subarray(0, 32);
  return Keypair.fromSeed(seed);
}

export function deriveEvmDepositAccount(hotWalletPrivateKey: Hex, orderId: string): PrivateKeyAccount {
  const keyBytes = Buffer.from(hotWalletPrivateKey.slice(2), "hex");
  // A SHA-256 digest is invalid as a secp256k1 key with probability ~2^-128;
  // the counter loop exists for correctness, not because it is expected to run.
  for (let counter = 0; ; counter++) {
    const digest = createHash("sha256")
      .update(keyBytes)
      .update("wxmr-evm-deposit:")
      .update(orderId)
      .update(counter === 0 ? "" : `:${counter}`)
      .digest();
    try {
      return privateKeyToAccount(`0x${digest.toString("hex")}` as Hex);
    } catch {
      continue;
    }
  }
}

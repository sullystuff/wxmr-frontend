import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { SWAP_FEE_ACCOUNT } from "../src/lib/jupiter-swap";
import { validateWalletSignedSwap } from "../src/lib/swap-wallet-validation";

const wallet = Keypair.generate();
const guard = () => new TransactionInstruction({ programId: Keypair.generate().publicKey,
  keys: [{ pubkey: wallet.publicKey, isSigner: true, isWritable: true }, { pubkey: new PublicKey(SWAP_FEE_ACCOUNT), isSigner: false, isWritable: true }], data: Buffer.from([1, 2, 3]) });
const transaction = (instructions: TransactionInstruction[], payer = wallet.publicKey) => new VersionedTransaction(new TransactionMessage({ payerKey: payer,
  recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions }).compileToV0Message());

test("wallet safety instructions wrapping a swap are accepted without comparing instruction lists", () => {
  const swap = new TransactionInstruction({ programId: new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"), keys: guard().keys, data: Buffer.from([50]) });
  const signed = transaction([guard(), swap, guard()]); signed.sign([wallet]);
  const bytes = signed.serialize();
  assert.doesNotThrow(() => validateWalletSignedSwap(signed, wallet.publicKey));
  assert.deepEqual(signed.serialize(), bytes);
});

test("wallet CPI wrappers and sponsors can rebuild the transaction while preserving the user's signature", () => {
  const sponsor = Keypair.generate();
  const signed = transaction([guard()], sponsor.publicKey); signed.sign([sponsor, wallet]);
  assert.doesNotThrow(() => validateWalletSignedSwap(signed, wallet.publicKey));
});

test("an unsigned wallet result is rejected", () => {
  assert.throws(() => validateWalletSignedSwap(transaction([guard()]), wallet.publicKey), /did not sign/);
});

test("a different signer cannot stand in for the connected wallet", () => {
  const other = Keypair.generate();
  const instruction = new TransactionInstruction({ programId: Keypair.generate().publicKey,
    keys: [{ pubkey: wallet.publicKey, isSigner: false, isWritable: false }], data: Buffer.alloc(0) });
  const signed = transaction([instruction], other.publicKey); signed.sign([other]);
  assert.throws(() => validateWalletSignedSwap(signed, wallet.publicKey), /did not sign/);
});

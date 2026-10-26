import assert from "node:assert/strict";
import { test } from "node:test";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { SWAP_FEE_ACCOUNT } from "../src/lib/jupiter-swap";
import { validateWalletSignedSwap } from "../src/lib/swap-wallet-validation";

const wallet = Keypair.generate();
const swapInstruction = () => new TransactionInstruction({ programId: new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"),
  keys: [{ pubkey: new PublicKey(SWAP_FEE_ACCOUNT), isSigner: false, isWritable: true }, { pubkey: wallet.publicKey, isSigner: true, isWritable: true }], data: Buffer.from([1, 2, 3, 50]) });
const transaction = (instructions: TransactionInstruction[], blockhash = PublicKey.default.toBase58()) => new VersionedTransaction(new TransactionMessage({ payerKey: wallet.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message());
const original = () => transaction([ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }), swapInstruction()]);

test("wallet compute changes and blockhash refreshes preserve the authorized swap", () => {
  const signed = transaction([ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 2000 }), ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }), swapInstruction()], Keypair.generate().publicKey.toBase58());
  signed.sign([wallet]);
  assert.doesNotThrow(() => validateWalletSignedSwap(original(), signed, wallet.publicKey));
  assert.notDeepEqual(original().message.serialize(), signed.message.serialize());
});

test("wallet memos may recompile static account indexes without changing swap semantics", () => {
  const memo = new TransactionInstruction({ programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"), keys: [], data: Buffer.from("Wallet note") });
  const signed = transaction([ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }), swapInstruction(), memo]); signed.sign([wallet]);
  assert.doesNotThrow(() => validateWalletSignedSwap(original(), signed, wallet.publicKey));
});

test("changed swap amounts, added transfers, and changed referral destinations are rejected", () => {
  const changed = swapInstruction(); changed.data = Buffer.from([1, 2, 3, 0]);
  const redirected = swapInstruction(); redirected.keys[0].pubkey = Keypair.generate().publicKey;
  const transfer = SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 });
  for (const instructions of [[changed], [swapInstruction(), transfer], [redirected]]) {
    const signed = transaction(instructions); signed.sign([wallet]);
    assert.throws(() => validateWalletSignedSwap(original(), signed, wallet.publicKey), /changed|invalid/);
  }
});

test("unsigned results and excessive wallet priority charges are rejected", () => {
  assert.throws(() => validateWalletSignedSwap(original(), original(), wallet.publicKey), /invalid/);
  const signed = transaction([ComputeBudgetProgram.setComputeUnitLimit({ units: 1000000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100001 }), swapInstruction()]); signed.sign([wallet]);
  assert.throws(() => validateWalletSignedSwap(original(), signed, wallet.publicKey), /exceeds/);
});

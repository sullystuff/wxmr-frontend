import { ComputeBudgetProgram, PublicKey, VersionedTransaction, type VersionedMessage } from "@solana/web3.js";
import { SWAP_FEE_ACCOUNT } from "./jupiter-swap";

const MEMO_PROGRAMS = new Set(["MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo"]);
const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((value, index) => value === b[index]);

function accountNames(message: VersionedMessage): string[] {
  const lookups = message.addressTableLookups;
  return [...message.staticAccountKeys.map(key => key.toBase58()),
    ...lookups.flatMap(lookup => Array.from(lookup.writableIndexes, index => `${lookup.accountKey}:${index}`)),
    ...lookups.flatMap(lookup => Array.from(lookup.readonlyIndexes, index => `${lookup.accountKey}:${index}`))];
}

function instructions(message: VersionedMessage, wallet: string, allowWalletMemos: boolean) {
  const names = accountNames(message);
  let limit = 1_400_000;
  let price = BigInt(0);
  let limitCount = 0;
  let priceCount = 0;
  const economic = [];
  for (const instruction of message.compiledInstructions) {
    const program = names[instruction.programIdIndex];
    const data = instruction.data;
    if (program === ComputeBudgetProgram.programId.toBase58() && data[0] === 2 && data.length === 5) {
      limit = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(1, true);
      limitCount++;
      continue;
    }
    if (program === ComputeBudgetProgram.programId.toBase58() && data[0] === 3 && data.length === 9) {
      price = new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(1, true);
      priceCount++;
      continue;
    }
    if (allowWalletMemos && MEMO_PROGRAMS.has(program)
      && Array.from(instruction.accountKeyIndexes).every(index => names[index] === wallet)) continue;
    economic.push({ program, data, accounts: Array.from(instruction.accountKeyIndexes, index => ({
      address: names[index], signer: message.isAccountSigner(index), writable: message.isAccountWritable(index),
    })) });
  }
  if (limitCount > 1 || priceCount > 1 || limit < 1 || limit > 1_400_000
    || (BigInt(limit) * price + BigInt(999_999)) / BigInt(1_000_000) > BigInt(100_000)) {
    throw new Error("Your wallet's priority setting exceeds this swap's limit. Lower it in your wallet and try again.");
  }
  return economic;
}

// Compare swap semantics, allowing wallet blockhash refreshes, bounded compute
// adjustments, and harmless wallet memos. Account order alone has no meaning.
export function validateWalletSignedSwap(original: VersionedTransaction, signed: VersionedTransaction, wallet: PublicKey) {
  const message = signed.message;
  const feeIndex = message.staticAccountKeys.findIndex(key => key.toBase58() === SWAP_FEE_ACCOUNT);
  if (!message.staticAccountKeys[0].equals(wallet) || message.header.numRequiredSignatures !== 1
    || feeIndex < 0 || !message.isAccountWritable(feeIndex) || signed.signatures[0].every(byte => byte === 0)) {
    throw new Error("Your wallet returned an invalid swap. Nothing was submitted.");
  }
  const expected = instructions(original.message, wallet.toBase58(), true);
  const actual = instructions(signed.message, wallet.toBase58(), true);
  if (expected.length !== actual.length || expected.some((instruction, index) => {
    const candidate = actual[index];
    return instruction.program !== candidate.program || !equalBytes(instruction.data, candidate.data)
      || JSON.stringify(instruction.accounts) !== JSON.stringify(candidate.accounts);
  })) throw new Error("Your wallet changed the swap instructions. Nothing was submitted.");
}

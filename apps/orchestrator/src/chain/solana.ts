import bs58 from "bs58";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { swapFromSolana, type Quote as MayanSdkQuote } from "@mayanfinance/swap-sdk";
import {
  JupiterClient,
  USDC_MINT,
  WSOL_MINT_ADDRESS,
  WXMR_MINT,
  WXMR_MINT_ADDRESS,
  type MayanSwiftQuote,
  type JupiterQuote,
  type SolanaTransferFunding,
} from "@wxmr/core";
import {
  claimPendingMintWithKeypair,
  buildRequestWithdrawalTransaction,
  createDepositAccountWithKeypair,
  fetchDepositAccount,
  findDepositAccountByXmrAddress,
  requestWithdrawalWithKeypair,
  type DepositAccountInfo,
} from "@wxmr/core/bridge";

const REVERSE_ORDER_INITIAL_SOL_LAMPORTS = Math.floor(0.01 * LAMPORTS_PER_SOL);
const REVERSE_ORDER_EXECUTION_SOL_LAMPORTS = Math.floor(0.03 * LAMPORTS_PER_SOL);
const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

export class SolanaExecutor {
  private readonly jupiter: JupiterClient;

  constructor(
    private readonly connection: Connection,
    private readonly hotWallet: Keypair,
    private readonly bridgeProgramId: string,
    jupiterApiKey?: string,
    private readonly mayanApiKey?: string,
  ) {
    this.jupiter = new JupiterClient({ apiKey: jupiterApiKey });
  }

  async swapUsdcToWxmr(amount: bigint, minWxmrOut: bigint): Promise<{
    signature: string;
    outAmount: bigint;
    quote: JupiterQuote;
  }> {
    return this.swapTokenToWxmr(USDC_MINT.toBase58(), amount, minWxmrOut);
  }

  async swapTokenToWxmr(inputMint: string, amount: bigint, minWxmrOut: bigint): Promise<{
    signature: string;
    outAmount: bigint;
    quote: JupiterQuote;
  }> {
    return this.swapTokenToToken(inputMint, WXMR_MINT_ADDRESS, amount, minWxmrOut);
  }

  async swapTokenToToken(inputMint: string, outputMint: string, amount: bigint, minOutAmount: bigint): Promise<{
    signature: string;
    outAmount: bigint;
    quote: JupiterQuote;
  }> {
    const quote = await this.jupiter.quote({
      inputMint,
      outputMint,
      amount,
      taker: this.hotWallet.publicKey.toBase58(),
    });
    return this.executeJupiterQuote(quote, minOutAmount, this.hotWallet);
  }

  async swapWxmrToUsdc(amount: bigint, minUsdcOut: bigint, signer: Keypair): Promise<{
    signature: string;
    outAmount: bigint;
    quote: JupiterQuote;
  }> {
    return this.swapWxmrToToken(USDC_MINT.toBase58(), amount, minUsdcOut, signer);
  }

  async swapWxmrToToken(outputMint: string, amount: bigint, minOutAmount: bigint, signer: Keypair): Promise<{
    signature: string;
    outAmount: bigint;
    quote: JupiterQuote;
  }> {
    await this.ensureSolBalance(signer.publicKey, REVERSE_ORDER_EXECUTION_SOL_LAMPORTS);
    const quote = await this.jupiter.quote({
      inputMint: WXMR_MINT_ADDRESS,
      outputMint,
      amount,
      taker: signer.publicKey.toBase58(),
    });
    return this.executeJupiterQuote(quote, minOutAmount, signer);
  }

  async createMoneroDepositAccount(owner: Keypair): Promise<{
    signature: string;
    depositPda: string;
    deposit: DepositAccountInfo | null;
  }> {
    await this.ensureSolBalance(owner.publicKey, REVERSE_ORDER_INITIAL_SOL_LAMPORTS);
    const existing = await fetchDepositAccount(this.connection, owner.publicKey, this.bridgeProgramId);
    if (existing) {
      return {
        signature: "",
        depositPda: existing.depositPda,
        deposit: existing,
      };
    }
    const created = await createDepositAccountWithKeypair({
      connection: this.connection,
      signer: owner,
      programId: this.bridgeProgramId,
    });
    const deposit = await fetchDepositAccount(this.connection, owner.publicKey, this.bridgeProgramId);
    return {
      ...created,
      deposit,
    };
  }

  fetchMoneroDeposit(owner: PublicKey): Promise<DepositAccountInfo | null> {
    return fetchDepositAccount(this.connection, owner, this.bridgeProgramId);
  }

  findMoneroDepositByAddress(xmrAddress: string): Promise<DepositAccountInfo | null> {
    return findDepositAccountByXmrAddress(this.connection, xmrAddress, this.bridgeProgramId);
  }

  async claimMoneroDeposit(owner: Keypair): Promise<string> {
    await this.ensureSolBalance(owner.publicKey, REVERSE_ORDER_EXECUTION_SOL_LAMPORTS);
    return claimPendingMintWithKeypair({
      connection: this.connection,
      signer: owner,
      programId: this.bridgeProgramId,
    });
  }

  async transferWxmr(from: Keypair, toOwner: PublicKey, amount: bigint): Promise<string> {
    return this.transferToken(WXMR_MINT.toBase58(), from, toOwner, amount);
  }

  async transferToken(mintAddress: string, from: Keypair, toOwner: PublicKey, amount: bigint): Promise<string> {
    if (amount <= 0n) return "";
    const mint = new PublicKey(mintAddress);
    const fromAta = getAssociatedTokenAddressSync(mint, from.publicKey);
    const toAta = getAssociatedTokenAddressSync(mint, toOwner);
    const transaction = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        from.publicKey,
        toAta,
        toOwner,
        mint,
      ),
      createTransferInstruction(
        fromAta,
        toAta,
        from.publicKey,
        amount,
        [],
        TOKEN_PROGRAM_ID,
      ),
    );
    return sendAndConfirmTransaction(this.connection, transaction, [from], {
      commitment: "confirmed",
    });
  }

  async executeMayanSwiftFromSolana(
    quote: MayanSwiftQuote,
    signer: Keypair,
    destinationAddress: string,
  ): Promise<{ signature: string }> {
    await this.ensureSolBalance(signer.publicKey, REVERSE_ORDER_EXECUTION_SOL_LAMPORTS);
    const signTransaction = async <T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> => {
      if (transaction instanceof VersionedTransaction) {
        transaction.sign([signer]);
      } else {
        transaction.partialSign(signer);
      }
      return transaction;
    };
    const result = await swapFromSolana(
      quote as unknown as MayanSdkQuote,
      signer.publicKey.toBase58(),
      destinationAddress,
      null,
      signTransaction,
      this.connection,
      [],
      { preflightCommitment: "confirmed" },
      undefined,
      undefined,
      {
        onTransactionSigned: () => undefined,
        apiKey: this.mayanApiKey,
      },
    );
    return { signature: result.signature };
  }

  private async executeJupiterQuote(quote: JupiterQuote, minOutAmount: bigint, signer: Keypair): Promise<{
    signature: string;
    outAmount: bigint;
    quote: JupiterQuote;
  }> {
    const outAmount = BigInt(quote.outAmount);
    if (outAmount < minOutAmount) {
      throw new Error(`Jupiter output ${outAmount} is below minimum ${minOutAmount}`);
    }
    if (!quote.transaction || !quote.requestId) {
      throw new Error("Jupiter Ultra quote did not include an executable transaction");
    }

    const transaction = VersionedTransaction.deserialize(Buffer.from(quote.transaction, "base64"));
    transaction.sign([signer]);
    const result = await this.jupiter.execute(Buffer.from(transaction.serialize()).toString("base64"), quote.requestId);
    if (result.status !== "Success" || !result.signature) {
      throw new Error(result.error || "Jupiter swap execution failed");
    }

    return {
      signature: result.signature,
      outAmount,
      quote,
    };
  }

  private async ensureSolBalance(owner: PublicKey, minLamports: number): Promise<void> {
    const balance = await this.connection.getBalance(owner, "confirmed");
    if (balance >= minLamports) return;
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: this.hotWallet.publicKey,
        toPubkey: owner,
        lamports: minLamports - balance,
      }),
    );
    await sendAndConfirmTransaction(this.connection, transaction, [this.hotWallet], {
      commitment: "confirmed",
    });
  }

  requestWithdrawal(amount: bigint, xmrAddress: string): Promise<{
    signature: string;
    withdrawalPda: string;
  }> {
    return this.requestWithdrawalFromSigner(this.hotWallet, amount, xmrAddress);
  }

  async requestWithdrawalFromSigner(signer: Keypair, amount: bigint, xmrAddress: string): Promise<{
    signature: string;
    withdrawalPda: string;
  }> {
    await this.ensureSolBalance(signer.publicKey, REVERSE_ORDER_EXECUTION_SOL_LAMPORTS);
    return requestWithdrawalWithKeypair({
      connection: this.connection,
      signer,
      amount,
      xmrAddress,
      exactOut: false,
      programId: this.bridgeProgramId,
    });
  }

  async buildUserWithdrawalTransaction(user: PublicKey, amount: bigint, xmrAddress: string): Promise<{
    transaction: string;
    withdrawalPda: string;
    nonce: string;
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    const built = await buildRequestWithdrawalTransaction({
      connection: this.connection,
      user,
      amount,
      xmrAddress,
      exactOut: false,
      programId: this.bridgeProgramId,
    });
    const latestBlockhash = await this.connection.getLatestBlockhash("confirmed");
    built.transaction.feePayer = user;
    built.transaction.recentBlockhash = latestBlockhash.blockhash;
    return {
      transaction: built.transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }).toString("base64"),
      withdrawalPda: built.withdrawalPda,
      nonce: built.nonce.toString(),
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    };
  }

  async refundUsdc(amount: bigint, refundAddress: string): Promise<string> {
    return this.refundToken(USDC_MINT.toBase58(), amount, refundAddress);
  }

  async refundToken(mintAddress: string, amount: bigint, refundAddress: string): Promise<string> {
    const refundOwner = new PublicKey(refundAddress);
    const mint = new PublicKey(mintAddress);
    const fromAta = getAssociatedTokenAddressSync(mint, this.hotWallet.publicKey);
    const refundAta = getAssociatedTokenAddressSync(mint, refundOwner);
    const transaction = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        this.hotWallet.publicKey,
        refundAta,
        refundOwner,
        mint,
      ),
      createTransferInstruction(
        fromAta,
        refundAta,
        this.hotWallet.publicKey,
        amount,
        [],
        TOKEN_PROGRAM_ID,
      ),
    );
    return sendAndConfirmTransaction(this.connection, transaction, [this.hotWallet], {
      commitment: "confirmed",
    });
  }

  async getTokenBalance(mintAddress: string, owner: PublicKey): Promise<bigint> {
    const ata = getAssociatedTokenAddressSync(new PublicKey(mintAddress), owner);
    try {
      const balance = await this.connection.getTokenAccountBalance(ata, "confirmed");
      return BigInt(balance.value.amount);
    } catch {
      return 0n;
    }
  }

  /**
   * Funds sitting at a per-order deposit address. Native deposits count both
   * raw lamports and any wSOL the sender wrapped; token deposits count the
   * deposit owner's ATA balance.
   */
  async getDepositBalance(owner: PublicKey, mintAddress: string, native: boolean): Promise<bigint> {
    if (!native) {
      return this.getTokenBalance(mintAddress, owner);
    }
    const lamports = BigInt(await this.connection.getBalance(owner, "confirmed"));
    const wrapped = await this.getTokenBalance(WSOL_MINT_ADDRESS, owner);
    return lamports + wrapped;
  }

  /** True when the signature landed on-chain without error at confirmed commitment or better. */
  async getTransactionLanded(signature: string): Promise<boolean> {
    const status = await this.connection.getSignatureStatus(signature, { searchTransactionHistory: true });
    const value = status.value;
    return Boolean(
      value &&
      !value.err &&
      (value.confirmationStatus === "confirmed" || value.confirmationStatus === "finalized"),
    );
  }

  /**
   * Moves everything at a per-order deposit address into the hot wallet. The
   * hot wallet pays the fee so the whole deposit is swept; per-order token
   * accounts are closed to reclaim their rent. The signed transaction's
   * signature is handed to `onSigned` BEFORE broadcast so callers can persist
   * it for crash recovery.
   */
  async sweepDepositToHotWallet(
    owner: Keypair,
    mintAddress: string,
    native: boolean,
    onSigned?: (signature: string, amount: bigint) => void | Promise<void>,
  ): Promise<{
    signature: string;
    amount: bigint;
  }> {
    const transaction = new Transaction();
    let amount = 0n;
    if (native) {
      const lamports = BigInt(await this.connection.getBalance(owner.publicKey, "confirmed"));
      const wsolAta = getAssociatedTokenAddressSync(new PublicKey(WSOL_MINT_ADDRESS), owner.publicKey);
      const wrapped = await this.getTokenBalance(WSOL_MINT_ADDRESS, owner.publicKey);
      if (wrapped > 0n) {
        transaction.add(createCloseAccountInstruction(wsolAta, this.hotWallet.publicKey, owner.publicKey));
      }
      if (lamports > 0n) {
        transaction.add(
          SystemProgram.transfer({
            fromPubkey: owner.publicKey,
            toPubkey: this.hotWallet.publicKey,
            lamports: Number(lamports),
          }),
        );
      }
      amount = lamports + wrapped;
    } else {
      const mint = new PublicKey(mintAddress);
      const fromAta = getAssociatedTokenAddressSync(mint, owner.publicKey);
      const toAta = getAssociatedTokenAddressSync(mint, this.hotWallet.publicKey);
      amount = await this.getTokenBalance(mintAddress, owner.publicKey);
      if (amount <= 0n) {
        throw new Error("deposit sweep pending: token balance is empty");
      }
      transaction.add(
        createAssociatedTokenAccountIdempotentInstruction(
          this.hotWallet.publicKey,
          toAta,
          this.hotWallet.publicKey,
          mint,
        ),
        createTransferInstruction(fromAta, toAta, owner.publicKey, amount, [], TOKEN_PROGRAM_ID),
        createCloseAccountInstruction(fromAta, this.hotWallet.publicKey, owner.publicKey),
      );
    }
    if (amount <= 0n) {
      throw new Error("deposit sweep pending: nothing to sweep");
    }
    transaction.feePayer = this.hotWallet.publicKey;
    const latestBlockhash = await this.connection.getLatestBlockhash("confirmed");
    transaction.recentBlockhash = latestBlockhash.blockhash;
    transaction.sign(this.hotWallet, owner);
    const signature = bs58.encode(transaction.signature!);
    await onSigned?.(signature, amount);
    await this.connection.sendRawTransaction(transaction.serialize(), { preflightCommitment: "confirmed" });
    await this.connection.confirmTransaction(
      {
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      },
      "confirmed",
    );
    return { signature, amount };
  }

  /** Returns everything at a per-order deposit address to `refundAddress`; the hot wallet pays fees and rent. */
  async refundDeposit(owner: Keypair, mintAddress: string, native: boolean, refundAddress: string): Promise<{
    signature: string;
    amount: bigint;
  }> {
    const refundOwner = new PublicKey(refundAddress);
    const transaction = new Transaction();
    let amount = 0n;
    if (native) {
      const lamports = BigInt(await this.connection.getBalance(owner.publicKey, "confirmed"));
      const wsolAta = getAssociatedTokenAddressSync(new PublicKey(WSOL_MINT_ADDRESS), owner.publicKey);
      const wrapped = await this.getTokenBalance(WSOL_MINT_ADDRESS, owner.publicKey);
      if (wrapped > 0n) {
        // Unwraps into the deposit account first so the refund arrives as native SOL.
        transaction.add(createCloseAccountInstruction(wsolAta, owner.publicKey, owner.publicKey));
      }
      amount = lamports + wrapped;
      if (amount > 0n) {
        transaction.add(
          SystemProgram.transfer({
            fromPubkey: owner.publicKey,
            toPubkey: refundOwner,
            lamports: Number(amount),
          }),
        );
      }
    } else {
      const mint = new PublicKey(mintAddress);
      const fromAta = getAssociatedTokenAddressSync(mint, owner.publicKey);
      const toAta = getAssociatedTokenAddressSync(mint, refundOwner);
      amount = await this.getTokenBalance(mintAddress, owner.publicKey);
      if (amount > 0n) {
        transaction.add(
          createAssociatedTokenAccountIdempotentInstruction(
            this.hotWallet.publicKey,
            toAta,
            refundOwner,
            mint,
          ),
          createTransferInstruction(fromAta, toAta, owner.publicKey, amount, [], TOKEN_PROGRAM_ID),
          createCloseAccountInstruction(fromAta, this.hotWallet.publicKey, owner.publicKey),
        );
      }
    }
    if (amount <= 0n) {
      throw new Error("deposit refund pending: nothing to refund");
    }
    transaction.feePayer = this.hotWallet.publicKey;
    const signature = await sendAndConfirmTransaction(this.connection, transaction, [this.hotWallet, owner], {
      commitment: "confirmed",
    });
    return { signature, amount };
  }

  async verifySolanaTransfer(funding: SolanaTransferFunding, signature: string): Promise<{ amount: bigint }> {
    const transaction = await this.connection.getParsedTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!transaction) {
      throw new Error("Solana transfer pending: transaction not found yet");
    }
    if (transaction.meta?.err) {
      throw new Error("Solana transfer transaction failed");
    }

    const instructions = [
      ...transaction.transaction.message.instructions,
      ...(transaction.meta?.innerInstructions ?? []).flatMap((inner) => inner.instructions),
    ];
    const expectedAmount = BigInt(funding.amount);
    const destination = funding.destinationTokenAccount;
    let memoMatched = false;
    let transferred = 0n;

    for (const instruction of instructions) {
      const parsedInstruction = instruction as {
        program?: string;
        programId?: PublicKey;
        parsed?: string | { type?: string; info?: Record<string, unknown> };
      };
      const programId = parsedInstruction.programId?.toBase58();
      if (
        parsedInstruction.program === "spl-memo" ||
        programId === MEMO_PROGRAM_ID ||
        (typeof parsedInstruction.parsed === "string" && parsedInstruction.parsed.includes(funding.memo))
      ) {
        const parsedMemo = typeof parsedInstruction.parsed === "string" ? parsedInstruction.parsed : "";
        memoMatched = memoMatched || parsedMemo.includes(funding.memo) || JSON.stringify(parsedInstruction).includes(funding.memo);
        continue;
      }

      if (parsedInstruction.program !== "spl-token" || typeof parsedInstruction.parsed !== "object") {
        continue;
      }
      const info = parsedInstruction.parsed.info ?? {};
      const parsedDestination = typeof info.destination === "string" ? info.destination : "";
      if (parsedDestination !== destination) {
        continue;
      }
      const amount = tokenTransferAmount(info);
      transferred += amount;
    }

    if (!memoMatched) {
      throw new Error("Solana transfer is missing the order memo");
    }
    if (transferred < expectedAmount) {
      throw new Error(`Solana transfer amount ${transferred} is below expected ${expectedAmount}`);
    }

    return { amount: transferred };
  }
}

function tokenTransferAmount(info: Record<string, unknown>): bigint {
  const tokenAmount = info.tokenAmount as { amount?: string } | undefined;
  if (tokenAmount?.amount) return BigInt(tokenAmount.amount);
  const amount = info.amount;
  if (typeof amount === "string") return BigInt(amount);
  if (typeof amount === "number") return BigInt(amount);
  return 0n;
}

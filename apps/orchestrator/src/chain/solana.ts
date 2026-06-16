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
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { swapFromSolana, type Quote as MayanSdkQuote } from "@mayanfinance/swap-sdk";
import {
  JupiterClient,
  USDC_MINT,
  WXMR_MINT,
  type MayanSwiftQuote,
  type JupiterQuote,
} from "@wxmr/core";
import {
  claimPendingMintWithKeypair,
  createDepositAccountWithKeypair,
  fetchDepositAccount,
  requestWithdrawalWithKeypair,
  type DepositAccountInfo,
} from "@wxmr/core/bridge";

const REVERSE_ORDER_INITIAL_SOL_LAMPORTS = Math.floor(0.01 * LAMPORTS_PER_SOL);
const REVERSE_ORDER_EXECUTION_SOL_LAMPORTS = Math.floor(0.03 * LAMPORTS_PER_SOL);

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
    const quote = await this.jupiter.quoteUsdcToWxmr(amount, this.hotWallet.publicKey.toBase58());
    return this.executeJupiterQuote(quote, minWxmrOut, this.hotWallet);
  }

  async swapWxmrToUsdc(amount: bigint, minUsdcOut: bigint, signer: Keypair): Promise<{
    signature: string;
    outAmount: bigint;
    quote: JupiterQuote;
  }> {
    await this.ensureSolBalance(signer.publicKey, REVERSE_ORDER_EXECUTION_SOL_LAMPORTS);
    const quote = await this.jupiter.quoteWxmrToUsdc(amount, signer.publicKey.toBase58());
    return this.executeJupiterQuote(quote, minUsdcOut, signer);
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

  async claimMoneroDeposit(owner: Keypair): Promise<string> {
    await this.ensureSolBalance(owner.publicKey, REVERSE_ORDER_EXECUTION_SOL_LAMPORTS);
    return claimPendingMintWithKeypair({
      connection: this.connection,
      signer: owner,
      programId: this.bridgeProgramId,
    });
  }

  async transferWxmr(from: Keypair, toOwner: PublicKey, amount: bigint): Promise<string> {
    if (amount <= 0n) return "";
    const fromAta = getAssociatedTokenAddressSync(WXMR_MINT, from.publicKey);
    const toAta = getAssociatedTokenAddressSync(WXMR_MINT, toOwner);
    const transaction = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        from.publicKey,
        toAta,
        toOwner,
        WXMR_MINT,
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

  async refundUsdc(amount: bigint, refundAddress: string): Promise<string> {
    const refundOwner = new PublicKey(refundAddress);
    const fromAta = getAssociatedTokenAddressSync(USDC_MINT, this.hotWallet.publicKey);
    const refundAta = getAssociatedTokenAddressSync(USDC_MINT, refundOwner);
    const transaction = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        this.hotWallet.publicKey,
        refundAta,
        refundOwner,
        USDC_MINT,
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
}

import {
  Connection,
  Keypair,
  PublicKey,
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
import {
  JupiterClient,
  USDC_MINT,
  type JupiterQuote,
} from "@wxmr/core";
import { requestWithdrawalWithKeypair } from "@wxmr/core/bridge";

export class SolanaExecutor {
  private readonly jupiter: JupiterClient;

  constructor(
    private readonly connection: Connection,
    private readonly hotWallet: Keypair,
    private readonly bridgeProgramId: string,
    jupiterApiKey?: string,
  ) {
    this.jupiter = new JupiterClient({ apiKey: jupiterApiKey });
  }

  async swapUsdcToWxmr(amount: bigint, minWxmrOut: bigint): Promise<{
    signature: string;
    outAmount: bigint;
    quote: JupiterQuote;
  }> {
    const quote = await this.jupiter.quoteUsdcToWxmr(amount, this.hotWallet.publicKey.toBase58());
    const outAmount = BigInt(quote.outAmount);
    if (outAmount < minWxmrOut) {
      throw new Error(`Jupiter output ${outAmount} is below minimum ${minWxmrOut}`);
    }
    if (!quote.transaction || !quote.requestId) {
      throw new Error("Jupiter Ultra quote did not include an executable transaction");
    }

    const transaction = VersionedTransaction.deserialize(Buffer.from(quote.transaction, "base64"));
    transaction.sign([this.hotWallet]);
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

  requestWithdrawal(amount: bigint, xmrAddress: string): Promise<{
    signature: string;
    withdrawalPda: string;
  }> {
    return requestWithdrawalWithKeypair({
      connection: this.connection,
      signer: this.hotWallet,
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

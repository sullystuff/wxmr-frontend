import {
  Connection,
  TransactionExpiredBlockheightExceededError,
  TransactionExpiredTimeoutError,
  type Commitment,
  type TransactionConfirmationStrategy,
  type RpcResponseAndContext,
  type SignatureResult,
} from '@solana/web3.js';

// HTTP always goes through the site's shared budget, including confirmation.
// No browser RPC keys or independent WebSocket connections are needed.
export class BridgeConnection extends Connection {
  constructor() {
    super('https://api.mainnet.solana.com', {
      commitment: 'confirmed',
      disableRetryOnRateLimit: true,
      fetch: (_url, options) => fetch('/api/solana', options),
    });
  }

  override async confirmTransaction(
    strategy: TransactionConfirmationStrategy | string,
    commitment: Commitment = 'confirmed',
  ): Promise<RpcResponseAndContext<SignatureResult>> {
    if (typeof strategy !== 'string' && !('lastValidBlockHeight' in strategy)) {
      throw new Error('Durable nonce confirmation is not supported by the bridge frontend');
    }
    const signature = typeof strategy === 'string' ? strategy : strategy.signature;
    const signal = typeof strategy === 'string' ? undefined : strategy.abortSignal;
    const started = Date.now();
    const wantsFinalized = ['finalized', 'max', 'root'].includes(commitment);
    const wantsProcessed = ['processed', 'recent'].includes(commitment);
    while (Date.now() - started < 60_000) {
      signal?.throwIfAborted();
      const { context, value } = await this.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const status = value[0];
      if (status && (wantsProcessed || status.confirmationStatus === 'finalized'
        || (!wantsFinalized && status.confirmationStatus === 'confirmed'))) {
        return { context, value: { err: status.err } };
      }
      if (typeof strategy !== 'string'
        && await this.getBlockHeight(commitment) > strategy.lastValidBlockHeight) {
        throw new TransactionExpiredBlockheightExceededError(signature);
      }
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    // A timeout is uncertain; never turn it into success or construct a retry.
    throw new TransactionExpiredTimeoutError(signature, 60);
  }
}

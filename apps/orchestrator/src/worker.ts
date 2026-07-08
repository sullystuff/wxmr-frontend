import { setTimeout as sleep } from "node:timers/promises";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import {
  CHAINS,
  ChainflipClient,
  THORCHAIN,
  USDC_MINT_ADDRESS,
  WXMR_MINT_ADDRESS,
  MayanClient,
  ThorchainClient,
  chainflipDeliveredBaseUnits,
  chainflipDestinationTx,
  chainflipSwapFailed,
  chainflipSwapSucceeded,
  type DepositAddressFunding,
  mayanDeliveredBaseUnits,
  mayanDestinationTx,
  mayanSwapFailed,
  mayanSwapSucceeded,
  thorchainAmountToBaseUnits,
  thorchainOutTx,
  thorchainPlannedRefund,
  thorchainTxAmount,
  type Order,
  type Quote,
  type SourceChainId,
} from "@wxmr/core";
import { loadEnv } from "./env.js";
import { Store } from "./db.js";
import { EvmExecutor, evmDepositConfirmations } from "./chain/evm.js";
import { SolanaExecutor } from "./chain/solana.js";
import { deriveReverseDepositOwner } from "./reverse.js";
import { deriveEvmDepositAccount, deriveSolanaDepositOwner } from "./deposit.js";
import { requiresSolanaHotWalletPayout } from "./route-policy.js";

const env = loadEnv();
const store = new Store(env.dbPath);
const connection = new Connection(env.solanaRpcUrl, "confirmed");
const mayan = new MayanClient({ apiKey: env.mayanApiKey });
const chainflip = new ChainflipClient({ backendUrl: env.chainflipBackendUrl });
const thorchain = new ThorchainClient({ thornodeUrl: env.thornodeUrl, clientId: env.thornodeClientId });
const evm = env.evmHotWalletPrivateKey
  ? new EvmExecutor(privateKeyToAccount(env.evmHotWalletPrivateKey), env.evmRpcUrlByChain, env.mayanApiKey)
  : null;
const solana = new SolanaExecutor(connection, env.solanaHotWallet, env.bridgeProgramId, env.jupiterApiKey, env.mayanApiKey);
const DEFAULT_SLIPPAGE_BPS = 200;
const USDC_DECIMALS = 6;
const BTC_DECIMALS = 8;

let shuttingDown = false;
process.on("SIGINT", () => {
  shuttingDown = true;
});
process.on("SIGTERM", () => {
  shuttingDown = true;
});

// Late deposits: how often to rescan recently expired address orders, and
// how long after expiry a deposit still revives its order.
const LATE_DEPOSIT_SCAN_TICKS = 200; // ~10 minutes at the 3s tick
const LATE_DEPOSIT_WINDOW_MS = 48 * 60 * 60 * 1000;
let tickCounter = 0;

while (!shuttingDown) {
  await tick().catch((error) => {
    console.error("worker tick failed", error);
  });
  if (tickCounter++ % LATE_DEPOSIT_SCAN_TICKS === 0) {
    await scanExpiredAddressDeposits().catch((error) => {
      console.error("late deposit scan failed", error);
    });
  }
  await sleep(3_000);
}

async function tick(): Promise<void> {
  const orders = store.listOrdersByStatus(["awaiting_deposit", "bridging", "minted", "withdrawing", "refunding"], 25);
  for (const order of orders) {
    // Orchestrator-watched deposit addresses handle their own expiry: funds
    // may already be sitting at the address, in which case the order should
    // execute (or refund), not silently expire.
    if (
      Date.parse(order.expiresAt) <= Date.now() &&
      order.status === "awaiting_deposit" &&
      !isWatchedAddressOrder(order)
    ) {
      store.updateOrder(order.id, { status: "expired" }, "order expired before deposit");
      continue;
    }
    await processOrder(order).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("pending")) {
        store.addEvent(order.id, order.status, message);
        return;
      }
      store.updateOrder(order.id, { status: "failed", error: message }, message);
    });
  }
}

function isWatchedAddressOrder(order: Order): boolean {
  return (
    order.funding.type === "deposit-address" &&
    order.direction !== "xmr-to-mayan" &&
    (order.funding.chainId === "solana" || CHAINS[order.funding.chainId].kind === "evm")
  );
}

async function processOrder(order: Order): Promise<void> {
  if (order.status === "awaiting_deposit") {
    if (order.direction === "xmr-to-mayan") {
      await processMoneroDeposit(order);
      return;
    }
    if (order.funding.type === "deposit-address" && order.funding.chainId === "solana") {
      await processSolanaAddressDeposit(order, order.funding).catch(rethrowAsPendingWatch);
      return;
    }
    if (order.funding.type === "deposit-address" && CHAINS[order.funding.chainId].kind === "evm") {
      await processEvmAddressDeposit(order, order.funding).catch(rethrowAsPendingWatch);
      return;
    }
    if (
      order.funding.type === "deposit-address" &&
      order.funding.chainId === "bitcoin" &&
      order.funding.provider === "Chainflip"
    ) {
      await watchChainflipDeposit(order, order.funding).catch(rethrowAsPendingWatch);
      return;
    }
    // Wallet-funded orders advance through the API when the user signs.
    return;
  }

  if (order.status === "bridging") {
    if (order.funding.type === "deposit-address" && order.funding.chainId === "bitcoin") {
      if (order.funding.provider === "Chainflip") {
        await processChainflipBridge(order);
      } else {
        await processThorchainBridge(order);
      }
    } else {
      await processMayanBridge(order);
    }
    return;
  }

  if (order.status === "minted") {
    if (order.direction === "xmr-to-mayan") {
      await executeSwapAndMayanPayout(order);
    } else if (order.direction === "asset-to-asset") {
      await executeAssetPayout(order);
    } else {
      await executeSwapAndWithdrawal(order);
    }
    return;
  }

  if (order.status === "withdrawing" && (order.direction === "xmr-to-mayan" || order.direction === "asset-to-asset")) {
    await processReverseMayanSettlement(order);
    return;
  }

  if (order.status === "refunding") {
    if (order.direction === "xmr-to-mayan") {
      await refundReverse(order);
    } else if (isWatchedAddressOrder(order) && !order.sourceTxHash) {
      // sourceTxHash marks the point where funds left the deposit address
      // (Solana sweep / EVM Mayan forward); before that, refund from the
      // per-order address itself.
      await refundAddressDeposit(order, order.funding as DepositAddressFunding);
    } else {
      await refund(order);
    }
  }
}

async function scanExpiredAddressDeposits(): Promise<void> {
  const since = new Date(Date.now() - LATE_DEPOSIT_WINDOW_MS).toISOString();
  for (const order of store.listExpiredOrdersSince(since)) {
    if (!isWatchedAddressOrder(order)) continue;
    const funding = order.funding as DepositAddressFunding;
    const balance = await addressDepositBalance(order, funding).catch(() => 0n);
    if (balance < depositDustFloor(order, funding)) continue;
    // A deposit landed after expiry — revive the order; the watcher's
    // expired-order branch executes whatever is there at a fresh quote.
    store.updateOrder(
      order.id,
      { status: "awaiting_deposit" },
      `late deposit detected (${balance} base units); resuming order`,
    );
  }
}

async function addressDepositBalance(order: Order, funding: DepositAddressFunding): Promise<bigint> {
  if (funding.chainId === "solana") {
    const owner = deriveSolanaDepositOwner(env.solanaHotWallet, order.id);
    return solana.getDepositBalance(owner.publicKey, funding.asset, Boolean(funding.native));
  }
  if (!evm || !env.evmHotWalletPrivateKey || !evm.hasChain(funding.chainId)) return 0n;
  const account = deriveEvmDepositAccount(env.evmHotWalletPrivateKey, order.id);
  return funding.native
    ? evm.getNativeBalance(funding.chainId, account.address)
    : evm.getErc20Balance(funding.chainId, funding.asset as Address, account.address);
}

async function watchChainflipDeposit(order: Order, funding: DepositAddressFunding): Promise<void> {
  if (!funding.depositChannelId) return;
  const status = await chainflip.fetchStatus(funding.depositChannelId);
  if (status.state !== "WAITING") {
    // The channel saw a deposit — hand over to the bridging tracker without
    // requiring anyone to report a txid.
    store.updateOrder(order.id, { status: "bridging" }, `Chainflip deposit detected (${status.state})`);
  }
}

/**
 * Deposit watchers only read chain state; a failure while watching is an
 * RPC/transport problem, never a reason to terminally fail an order that is
 * still waiting. tick() treats "pending" messages as retryable.
 */
function rethrowAsPendingWatch(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("pending")) {
    throw error instanceof Error ? error : new Error(message);
  }
  throw new Error(`deposit watch pending retry: ${message}`);
}

const EXECUTION_RETRY_LIMIT = 5;
const EXECUTION_RETRY_COOLDOWN_MS = 30_000;
// How long a signed-and-persisted broadcast may stay unconfirmed before the
// watcher assumes it never landed and rebuilds it. Must exceed Solana's
// blockhash validity (~90s) so an expired sweep can never land after a retry
// begins.
const BROADCAST_GRACE_MS = 3 * 60 * 1000;

function isExpired(order: Order): boolean {
  return Date.parse(order.expiresAt) <= Date.now();
}

function broadcastGraceElapsed(funding: DepositAddressFunding): boolean {
  if (!funding.lastExecutionAttemptAt) return true;
  return Date.now() - Date.parse(funding.lastExecutionAttemptAt) > BROADCAST_GRACE_MS;
}

/**
 * Clears a broadcast marker after a failed/reverted/dropped transaction and
 * charges it against the retry budget — otherwise a deterministically
 * reverting forward would rebuild forever, burning gas on every cycle,
 * without ever escalating to a refund.
 */
function clearMarkerAndCountAttempt(order: Order, funding: DepositAddressFunding, detail: string): void {
  const cleared = {
    ...funding,
    pendingSweepSignature: undefined,
    pendingSweepAmount: undefined,
    pendingForwardTxHash: undefined,
  };
  const attempts = (funding.executionAttempts ?? 0) + 1;
  if (attempts >= EXECUTION_RETRY_LIMIT) {
    store.updateOrder(
      order.id,
      { status: "refunding", error: detail, funding: { ...cleared, executionAttempts: attempts } },
      `${detail}; retry limit reached, refunding deposit`,
    );
    return;
  }
  store.updateOrder(
    order.id,
    {
      funding: {
        ...cleared,
        executionAttempts: attempts,
        lastExecutionAttemptAt: new Date().toISOString(),
      },
    },
    `${detail} (attempt ${attempts}/${EXECUTION_RETRY_LIMIT})`,
  );
}

/** Sends of at least 90% of the quoted amount execute immediately; anything smaller waits for more chunks until expiry. */
function depositThreshold(order: Order, funding: DepositAddressFunding): bigint {
  const expected = BigInt(funding.expectedAmount ?? order.amount);
  return expected - expected / 10n;
}

/**
 * Balances below 5% of the quoted amount are ignored: they neither count as
 * a deposit nor revive an expired order. This keeps dust sends from burning
 * hot-wallet gas on doomed executions and refunds.
 */
function depositDustFloor(order: Order, funding: DepositAddressFunding): bigint {
  const expected = BigInt(funding.expectedAmount ?? order.amount);
  const floor = expected / 20n;
  return floor > 0n ? floor : 1n;
}

function inExecutionCooldown(funding: DepositAddressFunding): boolean {
  if (!funding.lastExecutionAttemptAt) return false;
  return Date.now() - Date.parse(funding.lastExecutionAttemptAt) < EXECUTION_RETRY_COOLDOWN_MS;
}

/**
 * Wraps a server-side execution attempt with bounded retries: transient
 * provider/RPC failures retry on a cooldown, and after the limit the order
 * moves to refunding so the deposit goes back instead of sitting in limbo.
 */
async function attemptAddressExecution(
  order: Order,
  funding: DepositAddressFunding,
  execute: () => Promise<void>,
): Promise<void> {
  if (inExecutionCooldown(funding)) return;
  try {
    await execute();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Re-read funding: execute() may have persisted a broadcast marker before
    // the error (e.g. a confirmation timeout on a transaction that landed).
    // Writing a stale copy here would erase it and lose the only pointer to
    // in-flight funds.
    const current = store.getOrder(order.id)?.funding;
    const fresh = current?.type === "deposit-address" ? current : funding;
    if (fresh.pendingSweepSignature || fresh.pendingForwardTxHash) {
      store.addEvent(order.id, order.status, `execution errored after broadcast; recovery will confirm it: ${message}`);
      return;
    }
    const attempts = (fresh.executionAttempts ?? 0) + 1;
    if (attempts >= EXECUTION_RETRY_LIMIT) {
      store.updateOrder(
        order.id,
        { status: "refunding", error: message },
        `execution failed ${attempts} times, refunding deposit: ${message}`,
      );
      return;
    }
    store.updateOrder(
      order.id,
      {
        funding: {
          ...fresh,
          executionAttempts: attempts,
          lastExecutionAttemptAt: new Date().toISOString(),
        },
      },
      `execution attempt ${attempts}/${EXECUTION_RETRY_LIMIT} failed: ${message}`,
    );
  }
}

async function processSolanaAddressDeposit(order: Order, funding: DepositAddressFunding): Promise<void> {
  const owner = deriveSolanaDepositOwner(env.solanaHotWallet, order.id);
  const native = Boolean(funding.native);

  if (funding.pendingSweepSignature) {
    if (await solana.getTransactionLanded(funding.pendingSweepSignature)) {
      store.updateOrder(
        order.id,
        {
          status: "minted",
          sourceTxHash: funding.pendingSweepSignature,
          destinationAmount: funding.pendingSweepAmount ?? funding.detectedAmount,
          funding: { ...funding, pendingSweepSignature: undefined, pendingSweepAmount: undefined },
        },
        `deposit sweep confirmed: ${funding.pendingSweepSignature}`,
      );
      return;
    }
    if (!broadcastGraceElapsed(funding)) {
      throw new Error("deposit sweep pending confirmation");
    }
    const liveBalance = await solana.getDepositBalance(owner.publicKey, funding.asset, native);
    if (liveBalance <= 0n) {
      // The deposit moved but the signature is not visible yet (lagging
      // RPC): keep waiting rather than declare the sweep dead.
      throw new Error("deposit sweep pending: address empty but signature not visible yet");
    }
    // Past the grace window the sweep's blockhash has expired, so it can
    // never land — safe to rebuild it from the live balance.
    clearMarkerAndCountAttempt(order, funding, `sweep ${funding.pendingSweepSignature} did not land`);
    return;
  }

  const balance = await solana.getDepositBalance(owner.publicKey, funding.asset, native);
  const expired = isExpired(order);
  if (balance < depositDustFloor(order, funding)) {
    if (expired) {
      store.updateOrder(
        order.id,
        { status: "expired" },
        balance > 0n ? `order expired with only dust deposited (${balance})` : "order expired before deposit",
      );
    }
    return;
  }

  const detected = BigInt(funding.detectedAmount ?? "0");
  if (balance !== detected) {
    // Two consecutive identical readings before acting, so multi-part sends
    // and test transfers are not executed prematurely.
    store.updateOrder(
      order.id,
      { funding: { ...funding, detectedAmount: balance.toString() } },
      `deposit detected: ${balance} base units of ${funding.assetSymbol ?? funding.asset}`,
    );
    return;
  }
  if (balance < depositThreshold(order, funding) && !expired) {
    return;
  }

  await attemptAddressExecution(order, funding, async () => {
    const sweep = await solana.sweepDepositToHotWallet(owner, funding.asset, native, (signature, amount) => {
      store.updateOrder(
        order.id,
        {
          funding: {
            ...funding,
            pendingSweepSignature: signature,
            pendingSweepAmount: amount.toString(),
            lastExecutionAttemptAt: new Date().toISOString(),
          },
        },
        `sweep signed: ${signature}`,
      );
    });
    store.updateOrder(
      order.id,
      {
        status: "minted",
        sourceTxHash: sweep.signature,
        destinationAmount: sweep.amount.toString(),
        funding: { ...funding, pendingSweepSignature: undefined, pendingSweepAmount: undefined },
      },
      `deposit of ${sweep.amount} swept to hot wallet: ${sweep.signature}`,
    );
  });
}

async function processEvmAddressDeposit(order: Order, funding: DepositAddressFunding): Promise<void> {
  if (!evm || !env.evmHotWalletPrivateKey) {
    throw new Error("EVM deposit watching pending: EVM_HOTWALLET_PRIVATE_KEY is not configured");
  }
  const chainId = funding.chainId;
  if (!evm.hasChain(chainId)) {
    throw new Error(`EVM deposit watching pending: no RPC configured for ${chainId}`);
  }
  const account = deriveEvmDepositAccount(env.evmHotWalletPrivateKey, order.id);

  if (funding.pendingForwardTxHash) {
    const receiptStatus = await evm.getTransactionReceiptStatus(chainId, funding.pendingForwardTxHash as `0x${string}`);
    if (receiptStatus === "success") {
      store.updateOrder(
        order.id,
        {
          status: "bridging",
          sourceTxHash: funding.pendingForwardTxHash,
          funding: { ...funding, pendingForwardTxHash: undefined },
        },
        `Mayan Swift forward confirmed: ${funding.pendingForwardTxHash}`,
      );
      return;
    }
    if (receiptStatus === "reverted") {
      clearMarkerAndCountAttempt(order, funding, `Mayan Swift forward ${funding.pendingForwardTxHash} reverted on-chain`);
      return;
    }
    if (!broadcastGraceElapsed(funding)) {
      throw new Error("Mayan Swift forward pending confirmation");
    }
    const liveBalance = funding.native
      ? await evm.getNativeBalance(chainId, account.address)
      : await evm.getErc20Balance(chainId, funding.asset as Address, account.address);
    if (liveBalance > 0n) {
      // Deposit untouched and no receipt after the grace window: the forward
      // was dropped. A rebuilt forward normally reuses the same nonce so at
      // most one lands; if a mempool-stuck original slips through anyway,
      // whichever loses reverts on the already-spent balance — gas is
      // wasted, the deposit is not.
      clearMarkerAndCountAttempt(order, funding, `Mayan Swift forward ${funding.pendingForwardTxHash} not found after grace`);
      return;
    }
    // Funds moved but the receipt is not visible yet — keep waiting rather
    // than guess.
    throw new Error("Mayan Swift forward pending: receipt not visible yet");
  }

  const balance = funding.native
    ? await evm.getNativeBalance(chainId, account.address)
    : await evm.getErc20Balance(chainId, funding.asset as Address, account.address);
  const expired = isExpired(order);
  if (balance < depositDustFloor(order, funding)) {
    if (expired) {
      store.updateOrder(
        order.id,
        { status: "expired" },
        balance > 0n ? `order expired with only dust deposited (${balance})` : "order expired before deposit",
      );
    }
    return;
  }

  const detected = BigInt(funding.detectedAmount ?? "0");
  if (balance !== detected) {
    const block = await evm.getBlockNumber(chainId);
    store.updateOrder(
      order.id,
      {
        funding: {
          ...funding,
          detectedAmount: balance.toString(),
          detectedAtBlock: block.toString(),
        },
      },
      `deposit detected: ${balance} base units of ${funding.assetSymbol ?? funding.asset} at block ${block}`,
    );
    return;
  }
  const detectedAtBlock = BigInt(funding.detectedAtBlock ?? "0");
  const confirmations = evmDepositConfirmations(chainId);
  const block = await evm.getBlockNumber(chainId);
  if (block < detectedAtBlock + confirmations) {
    return;
  }
  if (balance < depositThreshold(order, funding) && !expired) {
    return;
  }

  await attemptAddressExecution(order, funding, () => executeEvmAddressDeposit(order, funding, account, balance));
}

async function executeEvmAddressDeposit(
  order: Order,
  funding: DepositAddressFunding,
  account: PrivateKeyAccount,
  balance: bigint,
): Promise<void> {
  const quote = mustGetQuote(order.quoteId);
  const chainId = funding.chainId;
  // Mirrors the wallet-mode Mayan destination: everything that needs a
  // Solana-side swap lands as USDC at the hot wallet; direct asset-to-asset
  // payouts go straight to the user's destination.
  const solanaLeg = quote.direction !== "asset-to-asset" || requiresSolanaHotWalletPayout(quote);
  const destination = solanaLeg
    ? env.solanaHotWallet.publicKey.toBase58()
    : order.destinationAddress ?? env.solanaHotWallet.publicKey.toBase58();
  const toChain = solanaLeg ? ("solana" as SourceChainId) : getDestinationChain(order, quote);
  const toToken = solanaLeg ? USDC_MINT_ADDRESS : getDestinationToken(order, quote);

  let amount = balance;
  if (funding.native) {
    const gasReserve = await evm!.forwardGasCost(chainId, false);
    amount = balance - gasReserve;
    if (amount <= 0n) {
      // Fee estimates move; let the retry/refund machinery decide instead of
      // terminally failing on one fee snapshot (a plain native transfer needs
      // far less gas, so the refund usually still goes through).
      throw new Error(`deposit of ${balance} wei cannot cover its own forwarding gas (${gasReserve} wei) on ${chainId}`);
    }
  }

  // The order's quote may be long expired; the deposit executes at a fresh
  // market quote for whatever amount actually arrived.
  const payoutQuote = await mayan.fetchSwiftQuoteForRoute({
    fromChain: chainId,
    fromToken: order.sourceToken,
    toChain,
    toToken,
    amount,
    destinationAddress: destination,
    slippageBps: quote.mayan?.quote.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
  });

  if (shouldRefundOnSlippage(order)) {
    const lockedMinimum = BigInt(
      solanaLeg ? quote.mayan?.minSolanaUsdcOut ?? "0" : quote.minDestinationOut ?? "0",
    );
    const scaledMinimum = (lockedMinimum * amount) / BigInt(quote.inputAmount);
    if (BigInt(payoutQuote.minReceivedBaseUnits) < scaledMinimum) {
      store.updateOrder(
        order.id,
        {
          status: "refunding",
          error: `Mayan minimum ${payoutQuote.minReceivedBaseUnits} is below the scaled locked minimum ${scaledMinimum}`,
        },
        "address deposit re-quote below locked minimum",
      );
      return;
    }
  }

  if (!funding.native) {
    const gasNeeded = await evm!.forwardGasCost(chainId, true);
    await evm!.ensureNativeBalance(chainId, account.address, gasNeeded);
  }

  const txHash = await evm!.executeMayanSwiftFrom(chainId, account, payoutQuote, destination, (hash) => {
    store.updateOrder(
      order.id,
      {
        funding: {
          ...funding,
          pendingForwardTxHash: hash,
          lastExecutionAttemptAt: new Date().toISOString(),
        },
      },
      `Mayan Swift forward signed: ${hash}`,
    );
  });
  // The order stays awaiting_deposit until the watcher sees a successful
  // receipt for the persisted hash — that is also what catches a forward
  // that reverts on-chain (e.g. mined past the Mayan deadline).
  store.addEvent(order.id, order.status, `Mayan Swift forwarded ${amount} from the deposit address: ${txHash}`);
}

async function refundAddressDeposit(order: Order, funding: DepositAddressFunding): Promise<void> {
  if (!order.refundAddress) {
    throw new Error(`refund pending: no refund address on file — supply one via POST /orders/${order.id}/refund-address`);
  }
  if (funding.chainId === "solana") {
    const owner = deriveSolanaDepositOwner(env.solanaHotWallet, order.id);
    try {
      const refunded = await solana.refundDeposit(owner, funding.asset, Boolean(funding.native), order.refundAddress);
      store.updateOrder(order.id, { status: "refunded" }, `deposit refunded on Solana: ${refunded.signature}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`refund pending retry: ${message}`);
    }
    return;
  }

  if (!evm || !env.evmHotWalletPrivateKey) {
    throw new Error("refund pending: EVM executor is not configured");
  }
  if (!isAddress(order.refundAddress)) {
    throw new Error(`refund pending: ${order.refundAddress} is not a valid EVM address — update it via POST /orders/${order.id}/refund-address`);
  }
  const chainId = funding.chainId;
  const account = deriveEvmDepositAccount(env.evmHotWalletPrivateKey, order.id);
  try {
    if (funding.native) {
      const balance = await evm.getNativeBalance(chainId, account.address);
      if (balance <= 0n) {
        // A Mayan-refunded forward can take a while to land back here.
        throw new Error("refund pending: deposit address is empty; waiting for funds to return");
      }
      const gasCost = await evm.nativeTransferGasCost(chainId);
      const amount = balance - gasCost;
      if (amount <= 0n) {
        store.updateOrder(
          order.id,
          { status: "failed", error: `deposit of ${balance} wei cannot cover refund gas on ${chainId}` },
          "deposit below refund gas cost",
        );
        return;
      }
      const hash = await evm.transferNative(chainId, account, order.refundAddress, amount);
      store.updateOrder(order.id, { status: "refunded" }, `deposit refunded on ${chainId}: ${hash}`);
    } else {
      const balance = await evm.getErc20Balance(chainId, funding.asset as Address, account.address);
      if (balance <= 0n) {
        throw new Error("refund pending: deposit address is empty; waiting for funds to return");
      }
      await evm.ensureNativeBalance(chainId, account.address, await evm.erc20TransferGasCost(chainId));
      const hash = await evm.transferErc20(chainId, account, funding.asset as Address, order.refundAddress, balance);
      store.updateOrder(order.id, { status: "refunded" }, `deposit refunded on ${chainId}: ${hash}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("pending")) throw error;
    throw new Error(`refund pending retry: ${message}`);
  }
}

async function processMoneroDeposit(order: Order): Promise<void> {
  if (order.funding.type !== "deposit-address" || order.funding.chainId !== "monero") {
    throw new Error("reverse order is missing Monero deposit funding");
  }
  const owner = deriveReverseDepositOwner(env.solanaHotWallet, order.id);
  const deposit = await solana.fetchMoneroDeposit(owner.publicKey);
  if (!deposit) {
    throw new Error("Monero deposit account pending: not created yet");
  }

  const funding = mergeDepositFunding(order.funding, {
    address: deposit.xmrDepositAddress || order.funding.address,
    depositOwner: owner.publicKey.toBase58(),
    depositPda: deposit.depositPda,
  });
  if (
    funding.address !== order.funding.address ||
    funding.depositOwner !== order.funding.depositOwner ||
    funding.depositPda !== order.funding.depositPda
  ) {
    store.updateOrder(order.id, { funding }, "Monero deposit address updated");
  }

  if (deposit.status !== "active" || !deposit.xmrDepositAddress) {
    throw new Error("Monero deposit address pending: waiting for bridge assignment");
  }
  if (deposit.totalDeposited < BigInt(order.amount)) {
    throw new Error(`Monero deposit pending: ${deposit.totalDeposited}/${order.amount} piconero`);
  }

  const claimSignature = await solana.claimMoneroDeposit(owner);
  store.updateOrder(
    order.id,
    {
      status: "minted",
      funding,
      destinationAmount: deposit.totalDeposited.toString(),
      solanaMintSignature: claimSignature,
    },
    `claimed ${deposit.totalDeposited} wXMR from bridge deposit`,
  );
}

async function processMayanBridge(order: Order): Promise<void> {
  const funding = order.funding;
  const isAddressFunded = funding.type === "deposit-address" && CHAINS[funding.chainId].kind === "evm";
  if (funding.type !== "mayan-swift" && !isAddressFunded) {
    throw new Error("bridging order is missing Mayan Swift funding");
  }
  if (!order.sourceTxHash) {
    throw new Error("Mayan order has no source transaction hash");
  }

  const details = await mayan.fetchSwapByTx(order.sourceTxHash);
  if (mayanSwapFailed(details)) {
    if (isAddressFunded) {
      // The Swift source wallet is the per-order deposit key, so Mayan's
      // on-chain refund returns the tokens to the deposit address — route
      // them back to the user instead of dead-ending at 'failed'.
      store.updateOrder(
        order.id,
        {
          status: "refunding",
          sourceTxHash: undefined,
          error: `Mayan swap ${details.clientStatus ?? details.status}`,
        },
        `Mayan swap failed (${details.clientStatus ?? details.status}); expecting the refund at the deposit address (forward ${order.sourceTxHash})`,
      );
      return;
    }
    store.updateOrder(order.id, { status: "failed", error: `Mayan swap ${details.clientStatus ?? details.status}` }, "Mayan swap failed");
    return;
  }
  if (!mayanSwapSucceeded(details)) {
    throw new Error(`Mayan swap pending: ${details.clientStatus ?? details.status ?? "unknown"}`);
  }

  const quote = mustGetQuote(order.quoteId);
  const toTokenDecimals = funding.type === "mayan-swift"
    ? funding.mayanQuote.toToken.decimals ?? 6
    : quote.mayan?.quote.toToken.decimals ?? 6;
  const destinationAmount = mayanDeliveredBaseUnits(details, toTokenDecimals);
  const destinationTx = mayanDestinationTx(details) ?? order.sourceTxHash;
  if (quote.direction === "asset-to-asset" && !requiresSolanaHotWalletPayout(quote)) {
    store.updateOrder(
      order.id,
      {
        status: "completed",
        destinationAmount,
        withdrawalSignature: destinationTx,
      },
      `Mayan delivered ${destinationAmount} to destination`,
    );
    return;
  }

  store.updateOrder(
    order.id,
    {
      status: "minted",
      destinationAmount,
      solanaMintSignature: destinationTx,
    },
    `Mayan delivered ${destinationAmount} USDC on Solana`,
  );
}

async function processChainflipBridge(order: Order): Promise<void> {
  if (order.funding.type !== "deposit-address" || order.funding.chainId !== "bitcoin") {
    throw new Error("BTC order is missing Chainflip deposit funding");
  }
  const channelId = order.funding.depositChannelId;
  if (!channelId) {
    throw new Error("Chainflip BTC order is missing a deposit channel id");
  }
  const quote = mustGetQuote(order.quoteId);
  if (!quote.chainflip) {
    throw new Error("BTC order is missing Chainflip quote metadata");
  }

  if (quote.chainflip.mode === "eth-usdc-forward" && order.solanaMintSignature) {
    await processChainflipMayanForward(order, quote);
    return;
  }

  const status = await chainflip.fetchStatus(channelId);
  if (chainflipSwapFailed(status)) {
    store.updateOrder(order.id, { status: "failed", error: `Chainflip swap ${status.state}` }, "Chainflip swap failed");
    return;
  }
  if (!chainflipSwapSucceeded(status)) {
    throw new Error(`Chainflip swap pending: ${status.state}`);
  }

  const destinationAmount = chainflipDeliveredBaseUnits(status);
  const minimum = quote.chainflip.mode === "eth-usdc-forward" ? null : BigInt(quote.chainflip.minSolanaUsdcOut);
  if (minimum !== null && shouldRefundOnSlippage(order) && BigInt(destinationAmount) < minimum) {
    store.updateOrder(
      order.id,
      {
        status: "failed",
        error: `Chainflip delivered ${destinationAmount}, below locked minimum ${minimum}`,
      },
      "Chainflip delivered below locked minimum",
    );
    return;
  }

  if (quote.chainflip.mode === "eth-usdc-forward") {
    if (!evm) {
      throw new Error("EVM_HOTWALLET_PRIVATE_KEY and ETHEREUM_RPC_URL are required to forward Chainflip ETH USDC to Solana");
    }
    const mayanDestination = quote.chainflip.directDestination
      ? order.destinationAddress
      : env.solanaHotWallet.publicKey.toBase58();
    if (!mayanDestination) {
      throw new Error("Chainflip Mayan forwarding route is missing destination address");
    }
    const mayanQuote = await mayan.fetchSwiftQuoteForRoute({
      fromChain: "ethereum",
      fromToken: CHAINS.ethereum.usdc!,
      toChain: quote.chainflip.directDestination ? getDestinationChain(order, quote) : "solana",
      toToken: quote.chainflip.directDestination ? getDestinationToken(order, quote) : USDC_MINT_ADDRESS,
      amount: destinationAmount,
      destinationAddress: mayanDestination,
      slippageBps: quote.chainflip.mayan?.quote.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
    });
    const lockedMinimum = BigInt(quote.chainflip.directDestination
      ? quote.minDestinationOut ?? quote.chainflip.minSolanaUsdcOut
      : quote.chainflip.minSolanaUsdcOut);
    if (shouldRefundOnSlippage(order) && BigInt(mayanQuote.minReceivedBaseUnits) < lockedMinimum) {
      store.updateOrder(
        order.id,
        {
          status: "failed",
          error: `Mayan forwarding minimum ${mayanQuote.minReceivedBaseUnits} is below locked minimum ${lockedMinimum}`,
        },
        "Chainflip ETH USDC Mayan quote below locked minimum",
      );
      return;
    }

    const mayanTx = await evm.executeMayanSwift(mayanQuote, mayanDestination);
    store.updateOrder(
      order.id,
      {
        solanaMintSignature: mayanTx,
      },
      `Mayan ETH USDC forwarding submitted after Chainflip BTC swap: ${mayanTx}`,
    );
    throw new Error(`Mayan forwarding pending: ${mayanTx}`);
  }

  if (quote.direction === "asset-to-asset" && quote.chainflip.directDestination) {
    store.updateOrder(
      order.id,
      {
        status: "completed",
        destinationAmount,
        withdrawalSignature: chainflipDestinationTx(status) ?? order.sourceTxHash,
      },
      `Chainflip delivered ${destinationAmount} to destination`,
    );
    return;
  }

  store.updateOrder(
    order.id,
    {
      status: "minted",
      destinationAmount,
      solanaMintSignature: chainflipDestinationTx(status) ?? order.sourceTxHash,
    },
    `Chainflip delivered ${destinationAmount} USDC on Solana`,
  );
}

async function processThorchainBridge(order: Order): Promise<void> {
  if (order.funding.type !== "deposit-address" || order.funding.chainId !== "bitcoin") {
    throw new Error("BTC order is missing THORChain deposit funding");
  }
  if (!order.sourceTxHash) {
    throw new Error("BTC order has no source transaction hash");
  }
  const quote = mustGetQuote(order.quoteId);
  if (!quote.thorchain) {
    throw new Error("BTC order is missing THORChain quote metadata");
  }

  if (quote.thorchain.mode === "eth-usdc-fallback" && order.solanaMintSignature) {
    await processThorchainMayanForward(order, quote);
    return;
  }

  const details = await thorchain.fetchTxStatus(order.sourceTxHash);
  const refund = thorchainPlannedRefund(details);
  if (refund) {
    store.updateOrder(order.id, { status: "refunded", error: "THORChain planned a refund for the BTC deposit" }, "THORChain planned a refund");
    return;
  }

  if (quote.thorchain.mode === "direct-destination") {
    if (!order.destinationAddress) {
      throw new Error("THORChain direct order is missing destination address");
    }
    const outTx = thorchainOutTx(details, quote.thorchain.toAsset, order.destinationAddress);
    if (!outTx) throw new Error("THORChain swap pending: waiting for destination outbound");
    const destinationAmount = thorchainAmountToBaseUnits(
      thorchainTxAmount(outTx, quote.thorchain.toAsset),
      quote.destinationTokenDecimals ?? 6,
    );
    const delivered = BigInt(destinationAmount);
    const minimum = BigInt(quote.minDestinationOut ?? "0");
    if (shouldRefundOnSlippage(order) && delivered < minimum) {
      store.updateOrder(
        order.id,
        {
          status: "failed",
          error: `THORChain delivered ${destinationAmount}, below locked minimum ${minimum}`,
        },
        "THORChain delivered below locked minimum",
      );
      return;
    }
    store.updateOrder(
      order.id,
      {
        status: "completed",
        destinationAmount: destinationAmount.toString(),
        withdrawalSignature: outTx.id ?? order.sourceTxHash,
      },
      `THORChain delivered ${destinationAmount} to destination`,
    );
    return;
  }

  if (quote.thorchain.mode === "direct-solana") {
    const outTx = thorchainOutTx(details, THORCHAIN.solanaUsdcAsset, env.solanaHotWallet.publicKey.toBase58());
    if (!outTx) throw new Error("THORChain swap pending: waiting for Solana USDC outbound");
    const destinationAmount = thorchainAmountToBaseUnits(thorchainTxAmount(outTx, THORCHAIN.solanaUsdcAsset), 6);
    store.updateOrder(
      order.id,
      {
        status: "minted",
        destinationAmount,
        solanaMintSignature: outTx.id ?? order.sourceTxHash,
      },
      `THORChain delivered ${destinationAmount} USDC on Solana`,
    );
    return;
  }

  const outTx = thorchainOutTx(details, THORCHAIN.ethUsdcAsset, env.evmHotWalletAddress);
  if (!outTx) throw new Error("THORChain swap pending: waiting for Ethereum USDC outbound");
  if (!evm) {
    throw new Error("EVM_HOTWALLET_PRIVATE_KEY and ETHEREUM_RPC_URL are required to forward THORChain ETH USDC to Solana");
  }
  const ethUsdcAmount = thorchainAmountToBaseUnits(thorchainTxAmount(outTx, THORCHAIN.ethUsdcAsset), 6);
  const mayanQuote = await mayan.fetchSwiftQuoteForRoute({
    fromChain: "ethereum",
    fromToken: CHAINS.ethereum.usdc!,
    toChain: quote.thorchain.directDestination ? getDestinationChain(order, quote) : "solana",
    toToken: quote.thorchain.directDestination ? getDestinationToken(order, quote) : USDC_MINT_ADDRESS,
    amount: ethUsdcAmount,
    destinationAddress: quote.thorchain.directDestination
      ? order.destinationAddress ?? env.solanaHotWallet.publicKey.toBase58()
      : env.solanaHotWallet.publicKey.toBase58(),
    slippageBps: quote.thorchain.mayan?.quote.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
  });
  const lockedMinimum = BigInt(quote.thorchain.directDestination
    ? quote.minDestinationOut ?? quote.thorchain.minSolanaUsdcOut
    : quote.thorchain.minSolanaUsdcOut);
  if (shouldRefundOnSlippage(order) && BigInt(mayanQuote.minReceivedBaseUnits) < lockedMinimum) {
    store.updateOrder(
      order.id,
      {
        status: "failed",
        error: `Mayan forwarding minimum ${mayanQuote.minReceivedBaseUnits} is below locked minimum ${lockedMinimum}`,
      },
      "THORChain fallback Mayan quote below locked minimum",
    );
    return;
  }

  const mayanDestination = quote.thorchain.directDestination
    ? order.destinationAddress ?? env.solanaHotWallet.publicKey.toBase58()
    : env.solanaHotWallet.publicKey.toBase58();
  const mayanTx = await evm.executeMayanSwift(mayanQuote, mayanDestination);
  store.updateOrder(
    order.id,
      {
        solanaMintSignature: mayanTx,
      },
    `Mayan ETH USDC forwarding submitted: ${mayanTx}`,
  );
  throw new Error(`Mayan swap pending: ${mayanTx}`);
}

async function processChainflipMayanForward(order: Order, quote: Quote): Promise<void> {
  if (!order.solanaMintSignature) {
    throw new Error("Chainflip BTC ETH-USDC forward has no Mayan forwarding transaction");
  }
  if (!quote.chainflip) {
    throw new Error("Chainflip BTC order is missing quote metadata");
  }
  const details = await mayan.fetchSwapByTx(order.solanaMintSignature);
  if (mayanSwapFailed(details)) {
    store.updateOrder(order.id, { status: "failed", error: `Mayan forwarding ${details.clientStatus ?? details.status}` }, "Chainflip Mayan forwarding failed");
    return;
  }
  if (!mayanSwapSucceeded(details)) {
    throw new Error(`Mayan forwarding pending: ${details.clientStatus ?? details.status ?? "unknown"}`);
  }

  const destinationAmount = mayanDeliveredBaseUnits(
    details,
    quote.chainflip.directDestination ? quote.destinationTokenDecimals ?? 6 : 6,
  );
  const destinationTx = mayanDestinationTx(details) ?? order.solanaMintSignature;
  const minimum = BigInt(quote.chainflip.directDestination
    ? quote.minDestinationOut ?? quote.chainflip.minSolanaUsdcOut
    : quote.chainflip.minSolanaUsdcOut);
  if (shouldRefundOnSlippage(order) && BigInt(destinationAmount) < minimum) {
    store.updateOrder(
      order.id,
      {
        status: "failed",
        error: `Mayan forwarding delivered ${destinationAmount}, below locked minimum ${minimum}`,
      },
      "Mayan forwarding delivered below locked minimum",
    );
    return;
  }
  if (quote.chainflip.directDestination) {
    store.updateOrder(
      order.id,
      {
        status: "completed",
        destinationAmount,
        withdrawalSignature: destinationTx,
      },
      `Mayan delivered ${destinationAmount} to destination after Chainflip BTC swap`,
    );
    return;
  }
  store.updateOrder(
    order.id,
    {
      status: "minted",
      destinationAmount,
      solanaMintSignature: destinationTx,
    },
    `Mayan delivered ${destinationAmount} USDC on Solana after Chainflip BTC swap`,
  );
}

async function processThorchainMayanForward(order: Order, quote: Quote): Promise<void> {
  if (!order.solanaMintSignature) {
    throw new Error("BTC fallback has no Mayan forwarding transaction");
  }
  const details = await mayan.fetchSwapByTx(order.solanaMintSignature);
  if (mayanSwapFailed(details)) {
    store.updateOrder(order.id, { status: "failed", error: `Mayan forwarding ${details.clientStatus ?? details.status}` }, "Mayan forwarding failed");
    return;
  }
  if (!mayanSwapSucceeded(details)) {
    throw new Error(`Mayan forwarding pending: ${details.clientStatus ?? details.status ?? "unknown"}`);
  }

  const destinationAmount = mayanDeliveredBaseUnits(
    details,
    quote.thorchain?.directDestination ? quote.destinationTokenDecimals ?? 6 : 6,
  );
  const destinationTx = mayanDestinationTx(details) ?? order.solanaMintSignature;
  const minimum = BigInt(quote.thorchain?.directDestination
    ? quote.minDestinationOut ?? quote.thorchain.minSolanaUsdcOut
    : quote.thorchain?.minSolanaUsdcOut ?? "0");
  if (shouldRefundOnSlippage(order) && BigInt(destinationAmount) < minimum) {
    store.updateOrder(
      order.id,
      {
        status: "failed",
        error: `Mayan forwarding delivered ${destinationAmount}, below locked minimum ${minimum}`,
      },
      "Mayan forwarding delivered below locked minimum",
    );
    return;
  }
  if (quote.thorchain?.directDestination) {
    store.updateOrder(
      order.id,
      {
        status: "completed",
        destinationAmount,
        withdrawalSignature: destinationTx,
      },
      `Mayan delivered ${destinationAmount} to destination after THORChain BTC swap`,
    );
    return;
  }
  store.updateOrder(
    order.id,
    {
      status: "minted",
      destinationAmount,
      solanaMintSignature: destinationTx,
    },
    `Mayan delivered ${destinationAmount} USDC on Solana after THORChain BTC swap`,
  );
}

async function executeSwapAndWithdrawal(order: Order): Promise<void> {
  const quote = mustGetQuote(order.quoteId);
  store.updateOrder(order.id, { status: "swapping" }, "starting Jupiter swap");
  const swapInputAmount = getSolanaInputAmount(order);
  const swapInputMint = getSolanaInputMint(order);

  let swap: { signature: string; outAmount: bigint } | null = null;
  if (isWxmrMint(swapInputMint)) {
    swap = { signature: "", outAmount: swapInputAmount };
  } else {
    try {
      swap = await solana.swapTokenToWxmr(
        swapInputMint,
        swapInputAmount,
        executionMinimum(order, BigInt(quote.minWxmrOut)),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.updateOrder(order.id, { status: "refunding", error: message }, `swap failed: ${message}`);
      return;
    }
  }

  const withdrawalAmount = applyBps(swap.outAmount, 10_000 - quote.serviceFeeBps);
  if (shouldRefundOnSlippage(order) && withdrawalAmount < BigInt(quote.minWxmrOut)) {
    store.updateOrder(
      order.id,
      { status: "refunding", swapSignature: swap.signature, error: "executed output below locked minimum" },
      "executed output below locked minimum",
    );
    return;
  }

  store.updateOrder(
    order.id,
    { status: "withdrawing", swapSignature: swap.signature || order.sourceTxHash },
    swap.signature ? `Jupiter swap: ${swap.signature}` : "using deposited XMR-SOL without swap",
  );
  const withdrawal = await solana.requestWithdrawal(withdrawalAmount, order.xmrAddress);
  store.updateOrder(
    order.id,
    {
      status: "completed",
      withdrawalSignature: withdrawal.signature,
      withdrawalPda: withdrawal.withdrawalPda,
    },
    `withdrawal requested: ${withdrawal.signature}`,
  );
}

async function executeSwapAndMayanPayout(order: Order): Promise<void> {
  const quote = mustGetQuote(order.quoteId);
  const outputChain = getDestinationChain(order, quote);
  const outputToken = getDestinationToken(order, quote);
  if (quote.route === "thorchain" && outputChain === "bitcoin") {
    await executeSolanaToBtcPayout(order, quote, deriveReverseDepositOwner(env.solanaHotWallet, order.id), true);
    return;
  }
  if (quote.route === "solana" || outputChain === "solana") {
    await executeSwapAndSolanaPayout(order, quote);
    return;
  }
  if (!quote.mayan) {
    throw new Error("reverse order is missing Mayan quote metadata");
  }
  if (!order.destinationAddress) {
    throw new Error("reverse order is missing destination address");
  }

  store.updateOrder(order.id, { status: "swapping" }, "starting Jupiter wXMR -> USDC swap");
  const owner = deriveReverseDepositOwner(env.solanaHotWallet, order.id);
  const depositedAmount = BigInt(order.destinationAmount ?? order.amount);
  const serviceFee = applyBps(depositedAmount, quote.serviceFeeBps);
  const swapInputAmount = depositedAmount - serviceFee;

  let swap;
  try {
    swap = await solana.swapWxmrToUsdc(
      swapInputAmount,
      executionMinimum(order, BigInt(quote.mayan.minSolanaUsdcOut)),
      owner,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.updateOrder(order.id, { status: "refunding", error: message }, `reverse swap failed before Mayan payout: ${message}`);
    return;
  }

  if (serviceFee > 0n) {
    await solana.transferWxmr(owner, env.solanaHotWallet.publicKey, serviceFee);
  }

  const payoutQuote = await mayan.fetchSwiftQuoteForRoute({
    fromChain: "solana",
    fromToken: USDC_MINT_ADDRESS,
    toChain: outputChain,
    toToken: outputToken,
    amount: swap.outAmount,
    destinationAddress: order.destinationAddress,
    slippageBps: quote.mayan.quote.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
  });
  const minDestinationOut = BigInt(quote.minDestinationOut ?? "0");
  if (shouldRefundOnSlippage(order) && BigInt(payoutQuote.minReceivedBaseUnits) < minDestinationOut) {
    store.updateOrder(
      order.id,
      {
        status: "failed",
        swapSignature: swap.signature,
        error: `Mayan payout minimum ${payoutQuote.minReceivedBaseUnits} is below locked minimum ${minDestinationOut}`,
      },
      "Mayan payout quote below locked minimum",
    );
    return;
  }

  const payout = await solana.executeMayanSwiftFromSolana(payoutQuote, owner, order.destinationAddress);
  store.updateOrder(
    order.id,
    {
      status: "withdrawing",
      swapSignature: swap.signature,
      withdrawalSignature: payout.signature,
    },
    `Mayan payout submitted: ${payout.signature}`,
  );
}

async function executeSwapAndSolanaPayout(order: Order, quote: Quote): Promise<void> {
  if (!order.destinationAddress) {
    throw new Error("reverse order is missing Solana destination address");
  }
  const outputToken = getDestinationToken(order, quote);

  store.updateOrder(order.id, { status: "swapping" }, "starting Jupiter wXMR -> Solana token swap");
  const owner = deriveReverseDepositOwner(env.solanaHotWallet, order.id);
  const depositedAmount = BigInt(order.destinationAmount ?? order.amount);
  const serviceFee = applyBps(depositedAmount, quote.serviceFeeBps);
  const swapInputAmount = depositedAmount - serviceFee;

  let swap: { signature: string; outAmount: bigint } | null = null;
  if (isWxmrMint(outputToken)) {
    swap = { signature: "", outAmount: swapInputAmount };
  } else {
    try {
      swap = await solana.swapWxmrToToken(
        outputToken,
        swapInputAmount,
        executionMinimum(order, BigInt(quote.minDestinationOut ?? "0")),
        owner,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.updateOrder(order.id, { status: "refunding", error: message }, `reverse Solana swap failed: ${message}`);
      return;
    }
  }

  if (serviceFee > 0n) {
    await solana.transferWxmr(owner, env.solanaHotWallet.publicKey, serviceFee);
  }

  const payoutSignature = await solana.transferToken(
    outputToken,
    owner,
    new PublicKey(order.destinationAddress),
    swap.outAmount,
  );
  store.updateOrder(
    order.id,
    {
      status: "completed",
      destinationAmount: swap.outAmount.toString(),
      swapSignature: swap.signature || order.solanaMintSignature,
      withdrawalSignature: payoutSignature,
    },
    `Solana payout delivered ${swap.outAmount}: ${payoutSignature}`,
  );
}

async function executeSolanaToBtcPayout(
  order: Order,
  quote: Quote,
  signer: Keypair,
  deductServiceFee: boolean,
): Promise<void> {
  if (!order.destinationAddress) {
    throw new Error("BTC payout is missing destination address");
  }
  if (!quote.thorchain) {
    throw new Error("BTC payout is missing THORChain quote metadata");
  }
  if (!env.evmHotWalletAddress || !evm) {
    throw new Error("EVM_HOTWALLET_PRIVATE_KEY and ETHEREUM_RPC_URL are required for BTC output routes");
  }

  store.updateOrder(order.id, { status: "swapping" }, "starting Solana -> BTC payout");
  const inputMint = deductServiceFee ? WXMR_MINT_ADDRESS : getSolanaInputMint(order);
  const depositedAmount = deductServiceFee
    ? BigInt(order.destinationAmount ?? order.amount)
    : getSolanaInputAmount(order);
  const serviceFee = deductServiceFee ? applyBps(depositedAmount, quote.serviceFeeBps) : 0n;
  const swapInputAmount = depositedAmount - serviceFee;
  if (swapInputAmount <= 0n) {
    throw new Error("BTC payout amount is zero after fees");
  }

  let usdcAmount = swapInputAmount;
  let swapSignature = order.swapSignature;
  if (!sameToken(inputMint, USDC_MINT_ADDRESS)) {
    try {
      const swap = deductServiceFee
        ? await solana.swapWxmrToUsdc(
          swapInputAmount,
          executionMinimum(order, BigInt(quote.mayan?.minSolanaUsdcOut ?? "0")),
          signer,
        )
        : await solana.swapTokenToToken(
          inputMint,
          USDC_MINT_ADDRESS,
          swapInputAmount,
          executionMinimum(order, BigInt(quote.mayan?.minSolanaUsdcOut ?? "0")),
        );
      usdcAmount = swap.outAmount;
      swapSignature = swap.signature;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.updateOrder(order.id, { status: deductServiceFee ? "refunding" : "failed", error: message }, `BTC payout Solana swap failed: ${message}`);
      return;
    }
  }

  if (serviceFee > 0n) {
    await solana.transferWxmr(signer, env.solanaHotWallet.publicKey, serviceFee);
  }

  const mayanQuote = await mayan.fetchSwiftQuoteForRoute({
    fromChain: "solana",
    fromToken: USDC_MINT_ADDRESS,
    toChain: "ethereum",
    toToken: CHAINS.ethereum.usdc!,
    amount: usdcAmount,
    destinationAddress: env.evmHotWalletAddress,
    slippageBps: quote.thorchain.slippageBps ?? quote.thorchain.mayan?.quote.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
  });
  const lockedEthUsdcMinimum = BigInt(quote.thorchain.minSolanaUsdcOut);
  if (shouldRefundOnSlippage(order) && BigInt(mayanQuote.minReceivedBaseUnits) < lockedEthUsdcMinimum) {
    store.updateOrder(
      order.id,
      {
        status: "failed",
        swapSignature,
        error: `Mayan ETH USDC funding minimum ${mayanQuote.minReceivedBaseUnits} is below locked minimum ${lockedEthUsdcMinimum}`,
      },
      "BTC payout Mayan funding quote below locked minimum",
    );
    return;
  }

  const payout = await solana.executeMayanSwiftFromSolana(mayanQuote, signer, env.evmHotWalletAddress);
  store.updateOrder(
    order.id,
    {
      status: "withdrawing",
      swapSignature,
      withdrawalSignature: payout.signature,
    },
    `Mayan ETH USDC funding submitted for BTC payout: ${payout.signature}`,
  );
}

async function executeAssetPayout(order: Order): Promise<void> {
  const quote = mustGetQuote(order.quoteId);
  const outputChain = getDestinationChain(order, quote);
  const outputToken = getDestinationToken(order, quote);
  if (!order.destinationAddress) {
    throw new Error("asset order is missing destination address");
  }

  if (quote.route === "thorchain" && outputChain === "bitcoin") {
    await executeSolanaToBtcPayout(order, quote, env.solanaHotWallet, false);
    return;
  }

  if (outputChain === "solana") {
    await executeSolanaAssetPayout(order, quote, outputToken);
    return;
  }

  await executeMayanAssetPayout(order, quote, outputChain, outputToken);
}

async function executeSolanaAssetPayout(order: Order, quote: Quote, outputToken: string): Promise<void> {
  const inputMint = getSolanaInputMint(order);
  const inputAmount = getSolanaInputAmount(order);
  const minimum = BigInt(quote.minDestinationOut ?? "0");

  store.updateOrder(order.id, { status: "swapping" }, "starting Solana asset payout");

  if (inputMint.toLowerCase() === outputToken.toLowerCase()) {
    const payoutSignature = await solana.transferToken(
      outputToken,
      env.solanaHotWallet,
      new PublicKey(order.destinationAddress!),
      inputAmount,
    );
    store.updateOrder(
      order.id,
      {
        status: "completed",
        destinationAmount: inputAmount.toString(),
        withdrawalSignature: payoutSignature,
      },
      `Solana payout delivered ${inputAmount}: ${payoutSignature}`,
    );
    return;
  }

  let swap;
  try {
    swap = await solana.swapTokenToToken(
      inputMint,
      outputToken,
      inputAmount,
      executionMinimum(order, minimum),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.updateOrder(order.id, { status: "refunding", error: message }, `asset payout swap failed: ${message}`);
    return;
  }

  const payoutSignature = await solana.transferToken(
    outputToken,
    env.solanaHotWallet,
    new PublicKey(order.destinationAddress!),
    swap.outAmount,
  );
  store.updateOrder(
    order.id,
    {
      status: "completed",
      destinationAmount: swap.outAmount.toString(),
      swapSignature: swap.signature,
      withdrawalSignature: payoutSignature,
    },
    `Solana payout delivered ${swap.outAmount}: ${payoutSignature}`,
  );
}

async function executeMayanAssetPayout(
  order: Order,
  quote: Quote,
  outputChain: Exclude<Order["destinationChain"], undefined>,
  outputToken: string,
): Promise<void> {
  const inputMint = getSolanaInputMint(order);
  const inputAmount = getSolanaInputAmount(order);
  store.updateOrder(order.id, { status: "swapping" }, "starting Mayan asset payout");

  const payoutQuote = await mayan.fetchSwiftQuoteForRoute({
    fromChain: "solana",
    fromToken: inputMint,
    toChain: outputChain,
    toToken: outputToken,
    amount: inputAmount,
    destinationAddress: order.destinationAddress!,
    slippageBps: quote.mayan?.quote.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
  });
  const minDestinationOut = BigInt(quote.minDestinationOut ?? "0");
  if (shouldRefundOnSlippage(order) && BigInt(payoutQuote.minReceivedBaseUnits) < minDestinationOut) {
    store.updateOrder(
      order.id,
      {
        status: "failed",
        error: `Mayan payout minimum ${payoutQuote.minReceivedBaseUnits} is below locked minimum ${minDestinationOut}`,
      },
      "Mayan asset payout quote below locked minimum",
    );
    return;
  }

  const payout = await solana.executeMayanSwiftFromSolana(payoutQuote, env.solanaHotWallet, order.destinationAddress!);
  store.updateOrder(
    order.id,
    {
      status: "withdrawing",
      withdrawalSignature: payout.signature,
    },
    `Mayan asset payout submitted: ${payout.signature}`,
  );
}

async function processReverseMayanSettlement(order: Order): Promise<void> {
  const quote = mustGetQuote(order.quoteId);
  if (quote.route === "thorchain" && getDestinationChain(order, quote) === "bitcoin") {
    await processThorchainBtcSettlement(order, quote);
    return;
  }
  if (!order.withdrawalSignature) {
    throw new Error("reverse order has no Mayan payout transaction");
  }
  const details = await mayan.fetchSwapByTx(order.withdrawalSignature);
  if (mayanSwapFailed(details)) {
    store.updateOrder(order.id, { status: "failed", error: `Mayan payout ${details.clientStatus ?? details.status}` }, "Mayan payout failed");
    return;
  }
  if (!mayanSwapSucceeded(details)) {
    throw new Error(`Mayan payout pending: ${details.clientStatus ?? details.status ?? "unknown"}`);
  }

  const delivered = mayanDeliveredBaseUnits(details, order.destinationTokenDecimals ?? 6);
  const destinationTx = mayanDestinationTx(details);
  store.updateOrder(
    order.id,
    {
      status: "completed",
      destinationAmount: delivered,
      sourceTxHash: destinationTx ?? order.sourceTxHash,
    },
    `Mayan payout delivered ${delivered}${destinationTx ? `: ${destinationTx}` : ""}`,
  );
}

async function processThorchainBtcSettlement(order: Order, quote: Quote): Promise<void> {
  if (!order.destinationAddress) {
    throw new Error("BTC payout is missing destination address");
  }
  if (!quote.thorchain) {
    throw new Error("BTC payout is missing THORChain quote metadata");
  }
  if (!order.withdrawalSignature) {
    throw new Error("BTC payout has no Mayan or THORChain transaction");
  }
  if (!evm || !env.evmHotWalletAddress) {
    throw new Error("EVM_HOTWALLET_PRIVATE_KEY and ETHEREUM_RPC_URL are required for BTC output routes");
  }

  if (!order.sourceTxHash) {
    const details = await mayan.fetchSwapByTx(order.withdrawalSignature);
    if (mayanSwapFailed(details)) {
      store.updateOrder(order.id, { status: "failed", error: `Mayan ETH USDC funding ${details.clientStatus ?? details.status}` }, "BTC payout Mayan funding failed");
      return;
    }
    if (!mayanSwapSucceeded(details)) {
      throw new Error(`BTC payout Mayan funding pending: ${details.clientStatus ?? details.status ?? "unknown"}`);
    }

    const ethUsdcAmount = mayanDeliveredBaseUnits(details, USDC_DECIMALS);
    const mayanTx = mayanDestinationTx(details) ?? order.withdrawalSignature;
    const thorchainQuote = await thorchain.fetchSwapQuote({
      fromAsset: THORCHAIN.ethUsdcAsset,
      toAsset: THORCHAIN.btcAsset,
      amount: ethUsdcAmount,
      destination: order.destinationAddress,
    });
    const estimatedBtcOut = thorchainAmountToBaseUnits(thorchainQuote.expected_amount_out, BTC_DECIMALS);
    const minBtcOut = applyBps(BigInt(estimatedBtcOut), 10_000 - (quote.thorchain.slippageBps ?? DEFAULT_SLIPPAGE_BPS));
    const lockedMinimum = BigInt(quote.minDestinationOut ?? "0");
    if (shouldRefundOnSlippage(order) && minBtcOut < lockedMinimum) {
      store.updateOrder(
        order.id,
        {
          status: "failed",
          sourceTxHash: mayanTx,
          destinationAmount: ethUsdcAmount,
          error: `THORChain BTC quote minimum ${minBtcOut} is below locked minimum ${lockedMinimum}`,
        },
        "BTC payout THORChain quote below locked minimum",
      );
      return;
    }
    if (!thorchainQuote.router) {
      throw new Error("THORChain quote is missing router address");
    }

    const txHash = await evm.executeThorchainErc20Swap({
      chainId: "ethereum",
      token: CHAINS.ethereum.usdc! as Address,
      router: thorchainQuote.router as Address,
      vault: thorchainQuote.inbound_address! as Address,
      amount: BigInt(ethUsdcAmount),
      memo: thorchainQuote.memo!,
      expiry: BigInt(thorchainQuote.expiry),
      onSigned: (hash) => {
        store.updateOrder(
          order.id,
          {
            sourceTxHash: mayanTx,
            destinationAmount: ethUsdcAmount,
            withdrawalSignature: hash,
          },
          `THORChain BTC funding signed: ${hash}`,
        );
      },
    });
    store.addEvent(order.id, order.status, `THORChain BTC funding submitted: ${txHash}`);
    throw new Error(`THORChain BTC swap pending: ${txHash}`);
  }

  const receiptStatus = await evm.getTransactionReceiptStatus("ethereum", order.withdrawalSignature as Hex).catch(() => null);
  if (receiptStatus === "reverted") {
    store.updateOrder(order.id, { status: "failed", error: `THORChain funding transaction reverted: ${order.withdrawalSignature}` }, "THORChain BTC funding reverted");
    return;
  }
  const details = await thorchain.fetchTxStatus(order.withdrawalSignature).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`THORChain BTC swap pending: ${message}`);
  });
  const refund = thorchainPlannedRefund(details);
  if (refund) {
    store.updateOrder(order.id, { status: "failed", error: "THORChain planned a refund for the BTC payout" }, "THORChain planned a BTC payout refund");
    return;
  }
  const outTx = thorchainOutTx(details, THORCHAIN.btcAsset, order.destinationAddress);
  if (!outTx) throw new Error("THORChain BTC swap pending: waiting for Bitcoin outbound");
  const destinationAmount = thorchainAmountToBaseUnits(thorchainTxAmount(outTx, THORCHAIN.btcAsset), BTC_DECIMALS);
  const minimum = BigInt(quote.minDestinationOut ?? "0");
  if (shouldRefundOnSlippage(order) && BigInt(destinationAmount) < minimum) {
    store.updateOrder(
      order.id,
      {
        status: "failed",
        error: `THORChain delivered ${destinationAmount} BTC base units, below locked minimum ${minimum}`,
      },
      "THORChain BTC payout below locked minimum",
    );
    return;
  }
  store.updateOrder(
    order.id,
    {
      status: "completed",
      destinationAmount,
      withdrawalSignature: outTx.id ?? order.withdrawalSignature,
    },
    `THORChain delivered ${destinationAmount} BTC base units`,
  );
}

async function refund(order: Order): Promise<void> {
  if (!order.refundAddress) {
    if (order.funding.type === "deposit-address") {
      throw new Error(`refund pending: no refund address on file — supply one via POST /orders/${order.id}/refund-address`);
    }
    throw new Error("refund required but no Solana refund address was provided");
  }
  if (order.funding.type === "deposit-address" && CHAINS[order.funding.chainId].kind === "evm") {
    // The failure happened after Mayan delivered: the funds are USDC at the
    // Solana hot wallet, but the order's refund address is on the EVM source
    // chain. There is no automated cross-chain refund path yet.
    store.updateOrder(
      order.id,
      {
        status: "failed",
        error: `manual refund required: ${order.destinationAmount ?? "the delivered"} USDC base units are at the Solana hot wallet, but the refund address ${order.refundAddress} is on ${order.funding.chainId}`,
      },
      "manual refund required (funds on Solana, refund address on the source chain)",
    );
    return;
  }
  if (order.funding.type === "deposit-address" && order.funding.chainId === "solana" && order.funding.native) {
    // The sweep unwrapped the deposit into raw lamports at the hot wallet, so
    // the refund must be a native transfer, not a wSOL SPL transfer.
    const signature = await solana.refundNative(getSolanaInputAmount(order), order.refundAddress);
    store.updateOrder(order.id, { status: "refunded" }, `native SOL refunded: ${signature}`);
    return;
  }
  const signature = await solana.refundToken(getSolanaInputMint(order), getSolanaInputAmount(order), order.refundAddress);
  store.updateOrder(order.id, { status: "refunded" }, `funded token refunded on Solana: ${signature}`);
}

async function refundReverse(order: Order): Promise<void> {
  const owner = deriveReverseDepositOwner(env.solanaHotWallet, order.id);
  const refundAmount = BigInt(order.destinationAmount ?? order.amount);
  const withdrawal = await solana.requestWithdrawalFromSigner(owner, refundAmount, order.xmrAddress);
  store.updateOrder(
    order.id,
    {
      status: "refunded",
      withdrawalSignature: withdrawal.signature,
      withdrawalPda: withdrawal.withdrawalPda,
    },
    `reverse order refunded to native XMR: ${withdrawal.signature}`,
  );
}

function getSolanaInputAmount(order: Order): bigint {
  if (order.funding.type === "mayan-swift") {
    if (!order.destinationAmount) {
      throw new Error("Mayan order has no delivered Solana USDC amount");
    }
    return BigInt(order.destinationAmount);
  }
  if (order.funding.type === "solana-transfer") {
    return BigInt(order.destinationAmount ?? order.funding.amount);
  }
  if (order.funding.type === "deposit-address" && order.funding.chainId === "solana") {
    // destinationAmount records what the sweep actually moved to the hot wallet.
    if (!order.destinationAmount) {
      throw new Error("Solana address order has no swept deposit amount");
    }
    return BigInt(order.destinationAmount);
  }
  if (order.funding.type === "deposit-address" && order.funding.chainId !== "monero") {
    // BTC and EVM address deposits both arrive as USDC on Solana.
    if (!order.destinationAmount) {
      throw new Error("order has no delivered Solana USDC amount");
    }
    return BigInt(order.destinationAmount);
  }
  return BigInt(order.amount);
}

function getSolanaInputMint(order: Order): string {
  if (order.funding.type === "mayan-swift") {
    return USDC_MINT_ADDRESS;
  }
  if (order.funding.type === "solana-transfer") {
    return order.funding.mint;
  }
  if (order.funding.type === "deposit-address" && order.funding.chainId === "solana") {
    return order.sourceToken;
  }
  if (order.funding.type === "deposit-address" && order.funding.chainId !== "monero") {
    return USDC_MINT_ADDRESS;
  }
  return order.sourceToken;
}

function getDestinationChain(order: Order, quote: Quote): SourceChainId {
  return quote.destinationChain ?? order.destinationChain ?? order.sourceChain;
}

function getDestinationToken(order: Order, quote: Quote): string {
  return quote.destinationToken ?? order.destinationToken ?? order.sourceToken;
}

function executionMinimum(order: Order, lockedMinimum: bigint): bigint {
  return shouldRefundOnSlippage(order) ? lockedMinimum : 0n;
}

function shouldRefundOnSlippage(order: Order): boolean {
  return order.executionPolicy !== "execute-anyway";
}

function isWxmrMint(value: string | undefined): boolean {
  return Boolean(value && value.toLowerCase() === WXMR_MINT_ADDRESS.toLowerCase());
}

function sameToken(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function mustGetQuote(quoteId: string): Quote {
  const quote = store.getQuote(quoteId);
  if (!quote) {
    throw new Error(`quote ${quoteId} not found`);
  }
  return quote;
}

function applyBps(amount: bigint, bps: number): bigint {
  return (amount * BigInt(bps)) / 10_000n;
}

function mergeDepositFunding(
  funding: DepositAddressFunding,
  patch: Partial<DepositAddressFunding>,
): DepositAddressFunding {
  return { ...funding, ...patch };
}

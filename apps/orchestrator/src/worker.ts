import { setTimeout as sleep } from "node:timers/promises";
import { Connection, PublicKey } from "@solana/web3.js";
import { privateKeyToAccount } from "viem/accounts";
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
import { EvmExecutor } from "./chain/evm.js";
import { SolanaExecutor } from "./chain/solana.js";
import { deriveReverseDepositOwner } from "./reverse.js";

const env = loadEnv();
const store = new Store(env.dbPath);
const connection = new Connection(env.solanaRpcUrl, "confirmed");
const mayan = new MayanClient({ apiKey: env.mayanApiKey });
const chainflip = new ChainflipClient({ backendUrl: env.chainflipBackendUrl });
const thorchain = new ThorchainClient({ thornodeUrl: env.thornodeUrl, clientId: env.thornodeClientId });
const evm = env.evmHotWalletPrivateKey && env.ethereumRpcUrl
  ? new EvmExecutor(privateKeyToAccount(env.evmHotWalletPrivateKey), env.ethereumRpcUrl, env.mayanApiKey)
  : null;
const solana = new SolanaExecutor(connection, env.solanaHotWallet, env.bridgeProgramId, env.jupiterApiKey, env.mayanApiKey);
const DEFAULT_SLIPPAGE_BPS = 200;

let shuttingDown = false;
process.on("SIGINT", () => {
  shuttingDown = true;
});
process.on("SIGTERM", () => {
  shuttingDown = true;
});

while (!shuttingDown) {
  await tick().catch((error) => {
    console.error("worker tick failed", error);
  });
  await sleep(3_000);
}

async function tick(): Promise<void> {
  const orders = store.listOrdersByStatus(["awaiting_deposit", "bridging", "minted", "withdrawing", "refunding"], 25);
  for (const order of orders) {
    if (Date.parse(order.expiresAt) <= Date.now() && order.status === "awaiting_deposit") {
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

async function processOrder(order: Order): Promise<void> {
  if (order.status === "awaiting_deposit" && order.direction === "xmr-to-mayan") {
    await processMoneroDeposit(order);
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
    } else {
      await refund(order);
    }
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
  if (order.funding.type !== "mayan-swift") {
    throw new Error("bridging order is missing Mayan Swift funding");
  }
  if (!order.sourceTxHash) {
    throw new Error("Mayan order has no source transaction hash");
  }

  const details = await mayan.fetchSwapByTx(order.sourceTxHash);
  if (mayanSwapFailed(details)) {
    store.updateOrder(order.id, { status: "failed", error: `Mayan swap ${details.clientStatus ?? details.status}` }, "Mayan swap failed");
    return;
  }
  if (!mayanSwapSucceeded(details)) {
    throw new Error(`Mayan swap pending: ${details.clientStatus ?? details.status ?? "unknown"}`);
  }

  const quote = mustGetQuote(order.quoteId);
  const destinationAmount = mayanDeliveredBaseUnits(details, order.funding.mayanQuote.toToken.decimals ?? 6);
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

async function executeAssetPayout(order: Order): Promise<void> {
  const quote = mustGetQuote(order.quoteId);
  const outputChain = getDestinationChain(order, quote);
  const outputToken = getDestinationToken(order, quote);
  if (!order.destinationAddress) {
    throw new Error("asset order is missing destination address");
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

async function refund(order: Order): Promise<void> {
  if (!order.refundAddress) {
    throw new Error("refund required but no Solana refund address was provided");
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
  if (order.funding.type === "deposit-address" && order.funding.chainId === "bitcoin") {
    if (!order.destinationAmount) {
      throw new Error("BTC order has no delivered Solana USDC amount");
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
  if (order.funding.type === "deposit-address" && order.funding.chainId === "bitcoin") {
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

function requiresSolanaHotWalletPayout(quote: Quote): boolean {
  return quote.direction === "asset-to-asset" &&
    quote.sourceChain !== "solana" &&
    quote.destinationChain === "solana" &&
    isWxmrMint(quote.destinationToken);
}

function isWxmrMint(value: string | undefined): boolean {
  return Boolean(value && value.toLowerCase() === WXMR_MINT_ADDRESS.toLowerCase());
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

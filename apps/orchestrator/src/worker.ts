import { setTimeout as sleep } from "node:timers/promises";
import { Connection } from "@solana/web3.js";
import { type Order, type Quote } from "@wxmr/core";
import { loadEnv } from "./env.js";
import { Store } from "./db.js";
import { CctpProvider } from "./providers/cctp.js";
import { SolanaExecutor } from "./chain/solana.js";

const env = loadEnv();
const store = new Store(env.dbPath);
const connection = new Connection(env.solanaRpcUrl, "confirmed");
const cctp = new CctpProvider(connection, env.solanaHotWallet, env.hotWalletUsdcAta, env.circleAttestationUrl);
const solana = new SolanaExecutor(connection, env.solanaHotWallet, env.bridgeProgramId, env.jupiterApiKey);

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
  const orders = store.listOrdersByStatus(["awaiting_deposit", "attesting", "minted", "refunding"], 25);
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
  if (order.status === "attesting") {
    const attestation = await cctp.fetchAttestation(order);
    const signature = await cctp.receiveMessage(order, attestation.message, attestation.attestation);
    store.updateOrder(
      order.id,
      {
        status: "minted",
        cctpMessage: attestation.message,
        cctpAttestation: attestation.attestation,
        solanaMintSignature: signature,
      },
      `CCTP minted on Solana: ${signature}`,
    );
    return;
  }

  if (order.status === "minted") {
    await executeSwapAndWithdrawal(order);
    return;
  }

  if (order.status === "refunding") {
    await refund(order);
  }
}

async function executeSwapAndWithdrawal(order: Order): Promise<void> {
  const quote = mustGetQuote(order.quoteId);
  store.updateOrder(order.id, { status: "swapping" }, "starting Jupiter swap");

  let swap;
  try {
    swap = await solana.swapUsdcToWxmr(BigInt(order.amount), BigInt(quote.minWxmrOut));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.updateOrder(order.id, { status: "refunding", error: message }, `swap failed: ${message}`);
    return;
  }

  const withdrawalAmount = applyBps(swap.outAmount, 10_000 - quote.serviceFeeBps);
  if (withdrawalAmount < BigInt(quote.minWxmrOut)) {
    store.updateOrder(
      order.id,
      { status: "refunding", swapSignature: swap.signature, error: "executed output below locked minimum" },
      "executed output below locked minimum",
    );
    return;
  }

  store.updateOrder(order.id, { status: "withdrawing", swapSignature: swap.signature }, `Jupiter swap: ${swap.signature}`);
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

async function refund(order: Order): Promise<void> {
  if (!order.refundAddress) {
    throw new Error("refund required but no Solana refund address was provided");
  }
  const signature = await solana.refundUsdc(BigInt(order.amount), order.refundAddress);
  store.updateOrder(order.id, { status: "refunded" }, `USDC refunded on Solana: ${signature}`);
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

import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createSwapService } from "../src/lib/jupiter-swap-server";
import { formatSwapAmount, parseSwapAmount, SWAP_FEE_ACCOUNT, SWAP_REFERRAL_ACCOUNT, SWAP_TOKENS } from "../src/lib/jupiter-swap";

const params = () => new URLSearchParams({ side: "buy", token: "SOL", amount: "100000000", slippageBps: "50" });
const fixture = () => ({ inputMint: SWAP_TOKENS.SOL.mint, outputMint: SWAP_TOKENS.wXMR.mint,
  inAmount: "100000000", outAmount: "1000000000000", otherAmountThreshold: "995000000000",
  swapMode: "ExactIn", slippageBps: 50, priceImpactPct: "0.01", platformFee: { feeBps: 50, amount: "5000000000" },
  routePlan: [{ percent: 100 }] });

test("swap amounts retain exact token precision and reject rounding, overflow, and invalid amounts", () => {
  assert.equal(parseSwapAmount("0.000000000001", 12), "1");
  assert.equal(parseSwapAmount(".1", 9), "100000000");
  assert.equal(parseSwapAmount("18446744.073709551615", 12), "18446744073709551615");
  for (const text of ["0", "-1", "NaN", "1e9", "0.0000001", "18446744073709551616", "", "."]) {
    assert.equal(parseSwapAmount(text, 6), null);
  }
  assert.equal(formatSwapAmount("1000000000001", 12), "1.000000000001");
  assert.equal(SWAP_REFERRAL_ACCOUNT, "36rUjmrYc16eBpCCGG2t6oeiEmi1GHjeLTDQ7i8JUxAW");
  assert.equal(SWAP_FEE_ACCOUNT, "BVQREgTvRZcQmv1rwfBTUkR4JhiAdUM3zHCFaPKJB6E7");
});

test("quotes use the private API key, exact amount, and fixed fee", async () => {
  const service = createSwapService({ apiKey: () => "test-key", fetchImpl: async (url, init) => {
    const query = new URL(String(url)).searchParams;
    assert.equal(query.get("platformFeeBps"), "50");
    assert.equal(query.get("amount"), "100000000");
    assert.equal((init?.headers as Record<string, string>)["x-api-key"], "test-key");
    return Response.json(fixture());
  } });
  const quote = await service.quote(params());
  assert.equal(quote.feeAccount, SWAP_FEE_ACCOUNT);
  assert.equal(quote.referralAccount, SWAP_REFERRAL_ACCOUNT);
  assert.equal(quote.feeBps, 50);
  assert.equal(JSON.stringify(quote).includes("test-key"), false);
});

test("invalid pairs, amount overflow, and excessive slippage never call Jupiter", async () => {
  const service = createSwapService({ fetchImpl: async () => { throw new Error("Unexpected request"); } });
  for (const [key, value] of [["side", "other"], ["token", "OTHER"], ["amount", "18446744073709551616"], ["amount", "0"], ["slippageBps", "1000"]]) {
    const query = params(); query.set(key, value);
    await assert.rejects(service.quote(query), /Invalid swap/);
  }
});

test("missing fees, changed amount, zero fee amounts, and weakened minimum output fail closed", async () => {
  for (const change of [{ platformFee: null }, { inAmount: "1" }, { platformFee: { feeBps: 0, amount: "0" } },
    { platformFee: { feeBps: 50, amount: "0" } }, { otherAmountThreshold: "1" }]) {
    const service = createSwapService({ apiKey: () => "test-key", fetchImpl: async () => Response.json({ ...fixture(), ...change }) });
    await assert.rejects(service.quote(params()), /invalid quote|omitted/);
  }
});

test("a build uses the saved quote, pins the fee account, and cannot be repeated", async () => {
  let time = 1000;
  const wallet = Keypair.generate().publicKey;
  const instruction = new TransactionInstruction({ programId: new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"),
    keys: [{ pubkey: new PublicKey(SWAP_FEE_ACCOUNT), isSigner: false, isWritable: true }], data: Buffer.alloc(0) });
  const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: wallet,
    recentBlockhash: PublicKey.default.toBase58(), instructions: [instruction] }).compileToV0Message());
  const service = createSwapService({ now: () => time, apiKey: () => "test-key", fetchImpl: async (url, init) => {
    if (String(url).includes("/quote?")) return Response.json(fixture());
    const body = JSON.parse(String(init?.body));
    assert.equal(body.feeAccount, SWAP_FEE_ACCOUNT);
    assert.equal(body.quoteResponse.platformFee.feeBps, 50);
    assert.equal(body.prioritizationFeeLamports.priorityLevelWithMaxLamports.maxLamports, 100000);
    assert.equal(body.dynamicSlippage, undefined);
    return Response.json({ swapTransaction: Buffer.from(transaction.serialize()).toString("base64"), lastValidBlockHeight: 100, simulationError: null });
  } });
  const quote = await service.quote(params());
  time += 1500;
  const result = await service.build(quote.id, wallet.toBase58());
  assert.equal(result.referralAccount, SWAP_REFERRAL_ACCOUNT);
  await assert.rejects(service.build(quote.id, wallet.toBase58()), /expired/);
});

test("unknown and expired quotes never build, and upstream simulations cannot be bypassed", async () => {
  let time = 1000;
  let builds = 0;
  const wallet = Keypair.generate().publicKey.toBase58();
  const service = createSwapService({ now: () => time, apiKey: () => "test-key", fetchImpl: async (url) => {
    if (String(url).includes("/quote?")) return Response.json(fixture());
    builds++; return Response.json({ simulationError: { InstructionError: [1, "error"] } });
  } });
  await assert.rejects(service.build("client-invented-quote", wallet), /expired/);
  const old = await service.quote(params()); time += 31000;
  await assert.rejects(service.build(old.id, wallet), /expired/);
  assert.equal(builds, 0);
  const fresh = await service.quote(params()); time += 1500;
  await assert.rejects(service.build(fresh.id, wallet), /simulated/);
  assert.equal(builds, 1);
});

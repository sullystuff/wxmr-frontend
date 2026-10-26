import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createJupiterSwapClient, JupiterApiError, JupiterSimulationError } from "../src/lib/jupiter-swap-client";
import { formatSwapAmount, parseSwapAmount, SWAP_FEE_ACCOUNT, SWAP_REFERRAL_ACCOUNT, SWAP_TOKENS } from "../src/lib/jupiter-swap";

const fixture = () => ({ inputMint: SWAP_TOKENS.SOL.mint, outputMint: SWAP_TOKENS.wXMR.mint,
  inAmount: "100000000", outAmount: "1000000000000", otherAmountThreshold: "995000000000",
  swapMode: "ExactIn", slippageBps: 50, priceImpactPct: "0.01", platformFee: { feeBps: 50, amount: "5000000000" },
  routePlan: [{ percent: 100 }] });

test("amounts retain exact token precision and reject rounding, overflow, and invalid input", () => {
  assert.equal(parseSwapAmount("0.000000000001", 12), "1");
  assert.equal(parseSwapAmount(".1", 9), "100000000");
  assert.equal(parseSwapAmount("18446744.073709551615", 12), "18446744073709551615");
  for (const text of ["0", "-1", "NaN", "1e9", "0.0000001", "18446744073709551616", "", "."]) assert.equal(parseSwapAmount(text, 6), null);
  assert.equal(formatSwapAmount("1000000000001", 12), "1.000000000001");
  assert.equal(formatSwapAmount("123", 0), "123");
  assert.equal(SWAP_FEE_ACCOUNT, "BVQREgTvRZcQmv1rwfBTUkR4JhiAdUM3zHCFaPKJB6E7");
});

test("browser quotes call Jupiter directly with fixed protection and referral fee, without a server key", async () => {
  const client = createJupiterSwapClient({ apiKey: () => "", fetchImpl: async (url, init) => {
    const request = new URL(String(url));
    assert.equal(request.origin, "https://api.jup.ag");
    assert.equal(request.searchParams.get("platformFeeBps"), "50");
    assert.equal(request.searchParams.get("slippageBps"), "50");
    assert.equal(request.searchParams.get("amount"), "100000000");
    assert.equal((init?.headers as Record<string, string>)["x-api-key"], undefined);
    assert.equal(init?.referrerPolicy, "no-referrer");
    return Response.json(fixture());
  } });
  const quote = await client.quote("buy", SWAP_TOKENS.SOL, "100000000");
  assert.equal(quote.feeAccount, SWAP_FEE_ACCOUNT);
  assert.equal(quote.referralAccount, SWAP_REFERRAL_ACCOUNT);
});

test("fee omission, amount changes, and weakened output minimums fail closed", async () => {
  for (const change of [{ platformFee: null }, { inAmount: "1" }, { platformFee: { feeBps: 0, amount: "0" } },
    { platformFee: { feeBps: 50, amount: "0" } }, { otherAmountThreshold: "1" }]) {
    const client = createJupiterSwapClient({ fetchImpl: async () => Response.json({ ...fixture(), ...change }) });
    await assert.rejects(client.quote("buy", SWAP_TOKENS.SOL, "100000000"), /valid price/);
  }
});

test("build pins the initialized wXMR referral account for both directions and builds once", async () => {
  for (const side of ["buy", "sell"] as const) {
    let time = 1000;
    const wallet = Keypair.generate().publicKey;
    const instruction = new TransactionInstruction({ programId: new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"),
      keys: [{ pubkey: new PublicKey(SWAP_FEE_ACCOUNT), isSigner: false, isWritable: true }], data: Buffer.alloc(0) });
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: wallet, recentBlockhash: PublicKey.default.toBase58(), instructions: [instruction] }).compileToV0Message());
    const client = createJupiterSwapClient({ now: () => time, fetchImpl: async (url, init) => {
      if (String(url).includes("/quote?")) {
        const route = fixture();
        if (side === "sell") { route.inputMint = SWAP_TOKENS.wXMR.mint; route.outputMint = SWAP_TOKENS.SOL.mint; }
        return Response.json(route);
      }
      const body = JSON.parse(String(init?.body));
      assert.equal(body.feeAccount, SWAP_FEE_ACCOUNT);
      assert.equal(body.quoteResponse.platformFee.feeBps, 50);
      assert.equal(body.dynamicSlippage, undefined);
      assert.equal(body.prioritizationFeeLamports.priorityLevelWithMaxLamports.maxLamports, 100000);
      return Response.json({ swapTransaction: Buffer.from(tx.serialize()).toString("base64"), lastValidBlockHeight: 100, simulationError: null });
    } });
    const quote = await client.quote(side, SWAP_TOKENS.SOL, "100000000"); time += 2500;
    const result = await client.build(quote, wallet.toBase58());
    assert.equal(result.transaction.message.staticAccountKeys[0].toBase58(), wallet.toBase58());
    await assert.rejects(client.build(quote, wallet.toBase58()), /Updating/);
  }
});

test("expired quotes and simulation failures without a usable transaction cannot reach signing", async () => {
  let time = 1000;
  let builds = 0;
  const wallet = Keypair.generate().publicKey.toBase58();
  const client = createJupiterSwapClient({ now: () => time, fetchImpl: async url => {
    if (String(url).includes("/quote?")) return Response.json(fixture());
    builds++; return Response.json({ simulationError: { errorCode: "TRANSACTION_ERROR" } });
  } });
  const old = await client.quote("buy", SWAP_TOKENS.SOL, "100000000"); time += 31000;
  await assert.rejects(client.build(old, wallet), /Updating/); assert.equal(builds, 0);
  const fresh = await client.quote("buy", SWAP_TOKENS.SOL, "100000000"); time += 2500;
  await assert.rejects(client.build(fresh, wallet), /Jupiter could not simulate.*TRANSACTION_ERROR/); assert.equal(builds, 1);
});

test("429 responses preserve Jupiter's backoff and aborted quotes do not issue requests", async () => {
  const client = createJupiterSwapClient({ fetchImpl: async () => new Response("", { status: 429, headers: { "Retry-After": "30" } }) });
  await assert.rejects(client.quote("buy", SWAP_TOKENS.SOL, "100000000"), error => error instanceof JupiterApiError && error.retryAfterMs === 30000);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client.quote("buy", SWAP_TOKENS.SOL, "100000000", controller.signal), { name: "AbortError" });
});

test("token search accepts supported mint metadata and excludes malformed entries and wXMR", async () => {
  const client = createJupiterSwapClient({ fetchImpl: async () => Response.json([
    { id: SWAP_TOKENS.USDC.mint, symbol: "USDC", name: "USD Coin", decimals: 6 },
    { id: SWAP_TOKENS.wXMR.mint, symbol: "wXMR", name: "Wrapped Monero", decimals: 12 },
    { id: "invalid", decimals: 6 }, { id: SWAP_TOKENS.SOL.mint, decimals: -1 },
  ]) });
  const result = await client.search("USDC"); assert.equal(result.length, 1); assert.equal(result[0].mint, SWAP_TOKENS.USDC.mint);
});


test("HTTP 200 simulation failures report Jupiter's actual reason instead of a generic preparation error", async () => {
  let time = 1000;
  const client = createJupiterSwapClient({ now: () => time, fetchImpl: async url => {
    if (String(url).includes("/quote?")) return Response.json(fixture());
    return Response.json({ swapTransaction: "present-but-never-used", lastValidBlockHeight: 100,
      simulationError: { errorCode: "TRANSACTION_ERROR", error: "Error processing Instruction 2: custom program error: 0x1789" } });
  } });
  const quote = await client.quote("buy", SWAP_TOKENS.SOL, "100000000"); time += 2500;
  await assert.rejects(client.build(quote, Keypair.generate().publicKey.toBase58()), error =>
    error instanceof JupiterSimulationError && error.message.includes("Instruction 2") && error.message.includes("0x1789"));
});

test("a valid transaction can use signature confirmation when the expiry hint is absent or string encoded", async () => {
  for (const expiry of [undefined, "100"]) {
    let time = 1000;
    const wallet = Keypair.generate().publicKey;
    const instruction = new TransactionInstruction({ programId: new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"),
      keys: [{ pubkey: new PublicKey(SWAP_FEE_ACCOUNT), isSigner: false, isWritable: true }], data: Buffer.alloc(0) });
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: wallet, recentBlockhash: PublicKey.default.toBase58(), instructions: [instruction] }).compileToV0Message());
    const client = createJupiterSwapClient({ now: () => time, fetchImpl: async url => String(url).includes("/quote?") ? Response.json(fixture())
      : Response.json({ swapTransaction: Buffer.from(tx.serialize()).toString("base64"), simulationError: null, lastValidBlockHeight: expiry }) });
    const quote = await client.quote("buy", SWAP_TOKENS.SOL, "100000000"); time += 2500;
    const result = await client.build(quote, wallet.toBase58());
    assert.equal(result.lastValidBlockHeight, expiry ? 100 : undefined);
  }
});

test("a valid transaction reaches wallet review despite compute-estimation simulation failure", async t => {
  const warning = t.mock.method(console, "warn", () => {});
  let time = 1000;
  const wallet = Keypair.generate().publicKey;
  const instruction = new TransactionInstruction({ programId: new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"),
    keys: [{ pubkey: new PublicKey(SWAP_FEE_ACCOUNT), isSigner: false, isWritable: true }], data: Buffer.alloc(0) });
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: wallet, recentBlockhash: PublicKey.default.toBase58(), instructions: [instruction] }).compileToV0Message());
  const serialized = Buffer.from(tx.serialize()).toString("base64");
  const client = createJupiterSwapClient({ now: () => time, fetchImpl: async url => String(url).includes("/quote?") ? Response.json(fixture())
    : Response.json({ swapTransaction: serialized, lastValidBlockHeight: 100,
      simulationError: { errorCode: "TRANSACTION_ERROR", error: "Error processing Instruction 2: custom program error: 0x1789" } }) });
  const quote = await client.quote("buy", SWAP_TOKENS.SOL, "100000000"); time += 2500;
  const result = await client.build(quote, wallet.toBase58());
  assert.deepEqual(Buffer.from(result.transaction.serialize()).toString("base64"), serialized);
  assert.equal(result.transaction.signatures.every(signature => signature.every(byte => byte === 0)), true);
  assert.equal(warning.mock.callCount(), 1);
});

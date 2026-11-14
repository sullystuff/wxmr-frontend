import assert from "node:assert/strict";
import test from "node:test";
import { chainflipPageNote, chainflipStatusLinks, explorerTxUrl, formatDuration, formatUnits, formatUsd, parseUnits, readDecisionToken, refundNotice, routeUsesChainflip, saveDecisionToken, swapApi, unitsToInput } from "../src/lib/swap-api";

test("parseUnits accepts what people type and refuses what cannot be exact", () => {
  assert.equal(parseUnits("0.05", 8), BigInt(5_000_000));
  assert.equal(parseUnits(".5", 6), BigInt(500_000));
  assert.equal(parseUnits("5.", 6), BigInt(5_000_000));
  assert.equal(parseUnits(" 1 ", 6), BigInt(1_000_000));
  assert.equal(parseUnits("", 6), null);
  assert.equal(parseUnits(".", 6), null);
  assert.equal(parseUnits("1.2.3", 6), null);
  assert.equal(parseUnits("abc", 6), null);
  assert.equal(parseUnits("-1", 6), null);
  assert.equal(parseUnits("1e5", 6), null);
  assert.equal(parseUnits("0.1234567", 6), null, "more decimals than the asset has");
});

test("unitsToInput round-trips exactly, at any size", () => {
  for (const [value, decimals] of [["100000000000", 12], ["1", 18], ["123456789012345678901234", 18], ["5000000", 6]] as const) {
    assert.equal(parseUnits(unitsToInput(value, decimals), decimals)?.toString(), value);
  }
  assert.equal(unitsToInput("100000000000", 12), "0.1");
  assert.equal(unitsToInput("5000000", 6), "5");
});

test("formatUnits groups, trims, and keeps small amounts readable", () => {
  assert.equal(formatUnits("1234567890", 6), "1,234.56789");
  assert.equal(formatUnits("5000000", 6), "5");
  assert.equal(formatUnits("0", 6), "0");
  assert.equal(formatUnits("1234", 18), "0.0000000000000012", "two significant digits survive");
  assert.equal(formatUnits("100000000000", 12), "0.1");
  assert.equal(formatUnits("777000", 8), "0.00777");
});

test("formatUsd reads USDC base units", () => {
  assert.equal(formatUsd("3850000000"), "$3,850.00");
  assert.equal(formatUsd("59820000"), "$59.82");
  assert.equal(formatUsd("5000"), "$0.00");
  assert.equal(formatUsd(undefined), null);
});

test("formatDuration speaks plainly", () => {
  assert.equal(formatDuration(30), "about a minute");
  assert.equal(formatDuration(120), "about 2 minutes");
  assert.equal(formatDuration(11 * 120), "about 22 minutes");
  assert.equal(formatDuration(20 * 120), "about 40 minutes");
  assert.equal(formatDuration(3 * 3600), "about 3 hours");
});

test("explorerTxUrl knows every chain, and nothing else", () => {
  assert.equal(explorerTxUrl("BTC.Bitcoin", "abc"), "https://mempool.space/tx/abc");
  assert.equal(explorerTxUrl("USDC.Ethereum", "0xabc"), "https://etherscan.io/tx/0xabc");
  assert.equal(explorerTxUrl("USDC.Arbitrum", "0xabc"), "https://arbiscan.io/tx/0xabc");
  assert.equal(explorerTxUrl("SOL.Solana", "abc"), "https://solscan.io/tx/abc");
  assert.equal(explorerTxUrl("XMR.Monero", "abc"), "https://xmrchain.net/tx/abc");
  assert.equal(explorerTxUrl("TRX.Tron", "abc"), "https://tronscan.org/#/transaction/abc");
  assert.equal(explorerTxUrl("NOPE.Nowhere", "abc"), null);
});

test("only USDC on Solana against XMR skips Chainflip", () => {
  assert.equal(routeUsesChainflip("BTC.Bitcoin", "USDC.Ethereum"), true);
  assert.equal(routeUsesChainflip("BTC.Bitcoin", "XMR.Monero"), true);
  assert.equal(routeUsesChainflip("XMR.Monero", "BTC.Bitcoin"), true);
  assert.equal(routeUsesChainflip("XMR.Monero", "USDC.Solana"), false);
  assert.equal(routeUsesChainflip("USDC.Solana", "XMR.Monero"), false);
  assert.equal(routeUsesChainflip("USDC.Solana", "BTC.Bitcoin"), true);
});

test("the refund notice only promises what is true for the route", () => {
  const intoXmr = refundNotice("BTC.Bitcoin", "XMR.Monero");
  assert.match(intoXmr, /converted to USDC/);
  assert.match(intoXmr, /hold the USDC and ask you to choose/);
  assert.match(intoXmr, /Converting back may return less/);
  assert.match(refundNotice("BTC.Bitcoin", "USDC.Ethereum"), /AML check/);
  // Out of XMR the deposit is sold before Chainflip ever screens anything.
  const fromXmr = refundNotice("XMR.Monero", "BTC.Bitcoin");
  assert.match(fromXmr, /Powered by Chainflip/);
  assert.match(fromXmr, /as XMR/);
  assert.match(fromXmr, /market price/);
  assert.doesNotMatch(fromXmr, /not swapped/);
  const noChainflip = refundNotice("USDC.Solana", "XMR.Monero");
  assert.doesNotMatch(noChainflip, /AML|Powered by/);
});

test("decision requests carry private authorization in a header and confirm only the reviewed quote", async (t) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(url.endsWith("decision-quotes") ? { quote: { id: "quoted" } } : { requestId: "queued" }));
  });
  const token = "a".repeat(64);
  await swapApi.decisionQuote("swap-id", token, "receive_usdc", "solana-wallet");
  await swapApi.decide("swap-id", token, "quoted");
  assert.deepEqual(JSON.parse(calls[0]!.init!.body as string), { action: "receive_usdc", address: "solana-wallet" });
  assert.deepEqual(JSON.parse(calls[1]!.init!.body as string), { quoteId: "quoted" });
  for (const call of calls) {
    assert.equal(new Headers(call.init!.headers).get("authorization"), `Bearer ${token}`);
    assert.equal(call.url.includes(token), false);
  }
});

test("create retries retain the private token through a lost response", async (t) => {
  const bodies: { decisionToken: string }[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string) as { decisionToken: string };
    bodies.push(body);
    if (bodies.length === 1) throw new Error("lost response");
    return new Response(JSON.stringify({ swap: { id: "created", decisionToken: body.decisionToken } }));
  });
  const params = { quoteId: "retryable-quote", destinationAddress: "xmr-wallet", refundAddress: "btc-wallet" };
  await assert.rejects(swapApi.create(params));
  const swap = await swapApi.create(params);
  assert.match(bodies[0]!.decisionToken, /^[0-9a-f]{64}$/);
  assert.equal(bodies[1]!.decisionToken, bodies[0]!.decisionToken);
  assert.equal(swap.decisionToken, bodies[0]!.decisionToken);
});

test("private recovery links restore controls separately from the public status URL", () => {
  const id = "b".repeat(32);
  const token = "c".repeat(64);
  const saved = new Map<string, string>();
  const descriptors = ["window", "localStorage"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  let replaced = "";
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { hash: `#decision=${token}`, href: `https://wxmr.io/?swap=${id}#decision=${token}` }, history: { state: null, replaceState: (_state: unknown, _title: string, url: string) => { replaced = url; } } } });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { setItem: (key: string, value: string) => saved.set(key, value), getItem: (key: string) => saved.get(key) ?? null } });
  try {
    assert.equal(readDecisionToken(id), token);
    assert.equal(new URL(replaced).hash, "");
    assert.equal(new URL(replaced).searchParams.get("swap"), id);
    assert.equal(saved.get(`wxmr:swap-decision:${id}`), token);
    saveDecisionToken("invalid", token);
    assert.equal(saved.size, 1);
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test("chainflipStatusLinks opens the channel until Chainflip has a swap, then the swap", () => {
  const none = { channelId: null, swapId: null, outChannelId: null, outSwapId: null };
  const channel = "15521027-Bitcoin-233730";
  assert.deepEqual(chainflipStatusLinks({ kind: "chainflip", chainflip: none }), []);
  assert.deepEqual(chainflipStatusLinks({ kind: "chainflip", chainflip: { ...none, channelId: channel } }), [{ label: "Swap status", href: `https://scan.chainflip.io/channels/${channel}` }]);
  assert.deepEqual(chainflipStatusLinks({ kind: "to_xmr", chainflip: { ...none, channelId: channel, swapId: "2005261" } }), [{ label: "Swap status", href: "https://scan.chainflip.io/swaps/2005261" }]);
  // A later deposit to a channel is its own swap, with no channel of its own to name.
  assert.deepEqual(chainflipStatusLinks({ kind: "to_xmr", chainflip: { ...none, swapId: "2005262" } }), [{ label: "Swap status", href: "https://scan.chainflip.io/swaps/2005262" }]);
});

test("chainflipStatusLinks names the last leg out of XMR as the swap, and a second channel into XMR as the refund", () => {
  const none = { channelId: null, swapId: null, outChannelId: null, outSwapId: null };
  const out = "15530000-Solana-147100";
  assert.deepEqual(chainflipStatusLinks({ kind: "from_xmr", chainflip: { ...none, outChannelId: out } }), [{ label: "Swap status", href: `https://scan.chainflip.io/channels/${out}` }]);
  assert.deepEqual(chainflipStatusLinks({ kind: "from_xmr", chainflip: { ...none, outChannelId: out, outSwapId: "2005300" } }), [{ label: "Swap status", href: "https://scan.chainflip.io/swaps/2005300" }]);
  assert.deepEqual(chainflipStatusLinks({ kind: "to_xmr", chainflip: { channelId: "15521027-Bitcoin-233730", swapId: "2005261", outChannelId: out, outSwapId: null } }), [
    { label: "Swap status", href: "https://scan.chainflip.io/swaps/2005261" },
    { label: "Refund status", href: `https://scan.chainflip.io/channels/${out}` },
  ]);
});

test("chainflipStatusLinks offers nothing rather than a page it cannot vouch for", () => {
  const none = { channelId: null, swapId: null, outChannelId: null, outSwapId: null };
  assert.deepEqual(chainflipStatusLinks({ kind: "to_xmr" }), [], "a backend from before this field");
  for (const bad of ["https://evil.example/", "javascript:alert(1)", "../../evil", "1-Bitcoin-1/../../evil", "2005261?x=1", "", "1-Bit coin-1"]) {
    assert.deepEqual(chainflipStatusLinks({ kind: "to_xmr", chainflip: { ...none, swapId: bad, channelId: bad } }), [], bad);
    assert.deepEqual(chainflipStatusLinks({ kind: "from_xmr", chainflip: { ...none, outSwapId: bad, outChannelId: bad } }), [], bad);
  }
});

test("chainflipPageNote explains this service's wallet on Chainflip's page, only on routes through it", () => {
  assert.match(chainflipPageNote("to_xmr")!, /destination is this service's Solana wallet/);
  assert.match(chainflipPageNote("from_xmr")!, /refund address is this service's Solana wallet/);
  assert.equal(chainflipPageNote("chainflip"), null);
});

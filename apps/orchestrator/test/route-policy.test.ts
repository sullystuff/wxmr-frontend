import test from "node:test";
import assert from "node:assert/strict";
import {
  THORCHAIN,
  USDC_MINT_ADDRESS,
  WXMR_MINT_ADDRESS,
  type Quote,
} from "@wxmr/core";
import {
  requiresSolanaHotWalletPayout,
  selectAssetToAssetRoute,
  selectReverseOutputRoute,
  usesThorchainBitcoinDepositAddress,
} from "../src/route-policy.ts";

function quote(overrides: Partial<Quote>): Quote {
  return {
    id: "quote-test",
    direction: "asset-to-asset",
    sourceChain: "solana",
    sourceToken: USDC_MINT_ADDRESS,
    sourceTokenSymbol: "USDC",
    sourceTokenDecimals: 6,
    destinationChain: "bitcoin",
    destinationToken: THORCHAIN.btcAsset,
    inputAmount: "1000000",
    xmrAddress: "",
    destinationAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
    destinationTokenSymbol: "BTC",
    destinationTokenDecimals: 8,
    estimatedWxmrOut: "0",
    estimatedXmrOut: "0",
    minWxmrOut: "0",
    minXmrOut: "0",
    estimatedDestinationOut: "1000",
    minDestinationOut: "980",
    bridgeFeeBps: 0,
    serviceFeeBps: 0,
    executionPolicy: "execute-anyway",
    jupiterPriceImpactPct: "0",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    route: "thorchain",
    ...overrides,
  };
}

test("reverse XMR output to BTC selects the BTC route", () => {
  assert.equal(selectReverseOutputRoute("bitcoin"), "xmr-to-btc");
});

test("reverse XMR output to Solana still selects the Solana route", () => {
  assert.equal(selectReverseOutputRoute("solana"), "xmr-to-solana");
});

test("asset swap from BTC keeps the BTC-source route path", () => {
  assert.equal(
    selectAssetToAssetRoute({
      sourceChain: "bitcoin",
      sourceToken: THORCHAIN.btcAsset,
      destinationChain: "solana",
      destinationToken: USDC_MINT_ADDRESS,
    }),
    "btc-to-asset",
  );
});

test("asset swap to BTC selects the BTC-destination route path", () => {
  assert.equal(
    selectAssetToAssetRoute({
      sourceChain: "solana",
      sourceToken: USDC_MINT_ADDRESS,
      destinationChain: "bitcoin",
      destinationToken: THORCHAIN.btcAsset,
    }),
    "asset-to-btc",
  );
});

test("destination-BTC THORChain route is paid from hot wallet, not a BTC deposit address", () => {
  const destinationBtcQuote = quote({
    sourceChain: "solana",
    destinationChain: "bitcoin",
    route: "thorchain",
  });

  assert.equal(requiresSolanaHotWalletPayout(destinationBtcQuote), true);
  assert.equal(usesThorchainBitcoinDepositAddress(destinationBtcQuote), false);
});

test("source-BTC THORChain route still uses a BTC deposit address", () => {
  const sourceBtcQuote = quote({
    sourceChain: "bitcoin",
    sourceToken: THORCHAIN.btcAsset,
    sourceTokenSymbol: "BTC",
    sourceTokenDecimals: 8,
    destinationChain: "solana",
    destinationToken: USDC_MINT_ADDRESS,
    destinationTokenSymbol: "USDC",
    destinationTokenDecimals: 6,
    route: "thorchain",
  });

  assert.equal(usesThorchainBitcoinDepositAddress(sourceBtcQuote), true);
  assert.equal(requiresSolanaHotWalletPayout(sourceBtcQuote), false);
});

test("non-BTC asset swap to XMR-SOL keeps the existing Solana hot-wallet payout rule", () => {
  const wxmrDestinationQuote = quote({
    sourceChain: "ethereum",
    sourceToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    sourceTokenSymbol: "USDC",
    destinationChain: "solana",
    destinationToken: WXMR_MINT_ADDRESS,
    destinationTokenSymbol: "XMR-SOL",
    destinationTokenDecimals: 12,
    route: "mayan",
    mayan: {
      quote: {
        toToken: { contract: USDC_MINT_ADDRESS },
      },
    } as Quote["mayan"],
  });

  assert.equal(requiresSolanaHotWalletPayout(wxmrDestinationQuote), true);
});

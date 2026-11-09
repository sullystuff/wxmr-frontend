import { formatUnits, type SwapQuote } from "@/lib/swap-api";

/** The same quoted fee stays visible on the form, confirmation and deposit page. */
export function ServiceFeeNotice({ quote }: { quote: SwapQuote | null | undefined }) {
  if (!quote?.serviceFeeBps) return null;
  const fee = quote.fees.find((entry) => entry.provider === "wxmr" && entry.asset === "USDC.Solana");
  if (!fee) return null;

  return (
    <div className="xswap-service-fee" role="note" aria-label="wXMR service fee">
      <div>
        <strong>{quote.serviceFeeBps / 100}% wXMR service fee</strong>
        <span>About {formatUnits(fee.amount, 6, 6)} USDC</span>
      </div>
      <p>
        Taken once from the route&apos;s USDC amount and already deducted from the receive estimate.
        Bridge and network fees are also included in the quote.
      </p>
    </div>
  );
}

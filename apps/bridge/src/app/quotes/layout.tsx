import { pageMetadata } from "@/lib/site-metadata";

export const metadata = pageMetadata(
  "/quotes",
  "Compare XMR & wXMR Quotes | Monero on Solana",
  "Compare Monero and wrapped Monero quotes across supported markets, including trading fees and available liquidity.",
);

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

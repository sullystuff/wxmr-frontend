import { pageMetadata } from "@/lib/site-metadata";

export const metadata = pageMetadata(
  "/transparency",
  "Wrapped Monero Reserve Proofs & Transparency | wXMR",
  "Inspect wXMR reserve proofs, bridge heartbeat data, and public verification records for wrapped Monero on Solana.",
);

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

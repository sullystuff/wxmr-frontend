import type { Metadata } from "next";

export const SITE_URL = "https://wxmr.io";
export const SITE_TITLE = "Wrapped XMR (wXMR) | Monero to Solana Bridge";
export const SITE_DESCRIPTION =
  "Bridge Monero (XMR) to wrapped Monero (wXMR) on Solana and redeem it for native XMR. Explore fees, public reserve proofs, and how the bridge works.";

// Also used as the analytics allowlist. Never accept arbitrary URLs or addresses.
export const PUBLIC_PATHS = [
  "/",
  "/wrapped-xmr",
  "/docs",
  "/transparency",
  "/quotes",
  "/privacy",
] as const;

export function pageMetadata(
  path: string,
  title: string,
  description: string,
): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: "wXMR",
      locale: "en_US",
      url: path,
      title,
      description,
      images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "wXMR — Wrapped Monero on Solana" }],
    },
    twitter: { card: "summary_large_image", title, description, images: ["/opengraph-image"] },
  };
}

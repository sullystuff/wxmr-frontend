import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "wXMR — Monero, connected.",
  description:
    "Bridge native XMR and wXMR on Solana. Clear fees, on-chain records, and public reserve proofs.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
  openGraph: {
    title: 'Monero Bridge',
    description: 'Bridge Monero to Solana and back',
    url: 'https://wxmr.io',
    siteName: 'wXMR',
    type: 'website',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Bridge Monero to Solana and back',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Monero Bridge',
    description: 'Bridge Monero to Solana and back',
    images: ['/og-image.png'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

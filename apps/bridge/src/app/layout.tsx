import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "./classic.css";
import { Providers } from "./providers";
import { AnonymousAnalytics } from "@/components/AnonymousAnalytics";
import { SITE_URL, SITE_TITLE, SITE_DESCRIPTION, pageMetadata } from "@/lib/site-metadata";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  ...pageMetadata("/", SITE_TITLE, SITE_DESCRIPTION),
  metadataBase: new URL(SITE_URL),
  robots: { index: true, follow: true },
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION,
    other: process.env.BING_SITE_VERIFICATION
      ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION }
      : undefined,
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            "@id": `${SITE_URL}/#website`,
            name: "wXMR",
            alternateName: ["Wrapped XMR", "Wrapped Monero on Solana"],
            url: SITE_URL,
            description: SITE_DESCRIPTION,
            inLanguage: "en",
          }).replace(/</g, "\\u003c") }}
        />
        <AnonymousAnalytics />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

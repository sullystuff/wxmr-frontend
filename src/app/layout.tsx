import type { Metadata } from 'next';
import { Inter, IBM_Plex_Mono, Space_Grotesk } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

// Body workhorse
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

// Display voice — distinctive grotesk for headings, the brand's character
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
});

// Protocol data — addresses, metrics, labels
const ibmMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono-ibm',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'wXMR Bridge — Monero on Solana',
  description: 'Bridge native Monero to and from the Monero token on Solana. 1:1 backed, independently verifiable.',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable} ${ibmMono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

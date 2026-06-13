import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from '@wxmr/shared';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'wXMR Swap',
  description: 'Swap XMR and USDC on Solana, routed through Jupiter',
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
    <html lang="en">
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

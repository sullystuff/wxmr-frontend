"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { OpenSourceLink, SolanaRpcSettings } from "@wxmr/shared";
import { Icon, TokenIcon } from "./BridgeIcons";
import { DonateSection } from "./DonateSection";

const AdapterWalletButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (module) => module.BaseWalletMultiButton,
    ),
  {
    ssr: false,
    loading: () => (
      <button className="wallet-placeholder" disabled>
        Connect wallet
      </button>
    ),
  },
);

export function WalletButton() {
  return (
    <AdapterWalletButton
      labels={{
        "no-wallet": "Connect wallet",
        "has-wallet": "Connect wallet",
        connecting: "Connecting…",
        "change-wallet": "Change wallet",
        "copy-address": "Copy address",
        copied: "Copied",
        disconnect: "Disconnect",
      }}
    />
  );
}

export function BridgeShell({ children, activeView = "bridge", onViewChange }: {
  children: ReactNode;
  activeView?: "bridge" | "swap";
  onViewChange?: (view: "bridge" | "swap") => void;
}) {
  const pathname = usePathname();
  return (
    <div className="site-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <Link href="/" className="wordmark" aria-label="wXMR home">
          <TokenIcon token="xmr" />
          <span className="brand-copy">
            <strong>Monero Bridge</strong>
            <span>Wrapped Monero on Solana</span>
          </span>
        </Link>
        <nav className="site-nav" aria-label="Main navigation">
          <Link
            href="/"
            aria-current={pathname === "/" && activeView === "bridge" ? "page" : undefined}
            className={pathname === "/" && activeView === "bridge" ? "active" : ""}
            onClick={(event) => {
              if (onViewChange) {
                event.preventDefault();
                onViewChange("bridge");
              }
            }}
          >
            Bridge
          </Link>
          <Link
            href="/#swap"
            scroll={false}
            aria-current={pathname === "/" && activeView === "swap" ? "page" : undefined}
            className={pathname === "/" && activeView === "swap" ? "active" : ""}
            onClick={(event) => {
              if (onViewChange) {
                event.preventDefault();
                onViewChange("swap");
              }
            }}
          >
            Swap
          </Link>
          <Link
            href="/transparency"
            aria-current={pathname === "/transparency" ? "page" : undefined}
            className={pathname === "/transparency" ? "active" : ""}
          >
            Reserves
          </Link>
          <Link
            href="/docs"
            aria-current={pathname === "/docs" ? "page" : undefined}
            className={pathname === "/docs" ? "active" : ""}
          >
            How it works
          </Link>
        </nav>
        <div className="header-actions">
          <span className="network-label">
            <span className="status-dot neutral" />
            Mainnet
          </span>
          <WalletButton />
        </div>
      </header>
      <div className="source-banner">
        <OpenSourceLink />
      </div>
      <div className="site-layout">
        <div className="site-main-content">{children}</div>
        <aside className="donation-sidebar" aria-label="Support wXMR">
          <DonateSection />
        </aside>
      </div>
      <footer className="site-footer">
        <div className="footer-brand">
          <span className="small-wordmark">wXMR.</span>
          <span>Monero, connected.</span>
        </div>
        <div className="footer-links">
          <a
            href="https://github.com/sullystuff/wxmr-frontend"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="code" />
            Source code
          </a>
          <Link href="/wrapped-xmr">Wrapped XMR</Link>
          <Link href="/privacy">Privacy & analytics</Link>
          <div className="footer-rpc">
            <SolanaRpcSettings />
          </div>
          <a
            href="https://swap.wxmr.io"
            target="_blank"
            rel="noopener noreferrer"
          >
            Swap
            <Icon name="external" />
          </a>
        </div>
        <span className="footer-networks">Built on Monero & Solana</span>
      </footer>
    </div>
  );
}

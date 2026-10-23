"use client";

import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { Connection } from "@solana/web3.js";
import { CopyAddress } from "@wxmr/shared";
import { rpcFetch } from "@/lib/rpc-client";
import { Icon } from "./BridgeIcons";

const DONATION_DOMAIN = "wxmr.sns";

export function DonateSection() {
  const { connection } = useConnection();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ address?: string; error?: boolean }>({});

  useEffect(() => {
    let active = true;
    // Resolve afresh on page load using the visitor's shared RPC budget.
    const nameConnection = new Connection(connection.rpcEndpoint, {
      commitment: "finalized",
      disableRetryOnRateLimit: true,
      fetch: rpcFetch(),
    });

    import("@bonfida/spl-name-service/domain")
      .then(({ safeResolve }) => safeResolve(nameConnection, DONATION_DOMAIN))
      .then((address) => {
        if (active) setResult({ address: address.toBase58() });
      })
      .catch(() => {
        if (active) setResult({ error: true });
      });

    return () => {
      active = false;
    };
  }, [connection, attempt]);

  return (
    <section className="donation-section" aria-labelledby="donation-heading">
      <div className="donation-message">
        <span className="eyebrow">DONATE</span>
        <h2 id="donation-heading">Support wXMR</h2>
        <p>
          Help fund development and infrastructure by sending SOL or wXMR on
          Solana.
        </p>
      </div>
      <div
        className="donation-destination"
        aria-busy={!result.address && !result.error}
      >
        <CopyAddress
          address={result.address}
          label="donation wallet address"
          className="donation-copy"
        >
          <span className="donation-copy-heading">
            <span>{DONATION_DOMAIN}</span>
            <Icon name="copy" />
          </span>
          <span className="donation-copy-hint">
            {result.address
              ? "Click to copy wallet address"
              : result.error
                ? "Wallet address unavailable"
                : "Resolving wallet address…"}
          </span>
        </CopyAddress>
        {result.address && (
          <code className="donation-address">{result.address}</code>
        )}
        {result.error && (
          <div className="donation-error" role="status">
            <span>Could not resolve {DONATION_DOMAIN}.</span>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setResult({});
                setAttempt((previous) => previous + 1);
              }}
            >
              <Icon name="refresh" />
              Retry address lookup
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

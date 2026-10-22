"use client";
import { CopyAddress } from "@wxmr/shared";
import { useHeartbeat } from "@/hooks/useHeartbeat";
import { compactXmr } from "./ReserveOverview";
import { Icon } from "./BridgeIcons";
const minutes = (blocks: number) => `~${blocks * 2} min`;
export function BridgeStatus({ owner }: { owner?: string }) {
  const { heartbeat: h, loading, error, online } = useHeartbeat();
  const own = h?.deposits.filter(d => d.account === owner) ?? [];
  const belowTarget = h && BigInt(h.unlockedAtomic) < BigInt(h.targetAtomic);
  const target = h?.unlocks.find(u => BigInt(u.availableAtomic) >= BigInt(h.targetAtomic));
  return <section className="bridge-status-panel" aria-labelledby="bridge-status-title">
    <div className="section-heading">
      <div><p className="eyebrow">LIVE BRIDGE ACTIVITY</p><h2 id="bridge-status-title">A clear view of the queue.</h2></div>
      <span className={`bridge-health ${online ? "is-online" : "is-offline"}`}>
        <span className={`status-dot ${online ? "" : "muted-dot"}`} />
        {loading ? "Checking bridge…" : !h || error ? "Status unavailable" : online ? "Bridge online" : "Bridge offline"}
      </span>
    </div>
    <div className="bridge-live-grid">
      <div className="liquidity-summary">
        <span className="field-label">Native XMR ready for withdrawals</span>
        <p className="liquidity-number">{h ? compactXmr(h.unlockedAtomic) : "—"}<small>XMR</small></p>
        {belowTarget && <div className="unlock-schedule">
          <p className="small">{target
            ? `${compactXmr(target.availableAtomic)} XMR available in ${target.blocks} blocks (${minutes(target.blocks)}).`
            : h.unlocks.length ? "Upcoming unlocks:" : "No upcoming unlock estimate in this snapshot."}</p>
          {h.unlocks.map(u => <p className="muted small" key={u.blocks}>
            +{compactXmr(u.amountAtomic)} XMR in {u.blocks} blocks ({minutes(u.blocks)}) · {compactXmr(u.availableAtomic)} XMR available
          </p>)}
        </div>}
        <p className="muted small">{h ? `Wallet height ${h.moneroHeight.toLocaleString()} · observed ${new Date(h.observedAt*1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Reading the on-chain heartbeat…"}</p>
        <p className="muted small">Updated every 5 minutes. Offline after 6 minutes without a fresh heartbeat.</p>
        {h && !online && <p className="small stale-label">Last reported figures · waiting for a fresh heartbeat.</p>}
        {error && <p className="small stale-label">Heartbeat lookup unavailable. Retrying automatically.</p>}
        {h && <a className="text-link small" href={`https://solscan.io/account/${h.account}`} target="_blank" rel="noopener noreferrer">On-chain heartbeat <Icon name="external" /></a>}
      </div>
      <div className="deposit-pool">
        <div className="pool-heading"><h3>Pending deposit pool</h3><span className="tiny-tag">{h ? h.deposits.length : "—"} TRANSFERS</span></div>
        {owner && <p className="your-deposit-summary small">{own.length
          ? `${own.length} of your transfers pending · ${compactXmr(own.reduce((sum,d) => sum+BigInt(d.amountAtomic),BigInt(0)))} XMR. Your rows are highlighted below.`
          : "You have no pending deposits in the latest snapshot."}</p>}
        {!owner && <p className="muted small">Connect your wallet to highlight your deposits.</p>}
        {h && h.deposits.length > 0 ? <div className="pool-table-scroll"><table className="pool-table">
          <thead><tr><th scope="col">Account</th><th scope="col">XMR</th><th scope="col">Status / ETA</th></tr></thead>
          <tbody>{[...h.deposits].sort((a,b) => Number(b.account === owner)-Number(a.account === owner)).map(d => <tr key={d.id} className={d.account === owner ? "own-deposit" : ""}>
            <td><CopyAddress address={d.account} label="Deposit owner account" className="pool-account">{d.account.slice(0,5)}…{d.account.slice(-5)}</CopyAddress>{d.account === owner && <span className="own-label">YOU</span>}</td>
            <td>{compactXmr(d.amountAtomic, 6)}</td>
            <td>{d.status === "minting" ? "Minting wXMR" : d.status === "below-minimum" ? "Below 0.1 XMR minimum" : d.blocks ? `${d.blocks} blocks · ${minutes(d.blocks)}` : "Ready to mint"}
              <span className="pool-confirmations">{Math.min(10,d.confirmations)}/10 confirmations{d.status === "below-minimum" && d.blocks > 0 ? ` · ${d.blocks} blocks (${minutes(d.blocks)})` : ""}</span></td>
          </tr>)}</tbody>
        </table></div> : <p className="pool-empty muted">{loading ? "Loading pending deposits…" : h ? "No deposits waiting to mint in this snapshot." : "Pending deposit data unavailable."}</p>}
        <p className="muted small">ETAs use ~2 minutes per Monero block and reflect the last snapshot.</p>
      </div>
    </div>
  </section>;
}

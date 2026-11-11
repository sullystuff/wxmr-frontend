'use client';

import { useState } from 'react';
import { readSignedXmrTransaction, type WithdrawalCompletion } from '@/lib/withdrawal-history';

export function WithdrawalRecovery({ completion }: { completion: WithdrawalCompletion }) {
  const [hex, setHex] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  async function load() {
    setLoading(true); setError(null);
    try { setHex(await readSignedXmrTransaction(completion)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load the signed transaction'); }
    finally { setLoading(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(hex!); setCopied(true); }
    catch { setError('Copy failed. Select the transaction text and copy it manually.'); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ tx_as_hex: hex, do_not_relay: false })], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'monero-transaction.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="withdrawal-recovery" aria-label="Missing payment recovery">
    <h4>Payment missing from your wallet?</h4>
    <p>Let your wallet finish syncing. If the payment still does not appear, scan its transaction ID into your wallet or rebroadcast the original signed transaction below.</p>
    <dl>
      <div><dt>Monero transaction ID</dt><dd><a href={`https://xmrchain.net/tx/${completion.xmrTxHash}`} target="_blank" rel="noopener noreferrer">{completion.xmrTxHash}</a></dd></div>
      <div><dt>Solana completion</dt><dd><a href={`https://solscan.io/tx/${completion.completionSignature}`} target="_blank" rel="noopener noreferrer">View completed transaction</a></dd></div>
    </dl>
    <p>The bridge recorded this payment as sent. Monero confirmations and wallet synchronization are separate.</p>
    <details>
      <summary>Import a missing payment into your wallet</summary>
      <p>Open the wallet for the Monero destination shown in Transfer details, connect to a synchronized node, and let the wallet finish syncing. Its restore height must be before this payment.</p>
      <p><strong>Monero GUI:</strong> open <strong>Settings → Wallet → Scan transaction</strong>, paste the Monero transaction ID above, and confirm. The wallet checks the payment and updates its history and balance if it belongs to you.</p>
      <p><strong>Monero CLI:</strong> enter this command in your open wallet:</p>
      <pre><code>{`scan_tx ${completion.xmrTxHash}`}</code></pre>
      <p>Use the transaction ID for wallet scanning. Use the signed hex below for broadcasting. Scanning through a remote node shares this transaction ID with that node. <a href="https://www.getmonero.org/resources/user-guides/scan-txid.html" target="_blank" rel="noopener noreferrer">Official wallet scanning guide</a></p>
    </details>
    {completion.recovery ? <div>
      <h5>Signed transaction and manual broadcast</h5>
      {!hex && <button className="recovery-load" type="button" disabled={loading} onClick={() => void load()}>{loading ? 'Loading signed transaction…' : 'Load signed transaction'}</button>}
      {hex && <>
        <label>Signed Monero transaction (hex)<textarea readOnly value={hex} rows={5} spellCheck={false} /></label>
        <div className="recovery-actions"><button type="button" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy transaction'}</button><button type="button" onClick={download}>Download broadcast request</button></div>
        <p><strong>Broadcast with xmrchain.net</strong></p>
        <ol>
          <li>Click <strong>Copy transaction</strong> above.</li>
          <li>Open the <a href="https://xmrchain.net/rawtx" target="_blank" rel="noopener noreferrer">xmrchain.net transaction pusher</a>.</li>
          <li>Paste the complete signed hex into the transaction box and click <strong>push</strong>. The <strong>check</strong> option does not support raw transaction hex.</li>
          <li>Wait for the transaction to appear on the network, then let your wallet synchronize.</li>
        </ol>
        <p>This sends the signed transaction to xmrchain.net for broadcast.</p>
        <details>
          <summary>Broadcast through your own Monero daemon</summary>
          <p>Download the broadcast request above, then submit it to your running Monero daemon:</p>
          <pre><code>{`curl -H 'Content-Type: application/json' --data-binary @monero-transaction.json http://127.0.0.1:18081/send_raw_transaction`}</code></pre>
          <p>Replace the URL if your daemon uses another address. A successful response has status “OK”.</p>
        </details>
        <p>Rebroadcasting the same signed transaction does not create a second payment. If it is already confirmed, use the wallet scanning instructions above.</p>
      </>}
      {error && <p role="alert">{error}</p>}
    </div> : <p>Signed transaction recovery data was not published for this older withdrawal. You can still scan its transaction ID into your wallet above.</p>}
  </section>;
}

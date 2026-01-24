'use client';

import { useState, useEffect, useCallback } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useWxmrBridge, DepositInfo, WithdrawalInfo, BridgeConfig } from '@/hooks/useWxmrBridge';

// Format piconero to XMR (12 decimal places)
function formatXmr(piconero: bigint): string {
  const xmr = Number(piconero) / 1e12;
  return xmr.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 12 });
}

// Format timestamp
function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

// Truncate address for display
function truncateAddress(address: string, chars = 8): string {
  if (address.length <= chars * 2) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

// Status badge component
function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-500/20 text-yellow-400',
    awaitingDeposit: 'bg-blue-500/20 text-blue-400',
    completed: 'bg-green-500/20 text-green-400',
    cancelled: 'bg-gray-500/20 text-gray-400',
    sending: 'bg-orange-500/20 text-orange-400',
    reverted: 'bg-red-500/20 text-red-400',
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colors[status] || 'bg-gray-500/20 text-gray-400'}`}>
      {status}
    </span>
  );
}

export default function Home() {
  const {
    isConnected,
    publicKey,
    requestDeposit,
    fetchMyDeposits,
    requestWithdrawal,
    fetchMyWithdrawals,
    fetchBridgeConfig,
    getWxmrBalance,
  } = useWxmrBridge();

  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>('deposit');
  const [deposits, setDeposits] = useState<DepositInfo[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalInfo[]>([]);
  const [bridgeConfig, setBridgeConfig] = useState<BridgeConfig | null>(null);
  const [wxmrBalance, setWxmrBalance] = useState<bigint>(BigInt(0));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Withdrawal form state
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [xmrAddress, setXmrAddress] = useState('');

  // Load data when connected
  const loadData = useCallback(async () => {
    if (!isConnected) return;

    try {
      const [config, balance, myDeposits, myWithdrawals] = await Promise.all([
        fetchBridgeConfig(),
        getWxmrBalance(),
        fetchMyDeposits(),
        fetchMyWithdrawals(),
      ]);

      setBridgeConfig(config);
      setWxmrBalance(balance);
      setDeposits(myDeposits.sort((a, b) => b.createdAt - a.createdAt));
      setWithdrawals(myWithdrawals.sort((a, b) => b.createdAt - a.createdAt));
    } catch (err) {
      console.error('Error loading data:', err);
    }
  }, [isConnected, fetchBridgeConfig, getWxmrBalance, fetchMyDeposits, fetchMyWithdrawals]);

  useEffect(() => {
    loadData();
    // Poll every 10 seconds
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Handle deposit request
  const handleDeposit = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await requestDeposit();
      if (result) {
        setSuccess(`Deposit request created! TX: ${result.signature.slice(0, 20)}...`);
        await loadData();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create deposit request');
    } finally {
      setLoading(false);
    }
  };

  // Handle withdrawal request
  const handleWithdraw = async () => {
    if (!withdrawAmount || !xmrAddress) {
      setError('Please enter amount and XMR address');
      return;
    }

    // Validate XMR address (basic check)
    if (!xmrAddress.startsWith('4') && !xmrAddress.startsWith('8')) {
      setError('Invalid XMR address (should start with 4 or 8)');
      return;
    }

    if (xmrAddress.length < 95) {
      setError('XMR address too short');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // Convert XMR to piconero
      const amountFloat = parseFloat(withdrawAmount);
      if (isNaN(amountFloat) || amountFloat <= 0) {
        throw new Error('Invalid amount');
      }
      const amountPiconero = BigInt(Math.floor(amountFloat * 1e12));

      if (amountPiconero > wxmrBalance) {
        throw new Error('Insufficient wXMR balance');
      }

      const result = await requestWithdrawal(amountPiconero, xmrAddress);
      if (result) {
        setSuccess(`Withdrawal request created! TX: ${result.signature.slice(0, 20)}...`);
        setWithdrawAmount('');
        setXmrAddress('');
        await loadData();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create withdrawal request');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <header className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-[var(--primary)]">wXMR Bridge</h1>
            <p className="text-[var(--muted)] mt-1">Bridge XMR to Solana</p>
          </div>
          <WalletMultiButton />
        </header>

        {!isConnected ? (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">🔗</div>
            <h2 className="text-xl font-semibold mb-2">Connect Your Wallet</h2>
            <p className="text-[var(--muted)]">Connect a Solana wallet to start bridging XMR</p>
          </div>
        ) : (
          <>
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <div className="bg-[var(--card)] rounded-lg p-4 border border-[var(--border)]">
                <p className="text-[var(--muted)] text-sm">Your wXMR Balance</p>
                <p className="text-2xl font-bold mt-1">{formatXmr(wxmrBalance)} wXMR</p>
              </div>
              <div className="bg-[var(--card)] rounded-lg p-4 border border-[var(--border)]">
                <p className="text-[var(--muted)] text-sm">Total Bridged In</p>
                <p className="text-2xl font-bold mt-1">
                  {bridgeConfig ? formatXmr(bridgeConfig.totalDeposits) : '0'} XMR
                </p>
              </div>
              <div className="bg-[var(--card)] rounded-lg p-4 border border-[var(--border)]">
                <p className="text-[var(--muted)] text-sm">Total Bridged Out</p>
                <p className="text-2xl font-bold mt-1">
                  {bridgeConfig ? formatXmr(bridgeConfig.totalWithdrawals) : '0'} XMR
                </p>
              </div>
            </div>

            {/* Tab Navigation */}
            <div className="flex gap-2 mb-6">
              <button
                onClick={() => setActiveTab('deposit')}
                className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                  activeTab === 'deposit'
                    ? 'bg-[var(--primary)] text-white'
                    : 'bg-[var(--card)] text-[var(--muted)] hover:bg-[var(--card-hover)]'
                }`}
              >
                Deposit XMR
              </button>
              <button
                onClick={() => setActiveTab('withdraw')}
                className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                  activeTab === 'withdraw'
                    ? 'bg-[var(--primary)] text-white'
                    : 'bg-[var(--card)] text-[var(--muted)] hover:bg-[var(--card-hover)]'
                }`}
              >
                Withdraw XMR
              </button>
            </div>

            {/* Alerts */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-lg mb-6">
                {error}
              </div>
            )}
            {success && (
              <div className="bg-green-500/10 border border-green-500/30 text-green-400 p-4 rounded-lg mb-6">
                {success}
              </div>
            )}

            {/* Main Content */}
            {activeTab === 'deposit' ? (
              <div className="space-y-6">
                {/* Deposit Form */}
                <div className="bg-[var(--card)] rounded-lg p-6 border border-[var(--border)]">
                  <h2 className="text-xl font-semibold mb-4">Request Deposit Address</h2>
                  <p className="text-[var(--muted)] mb-4">
                    Request a unique XMR address to deposit. Once XMR is received and confirmed,
                    wXMR will be minted to your wallet.
                  </p>
                  <button
                    onClick={handleDeposit}
                    disabled={loading}
                    className="bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-medium transition-colors"
                  >
                    {loading ? 'Processing...' : 'Request Deposit Address'}
                  </button>
                </div>

                {/* Deposit History */}
                <div className="bg-[var(--card)] rounded-lg p-6 border border-[var(--border)]">
                  <h2 className="text-xl font-semibold mb-4">Your Deposits</h2>
                  {deposits.length === 0 ? (
                    <p className="text-[var(--muted)]">No deposits yet</p>
                  ) : (
                    <div className="space-y-4">
                      {deposits.map((deposit) => (
                        <div
                          key={deposit.depositPda}
                          className="bg-[var(--background)] rounded-lg p-4 border border-[var(--border)]"
                        >
                          <div className="flex justify-between items-start mb-2">
                            <StatusBadge status={deposit.status} />
                            <span className="text-xs text-[var(--muted)]">
                              {formatTime(deposit.createdAt)}
                            </span>
                          </div>
                          {deposit.xmrDepositAddress ? (
                            <div className="mt-2">
                              <p className="text-xs text-[var(--muted)] mb-1">Send XMR to:</p>
                              <code className="text-xs bg-[var(--card)] p-2 rounded block break-all">
                                {deposit.xmrDepositAddress}
                              </code>
                            </div>
                          ) : (
                            <p className="text-sm text-[var(--muted)] mt-2">
                              Waiting for address assignment...
                            </p>
                          )}
                          {deposit.amountDeposited > 0 && (
                            <p className="text-sm mt-2">
                              <span className="text-[var(--muted)]">Amount:</span>{' '}
                              <span className="font-medium">{formatXmr(deposit.amountDeposited)} XMR</span>
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Withdraw Form */}
                <div className="bg-[var(--card)] rounded-lg p-6 border border-[var(--border)]">
                  <h2 className="text-xl font-semibold mb-4">Withdraw XMR</h2>
                  <p className="text-[var(--muted)] mb-4">
                    Burn wXMR and receive XMR at your specified address. Minimum: 0.001 XMR.
                  </p>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">Amount (XMR)</label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          step="0.000000000001"
                          min="0.001"
                          value={withdrawAmount}
                          onChange={(e) => setWithdrawAmount(e.target.value)}
                          placeholder="0.0"
                          className="flex-1 bg-[var(--background)] border border-[var(--border)] rounded-lg px-4 py-2 text-white focus:outline-none focus:border-[var(--primary)]"
                        />
                        <button
                          onClick={() => setWithdrawAmount(formatXmr(wxmrBalance))}
                          className="px-4 py-2 bg-[var(--border)] hover:bg-[var(--muted)] rounded-lg text-sm transition-colors"
                        >
                          MAX
                        </button>
                      </div>
                      <p className="text-xs text-[var(--muted)] mt-1">
                        Available: {formatXmr(wxmrBalance)} wXMR
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">XMR Address</label>
                      <input
                        type="text"
                        value={xmrAddress}
                        onChange={(e) => setXmrAddress(e.target.value)}
                        placeholder="4... or 8..."
                        className="w-full bg-[var(--background)] border border-[var(--border)] rounded-lg px-4 py-2 text-white focus:outline-none focus:border-[var(--primary)]"
                      />
                    </div>
                    <button
                      onClick={handleWithdraw}
                      disabled={loading || !withdrawAmount || !xmrAddress}
                      className="w-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-medium transition-colors"
                    >
                      {loading ? 'Processing...' : 'Withdraw XMR'}
                    </button>
                  </div>
                </div>

                {/* Withdrawal History */}
                <div className="bg-[var(--card)] rounded-lg p-6 border border-[var(--border)]">
                  <h2 className="text-xl font-semibold mb-4">Your Withdrawals</h2>
                  {withdrawals.length === 0 ? (
                    <p className="text-[var(--muted)]">No withdrawals yet</p>
                  ) : (
                    <div className="space-y-4">
                      {withdrawals.map((withdrawal) => (
                        <div
                          key={withdrawal.withdrawalPda}
                          className="bg-[var(--background)] rounded-lg p-4 border border-[var(--border)]"
                        >
                          <div className="flex justify-between items-start mb-2">
                            <StatusBadge status={withdrawal.status} />
                            <span className="text-xs text-[var(--muted)]">
                              {formatTime(withdrawal.createdAt)}
                            </span>
                          </div>
                          <p className="text-lg font-medium">
                            {formatXmr(withdrawal.amount)} XMR
                          </p>
                          <p className="text-xs text-[var(--muted)] mt-1">
                            To: {truncateAddress(withdrawal.xmrAddress, 12)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Footer Info */}
            <div className="mt-8 text-center text-sm text-[var(--muted)]">
              <p>Connected: {truncateAddress(publicKey?.toBase58() || '', 8)}</p>
              {bridgeConfig && (
                <p className="mt-1">
                  Bridge Authority: {truncateAddress(bridgeConfig.authority, 8)}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

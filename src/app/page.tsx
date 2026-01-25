'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useWxmrBridge, DepositInfo, WithdrawalInfo, BridgeConfig } from '@/hooks/useWxmrBridge';
import { QRCodeSVG } from 'qrcode.react';

// Monero Logo SVG component (official Simple Icons design)
function MoneroLogo({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="12" fill="#FF6600"/>
      <path d="M12 4C7.582 4 4 7.582 4 12.015c0 .89.152 1.738.412 2.54h2.385V7.82L12 13.03l5.203-5.21v6.735h2.385c.26-.802.412-1.65.412-2.54C20 7.583 16.418 4 12 4zm-1.192 11.538l-2.278-2.28v4.234H5.172C6.58 19.793 9.119 21.333 12 21.333s5.442-1.54 6.83-3.842h-3.36v-4.233l-2.258 2.28-1.192 1.193-1.21-1.193h-.002z" fill="#FFF"/>
    </svg>
  );
}

// Format piconero to XMR (12 decimal places)
function formatXmr(piconero: bigint): string {
  const xmr = Number(piconero) / 1e12;
  return xmr.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 12 });
}

// Format timestamp
function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

// Calculate time remaining until expiration (7 days from creation)
function getExpirationInfo(createdAt: number): { text: string; isExpired: boolean; isUrgent: boolean } {
  const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;
  const expiresAt = createdAt + SEVEN_DAYS_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  const remaining = expiresAt - now;

  if (remaining <= 0) {
    return { text: 'Expired', isExpired: true, isUrgent: false };
  }

  const days = Math.floor(remaining / (24 * 60 * 60));
  const hours = Math.floor((remaining % (24 * 60 * 60)) / (60 * 60));

  if (days > 1) {
    return { text: `${days}d ${hours}h remaining`, isExpired: false, isUrgent: false };
  } else if (days === 1) {
    return { text: `${days}d ${hours}h remaining`, isExpired: false, isUrgent: true };
  } else {
    return { text: `${hours}h remaining`, isExpired: false, isUrgent: true };
  }
}

// Truncate address for display
function truncateAddress(address: string, chars = 8): string {
  if (address.length <= chars * 2) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

// Status badge component
function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
    awaitingDeposit: 'bg-[#ff6600]/20 text-[#ff6600] border border-[#ff6600]/30',
    completed: 'bg-green-500/20 text-green-400 border border-green-500/30',
    cancelled: 'bg-gray-500/20 text-gray-400 border border-gray-500/30',
    sending: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
    reverted: 'bg-red-500/20 text-red-400 border border-red-500/30',
  };

  return (
    <span className={`xmr-badge ${colors[status] || 'bg-gray-500/20 text-gray-400 border border-gray-500/30'}`}>
      {status}
    </span>
  );
}

// QR Code Modal component
function QRCodeModal({ address, onClose }: { address: string; onClose: () => void }) {
  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div 
        className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <MoneroLogo className="w-5 h-5" />
            Scan to Deposit XMR
          </h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--background)] rounded-lg transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="bg-white rounded-xl p-4 flex justify-center">
          <QRCodeSVG 
            value={address} 
            size={256} 
            level="M"
            includeMargin={true}
            bgColor="#ffffff"
            fgColor="#000000"
          />
        </div>
        <div className="mt-4">
          <p className="text-xs text-[var(--muted)] mb-2 uppercase tracking-wide">Address</p>
          <code className="text-xs bg-[var(--background)] p-3 rounded-lg block break-all font-mono border border-[var(--border)] text-[#ff6600]">
            {address}
          </code>
        </div>
        <button
          onClick={onClose}
          className="mt-4 w-full py-2.5 bg-[var(--background)] hover:bg-[var(--card-hover)] border border-[var(--border)] rounded-lg text-sm font-medium transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}

// QR Scanner Modal component
function QRScannerModal({ onScan, onClose }: { onScan: (address: string) => void; onClose: () => void }) {
  const scannerRef = useRef<HTMLDivElement>(null);
  const html5QrCodeRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(true);

  useEffect(() => {
    let mounted = true;

    const startScanner = async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        
        if (!mounted || !scannerRef.current) return;

        const html5QrCode = new Html5Qrcode('qr-scanner-region');
        html5QrCodeRef.current = html5QrCode;

        await html5QrCode.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
          },
          (decodedText) => {
            // Extract address from monero: URI if present
            let address = decodedText;
            if (decodedText.toLowerCase().startsWith('monero:')) {
              address = decodedText.slice(7).split('?')[0];
            }
            onScan(address);
            html5QrCode.stop().catch(console.error);
            onClose();
          },
          () => {} // Ignore scan failures
        );

        if (mounted) {
          setIsStarting(false);
        }
      } catch (err: any) {
        if (mounted) {
          setIsStarting(false);
          if (err.name === 'NotAllowedError') {
            setError('Camera access denied. Please allow camera access to scan QR codes.');
          } else if (err.name === 'NotFoundError') {
            setError('No camera found on this device.');
          } else {
            setError(err.message || 'Failed to start camera');
          }
        }
      }
    };

    startScanner();

    return () => {
      mounted = false;
      if (html5QrCodeRef.current) {
        html5QrCodeRef.current.stop().catch(() => {});
      }
    };
  }, [onScan, onClose]);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div 
        className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <svg className="w-5 h-5 text-[#ff6600]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
            </svg>
            Scan XMR Address
          </h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--background)] rounded-lg transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {error ? (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-lg text-sm">
            {error}
          </div>
        ) : (
          <>
            {isStarting && (
              <div className="flex items-center justify-center py-8">
                <svg className="animate-spin w-8 h-8 text-[#ff6600]" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </div>
            )}
            <div 
              id="qr-scanner-region" 
              ref={scannerRef}
              className="rounded-xl overflow-hidden"
              style={{ display: isStarting ? 'none' : 'block' }}
            />
          </>
        )}
        
        <p className="text-xs text-[var(--muted)] mt-4 text-center">
          Point your camera at a Monero address QR code
        </p>
        
        <button
          onClick={onClose}
          className="mt-4 w-full py-2.5 bg-[var(--background)] hover:bg-[var(--card-hover)] border border-[var(--border)] rounded-lg text-sm font-medium transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
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

  // QR code modal state
  const [qrAddress, setQrAddress] = useState<string | null>(null);

  // QR scanner modal state
  const [showScanner, setShowScanner] = useState(false);

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
    <main className="min-h-screen p-4 md:p-8 xmr-pattern">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <header className="flex flex-col md:flex-row justify-between items-center mb-10 gap-4">
          <div className="flex items-center gap-4">
            <MoneroLogo className="w-12 h-12" />
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-[#ff6600] to-[#ff8533] bg-clip-text text-transparent">
                wXMR Bridge
              </h1>
              <p className="text-[var(--muted)] mt-0.5">Bridge XMR to Solana</p>
            </div>
          </div>
          <WalletMultiButton />
        </header>

        {!isConnected ? (
          <div className="text-center py-24">
            <div className="flex justify-center mb-6">
              <div className="relative">
                <MoneroLogo className="w-24 h-24 xmr-pulse" />
                <div className="absolute inset-0 bg-[#ff6600]/20 blur-2xl rounded-full" />
              </div>
            </div>
            <h2 className="text-2xl font-bold mb-3">Connect Your Wallet</h2>
            <p className="text-[var(--muted)] mb-8">Connect a Solana wallet to start bridging XMR</p>
            <div className="inline-block">
              <WalletMultiButton />
            </div>
          </div>
        ) : (
          <>
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <div className="xmr-card xmr-stat-card p-5">
                <p className="text-[var(--muted)] text-sm uppercase tracking-wide">Your wXMR Balance</p>
                <p className="text-2xl font-bold mt-2 text-[#ff6600]">{formatXmr(wxmrBalance)}</p>
                <p className="text-xs text-[var(--muted)] mt-1">wXMR</p>
              </div>
              <div className="xmr-card xmr-stat-card p-5">
                <p className="text-[var(--muted)] text-sm uppercase tracking-wide">Total Bridged In</p>
                <p className="text-2xl font-bold mt-2">
                  {bridgeConfig ? formatXmr(bridgeConfig.totalDeposits) : '0'}
                </p>
                <p className="text-xs text-[var(--muted)] mt-1">XMR</p>
              </div>
              <div className="xmr-card xmr-stat-card p-5">
                <p className="text-[var(--muted)] text-sm uppercase tracking-wide">Total Bridged Out</p>
                <p className="text-2xl font-bold mt-2">
                  {bridgeConfig ? formatXmr(bridgeConfig.totalWithdrawals) : '0'}
                </p>
                <p className="text-xs text-[var(--muted)] mt-1">XMR</p>
              </div>
            </div>

            {/* Tab Navigation */}
            <div className="flex gap-2 mb-6">
              <button
                onClick={() => setActiveTab('deposit')}
                className={`xmr-tab px-6 py-2.5 rounded-lg font-semibold transition-all ${
                  activeTab === 'deposit'
                    ? 'xmr-tab-active text-white'
                    : 'bg-[var(--card)] text-[var(--muted)] hover:bg-[var(--card-hover)] hover:text-white border border-[var(--border)]'
                }`}
              >
                Deposit XMR
              </button>
              <button
                onClick={() => setActiveTab('withdraw')}
                className={`xmr-tab px-6 py-2.5 rounded-lg font-semibold transition-all ${
                  activeTab === 'withdraw'
                    ? 'xmr-tab-active text-white'
                    : 'bg-[var(--card)] text-[var(--muted)] hover:bg-[var(--card-hover)] hover:text-white border border-[var(--border)]'
                }`}
              >
                Withdraw XMR
              </button>
            </div>

            {/* Alerts */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-lg mb-6 flex items-center gap-3">
                <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <span>{error}</span>
              </div>
            )}
            {success && (
              <div className="bg-green-500/10 border border-green-500/30 text-green-400 p-4 rounded-lg mb-6 flex items-center gap-3">
                <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>{success}</span>
              </div>
            )}

            {/* Main Content */}
            {activeTab === 'deposit' ? (
              <div className="space-y-6">
                {/* Deposit Form */}
                <div className="xmr-card p-6 xmr-glow">
                  <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
                    <svg className="w-5 h-5 text-[#ff6600]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                    </svg>
                    Request Deposit Address
                  </h2>
                  <p className="text-[var(--muted)] mb-6">
                    Request a unique XMR address to deposit. Once XMR is received and confirmed,
                    wXMR will be minted to your wallet.
                  </p>
                  <button
                    onClick={handleDeposit}
                    disabled={loading}
                    className="xmr-btn-primary text-white px-8 py-3 rounded-lg font-semibold"
                  >
                    {loading ? (
                      <span className="flex items-center gap-2">
                        <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Processing...
                      </span>
                    ) : 'Request Deposit Address'}
                  </button>
                </div>

                {/* Deposit History */}
                <div className="xmr-card p-6">
                  <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <svg className="w-5 h-5 text-[var(--muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    Your Deposits
                  </h2>
                  {deposits.length === 0 ? (
                    <div className="text-center py-8">
                      <div className="text-4xl mb-3 opacity-30">📥</div>
                      <p className="text-[var(--muted)]">No deposits yet</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {deposits.map((deposit) => (
                        <div
                          key={deposit.depositPda}
                          className="bg-[var(--background)] rounded-lg p-4 border border-[var(--border)] hover:border-[#ff660033] transition-colors"
                        >
                          <div className="flex justify-between items-start mb-3">
                            <div className="flex items-center gap-2">
                              <StatusBadge status={deposit.status} />
                              {(deposit.status === 'pending' || deposit.status === 'awaitingDeposit') && (() => {
                                const expInfo = getExpirationInfo(deposit.createdAt);
                                return (
                                  <span className={`text-xs px-2 py-0.5 rounded ${
                                    expInfo.isExpired 
                                      ? 'bg-red-500/20 text-red-400' 
                                      : expInfo.isUrgent 
                                        ? 'bg-yellow-500/20 text-yellow-400' 
                                        : 'bg-[var(--background)] text-[var(--muted)]'
                                  }`}>
                                    {expInfo.text}
                                  </span>
                                );
                              })()}
                            </div>
                            <span className="text-xs text-[var(--muted)]">
                              {formatTime(deposit.createdAt)}
                            </span>
                          </div>
                          {deposit.xmrDepositAddress ? (
                            <div className="mt-2">
                              <p className="text-xs text-[var(--muted)] mb-2 uppercase tracking-wide">Send XMR to:</p>
                              <div className="flex gap-2">
                                <code className="text-xs bg-[var(--card)] p-3 rounded-lg flex-1 break-all font-mono border border-[var(--border)] text-[#ff6600]">
                                  {deposit.xmrDepositAddress}
                                </code>
                                <button
                                  onClick={() => setQrAddress(deposit.xmrDepositAddress!)}
                                  className="p-3 bg-[var(--card)] hover:bg-[var(--card-hover)] border border-[var(--border)] hover:border-[#ff6600] rounded-lg transition-all flex-shrink-0"
                                  title="Show QR Code"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm text-[var(--muted)] mt-2 flex items-center gap-2">
                              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                              Waiting for address assignment...
                            </p>
                          )}
                          {deposit.amountDeposited > 0 && (
                            <p className="text-sm mt-3 pt-3 border-t border-[var(--border)]">
                              <span className="text-[var(--muted)]">Amount:</span>{' '}
                              <span className="font-bold text-[#ff6600]">{formatXmr(deposit.amountDeposited)} XMR</span>
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
                <div className="xmr-card p-6 xmr-glow">
                  <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
                    <svg className="w-5 h-5 text-[#ff6600]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                    </svg>
                    Withdraw XMR
                  </h2>
                  <p className="text-[var(--muted)] mb-6">
                    Burn wXMR and receive XMR at your specified address. Minimum: 0.001 XMR.
                  </p>
                  <div className="space-y-5">
                    <div>
                      <label className="block text-sm font-semibold mb-2 uppercase tracking-wide text-[var(--muted)]">Amount (XMR)</label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          step="0.000000000001"
                          min="0.001"
                          value={withdrawAmount}
                          onChange={(e) => setWithdrawAmount(e.target.value)}
                          placeholder="0.0"
                          className="xmr-input flex-1 px-4 py-3 text-white"
                        />
                        <button
                          onClick={() => setWithdrawAmount(formatXmr(wxmrBalance))}
                          className="px-5 py-3 bg-[var(--card)] hover:bg-[var(--card-hover)] border border-[var(--border)] hover:border-[#ff6600] rounded-lg text-sm font-semibold transition-all"
                        >
                          MAX
                        </button>
                      </div>
                      <p className="text-xs text-[var(--muted)] mt-2">
                        Available: <span className="text-[#ff6600] font-medium">{formatXmr(wxmrBalance)} wXMR</span>
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2 uppercase tracking-wide text-[var(--muted)]">XMR Address</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={xmrAddress}
                          onChange={(e) => setXmrAddress(e.target.value)}
                          placeholder="4... or 8..."
                          className="xmr-input flex-1 px-4 py-3 text-white font-mono text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => setShowScanner(true)}
                          className="px-4 py-3 bg-[var(--card)] hover:bg-[var(--card-hover)] border border-[var(--border)] hover:border-[#ff6600] rounded-lg transition-all flex-shrink-0"
                          title="Scan QR Code"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <button
                      onClick={handleWithdraw}
                      disabled={loading || !withdrawAmount || !xmrAddress}
                      className="xmr-btn-primary w-full text-white px-6 py-3.5 rounded-lg font-semibold"
                    >
                      {loading ? (
                        <span className="flex items-center justify-center gap-2">
                          <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Processing...
                        </span>
                      ) : 'Withdraw XMR'}
                    </button>
                  </div>
                </div>

                {/* Withdrawal History */}
                <div className="xmr-card p-6">
                  <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <svg className="w-5 h-5 text-[var(--muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    Your Withdrawals
                  </h2>
                  {withdrawals.length === 0 ? (
                    <div className="text-center py-8">
                      <div className="text-4xl mb-3 opacity-30">📤</div>
                      <p className="text-[var(--muted)]">No withdrawals yet</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {withdrawals.map((withdrawal) => (
                        <div
                          key={withdrawal.withdrawalPda}
                          className="bg-[var(--background)] rounded-lg p-4 border border-[var(--border)] hover:border-[#ff660033] transition-colors"
                        >
                          <div className="flex justify-between items-start mb-3">
                            <StatusBadge status={withdrawal.status} />
                            <span className="text-xs text-[var(--muted)]">
                              {formatTime(withdrawal.createdAt)}
                            </span>
                          </div>
                          <p className="text-xl font-bold text-[#ff6600]">
                            {formatXmr(withdrawal.amount)} <span className="text-sm font-normal text-[var(--muted)]">XMR</span>
                          </p>
                          <p className="text-xs text-[var(--muted)] mt-2 font-mono">
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
            <div className="mt-10 pt-6 border-t border-[var(--border)]">
              <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-[var(--muted)]">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span>Connected: <code className="text-[var(--foreground)]">{truncateAddress(publicKey?.toBase58() || '', 8)}</code></span>
                </div>
                {bridgeConfig && (
                  <p>
                    Bridge Authority: <code className="text-[var(--foreground)]">{truncateAddress(bridgeConfig.authority, 8)}</code>
                  </p>
                )}
              </div>
            </div>
          </>
        )}

        {/* QR Code Modal */}
        {qrAddress && (
          <QRCodeModal address={qrAddress} onClose={() => setQrAddress(null)} />
        )}

        {/* QR Scanner Modal */}
        {showScanner && (
          <QRScannerModal 
            onScan={(address) => setXmrAddress(address)} 
            onClose={() => setShowScanner(false)} 
          />
        )}

        {/* Global Footer */}
        <footer className="mt-16 pt-8 border-t border-[var(--border)]">
          {/* XMR Viewing Key - for verifying bridge reserves */}
          <div className="xmr-card p-6 mb-6 xmr-glow">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)] mb-4 flex items-center gap-2">
              <svg className="w-4 h-4 text-[#ff6600]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              XMR Viewing Key (Verify Reserves)
            </h3>
            <p className="text-xs text-[var(--muted)] mb-4">
              Use these credentials to verify the bridge&apos;s XMR reserves in any Monero wallet that supports view-only mode.
            </p>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-[var(--muted)] mb-1">XMR Address</p>
                <code className="text-xs font-mono text-[#ff6600] bg-[var(--background)] px-3 py-2 rounded-lg border border-[var(--border)] block break-all">
                  45ZYpKmPaPmh3bnRP1XpMz8cASJQf1cfUgq32H8trCYA4RodzXhsmt2VYkQX9QQ65CetiGja65tH2JmKC3gEZtZjB7AzMpd
                </code>
              </div>
              <div>
                <p className="text-xs text-[var(--muted)] mb-1">View Key</p>
                <code className="text-xs font-mono text-[var(--foreground)] bg-[var(--background)] px-3 py-2 rounded-lg border border-[var(--border)] block break-all">
                  e4e02de197582ff2e93f9eaefc96e122a13ffa838736ef38f4a8ea27a0dc4909
                </code>
              </div>
            </div>
          </div>

          {/* wXMR Token Info */}
          <div className="xmr-card p-6 mb-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)] mb-4">wXMR Token</h3>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-[var(--muted)] mb-1">Mint Address</p>
                <div className="flex items-center gap-2">
                  <code className="text-sm font-mono text-[#ff6600] bg-[var(--background)] px-3 py-2 rounded-lg border border-[var(--border)] flex-1 break-all">
                    WXMRyRZhsa19ety5erZhHg4N3xj3EVN92u94422teJp
                  </code>
                  <a
                    href="https://solscan.io/token/WXMRyRZhsa19ety5erZhHg4N3xj3EVN92u94422teJp"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 bg-[var(--card)] hover:bg-[var(--card-hover)] border border-[var(--border)] hover:border-[#ff6600] rounded-lg transition-all"
                    title="View on Solscan"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              </div>
              <div>
                <p className="text-xs text-[var(--muted)] mb-1">Bridge Program</p>
                <div className="flex items-center gap-2">
                  <code className="text-sm font-mono text-[var(--foreground)] bg-[var(--background)] px-3 py-2 rounded-lg border border-[var(--border)] flex-1 break-all">
                    EzBkC8P5wxab9kwrtV5hRdynHAfB5w3UPcPXNgMseVA8
                  </code>
                  <a
                    href="https://solscan.io/account/EzBkC8P5wxab9kwrtV5hRdynHAfB5w3UPcPXNgMseVA8"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 bg-[var(--card)] hover:bg-[var(--card-hover)] border border-[var(--border)] hover:border-[#ff6600] rounded-lg transition-all"
                    title="View on Solscan"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Links */}
          <div className="flex flex-wrap justify-center gap-6 mb-8">
<a
              href="https://getmonero.org"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[#ff6600] transition-colors"
            >
              <MoneroLogo className="w-4 h-4" />
              Monero
            </a>
            <a
              href="https://solana.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[#ff6600] transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 128 128" fill="currentColor">
                <path d="M93.94 42.63H13.78l20.22-20.22h80.16L93.94 42.63zM93.94 105.59H13.78l20.22-20.22h80.16L93.94 105.59zM34 74.11h80.16L93.94 53.89H13.78L34 74.11z"/>
              </svg>
              Solana
            </a>
          </div>

          {/* Bottom */}
          <div className="flex justify-center">
            <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <MoneroLogo className="w-4 h-4 opacity-50" />
              <span>Powered by Monero & Solana</span>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}

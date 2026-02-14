'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useWxmrBridge, DepositAccountInfo, WithdrawalInfo, BridgeConfig } from '@/hooks/useWxmrBridge';
import { QRCodeSVG } from 'qrcode.react';
import { SwapModal } from '@/components/SwapModal';

// Monero Logo SVG component (official logo from cryptologos.cc)
function MoneroLogo({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 3756.09 3756.49" xmlns="http://www.w3.org/2000/svg">
      <path d="M4128,2249.81C4128,3287,3287.26,4127.86,2250,4127.86S372,3287,372,2249.81,1212.76,371.75,2250,371.75,4128,1212.54,4128,2249.81Z" transform="translate(-371.96 -371.75)" fill="#fff"/>
      <path d="M2250,371.75c-1036.89,0-1879.12,842.06-1877.8,1878,0.26,207.26,33.31,406.63,95.34,593.12h561.88V1263L2250,2483.57,3470.52,1263v1579.9h562c62.12-186.48,95-385.85,95.37-593.12C4129.66,1212.76,3287,372,2250,372Z" transform="translate(-371.96 -371.75)" fill="#f26822"/>
      <path d="M1969.3,2764.17l-532.67-532.7v994.14H1029.38l-384.29.07c329.63,540.8,925.35,902.56,1604.91,902.56S3525.31,3766.4,3855,3225.6H3063.25V2231.47l-532.7,532.7-280.61,280.61-280.62-280.61h0Z" transform="translate(-371.96 -371.75)" fill="#4d4d4d"/>
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

// Truncate address for display
function truncateAddress(address: string, chars = 8): string {
  if (address.length <= chars * 2) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

// Status badge component
function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
    active: 'bg-green-500/20 text-green-400 border border-green-500/30',
    closed: 'bg-gray-500/20 text-gray-400 border border-gray-500/30',
    sending: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
    completed: 'bg-green-500/20 text-green-400 border border-green-500/30',
    reverted: 'bg-red-500/20 text-red-400 border border-red-500/30',
  };

  const labels: Record<string, string> = {
    pending: 'Pending',
    active: 'Active',
    closed: 'Closed',
    sending: 'Sending',
    completed: 'Completed',
    reverted: 'Reverted',
  };

  return (
    <span className={`xmr-badge ${colors[status] || 'bg-gray-500/20 text-gray-400 border border-gray-500/30'}`}>
      {labels[status] || status}
    </span>
  );
}

// QR Code Modal component
function QRCodeModal({ address, onClose }: { address: string; onClose: () => void }) {
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
          <code className="text-xs bg-[var(--background)] p-3 rounded-lg block break-all font-mono border border-[var(--border)] text-[#ff6600] select-all cursor-pointer">
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
  const stoppedRef = useRef(false);
  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  const [error, setError] = useState<string | null>(null);
  const [cameraUnavailable, setCameraUnavailable] = useState(false);
  const [isStarting, setIsStarting] = useState(true);

  // Keep refs up to date without restarting the scanner
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    let mounted = true;

    const startScanner = async () => {
      // Pre-check: camera API available?
      if (!navigator.mediaDevices?.getUserMedia) {
        if (mounted) {
          setIsStarting(false);
          setCameraUnavailable(true);
        }
        return;
      }

      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        
        if (!mounted || !scannerRef.current) return;

        const html5QrCode = new Html5Qrcode('qr-scanner-region');
        html5QrCodeRef.current = html5QrCode;

        // Race the start against a timeout — some in-app browsers hang
        const startPromise = html5QrCode.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
          },
          async (decodedText) => {
            if (stoppedRef.current) return;
            stoppedRef.current = true;

            let address = decodedText;
            if (decodedText.toLowerCase().startsWith('monero:')) {
              address = decodedText.slice(7).split('?')[0];
            }
            onScanRef.current(address);
            // Wait for the scanner to fully stop (releases camera & cleans up DOM)
            // BEFORE unmounting the component via onClose
            try { await html5QrCode.stop(); } catch { /* already stopped */ }
            onCloseRef.current();
          },
          () => {}
        );

        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 8000)
        );

        await Promise.race([startPromise, timeout]);

        if (mounted) {
          setIsStarting(false);
        }
      } catch (err: any) {
        if (mounted) {
          setIsStarting(false);
          if (err.message === 'timeout') {
            setCameraUnavailable(true);
          } else if (err.name === 'NotAllowedError') {
            setError('Camera access denied. Please allow camera access to scan QR codes.');
          } else if (err.name === 'NotFoundError' || err.name === 'NotReadableError') {
            setCameraUnavailable(true);
          } else {
            setCameraUnavailable(true);
          }
        }
      }
    };

    startScanner();

    return () => {
      mounted = false;
      if (html5QrCodeRef.current && !stoppedRef.current) {
        stoppedRef.current = true;
        html5QrCodeRef.current.stop().catch(() => {});
      }
    };
  }, []); // Run once on mount - callbacks accessed via stable refs

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = text.trim();
      if (trimmed) {
        let address = trimmed;
        if (trimmed.toLowerCase().startsWith('monero:')) {
          address = trimmed.slice(7).split('?')[0];
        }
        onScan(address);
        onClose();
      }
    } catch {
      // Clipboard API might not be available either; ignore
    }
  };

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
            {cameraUnavailable ? 'Enter XMR Address' : 'Scan XMR Address'}
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
        ) : cameraUnavailable ? (
          <div className="space-y-3">
            <p className="text-sm text-[var(--muted)]">
              Camera is not available in this browser. You can paste an address from your clipboard instead.
            </p>
            <button
              onClick={handlePasteFromClipboard}
              className="w-full py-3 bg-[#ff6600]/20 hover:bg-[#ff6600]/30 border border-[#ff6600]/40 text-[#ff6600] rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              Paste from Clipboard
            </button>
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
        
        {!cameraUnavailable && (
          <p className="text-xs text-[var(--muted)] mt-4 text-center">
            Point your camera at a Monero address QR code
          </p>
        )}
        
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

// Confirmation Modal component
function ConfirmModal({ 
  title, 
  message, 
  confirmText, 
  onConfirm, 
  onCancel 
}: { 
  title: string; 
  message: string; 
  confirmText: string; 
  onConfirm: () => void; 
  onCancel: () => void;
}) {
  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div 
        className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold mb-3">{title}</h3>
        <p className="text-[var(--muted)] mb-6">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 bg-[var(--background)] hover:bg-[var(--card-hover)] border border-[var(--border)] rounded-lg text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 rounded-lg text-sm font-medium transition-colors"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const {
    isConnected,
    publicKey,
    createDepositAccount,
    closeDepositAccount,
    fetchMyDepositAccount,
    requestWithdrawal,
    fetchMyWithdrawals,
    fetchBridgeConfig,
    getWxmrBalance,
    getPendingBalance,
    claimPendingMint,
  } = useWxmrBridge();

  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>('deposit');
  const [depositAccount, setDepositAccount] = useState<DepositAccountInfo | null>(null);
  const [withdrawals, setWithdrawals] = useState<WithdrawalInfo[]>([]);
  const [bridgeConfig, setBridgeConfig] = useState<BridgeConfig | null>(null);
  const [wxmrBalance, setWxmrBalance] = useState<bigint>(BigInt(0));
  const [pendingBalance, setPendingBalance] = useState<bigint>(BigInt(0));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Withdrawal form state
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [xmrAddress, setXmrAddress] = useState('');

  // Modal states
  const [qrAddress, setQrAddress] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showSwapModal, setShowSwapModal] = useState(false);
  const [copied, setCopied] = useState(false);

  // Load data — bridge config always, wallet-specific data only when connected
  const loadData = useCallback(async () => {
    try {
      // Bridge config can be fetched without a wallet
      const config = await fetchBridgeConfig();
      setBridgeConfig(config);

      if (!isConnected) return;

      // Wallet-specific data
      const [balance, pending, myDepositAccount, myWithdrawals] = await Promise.all([
        getWxmrBalance(),
        getPendingBalance(),
        fetchMyDepositAccount(),
        fetchMyWithdrawals(),
      ]);

      setWxmrBalance(balance);
      setPendingBalance(pending);
      setDepositAccount(myDepositAccount);
      setWithdrawals(myWithdrawals.sort((a, b) => b.createdAt - a.createdAt));
    } catch (err) {
      console.error('Error loading data:', err);
    }
  }, [isConnected, fetchBridgeConfig, getWxmrBalance, getPendingBalance, fetchMyDepositAccount, fetchMyWithdrawals]);

  // Reset wallet-specific state when disconnected
  useEffect(() => {
    if (!isConnected) {
      setWxmrBalance(BigInt(0));
      setPendingBalance(BigInt(0));
      setDepositAccount(null);
      setWithdrawals([]);
    }
  }, [isConnected]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Handle create deposit account
  const handleCreateDepositAccount = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await createDepositAccount();
      if (result) {
        setSuccess(`Deposit account created! TX: ${result.signature.slice(0, 20)}...`);
        await loadData();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create deposit account');
    } finally {
      setLoading(false);
    }
  };

  // Handle close deposit account
  const handleCloseDepositAccount = async () => {
    setShowCloseConfirm(false);
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const signature = await closeDepositAccount();
      if (signature) {
        setSuccess(`Deposit account closed! TX: ${signature.slice(0, 20)}... You can now create a new one for a fresh address.`);
        await loadData();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to close deposit account');
    } finally {
      setLoading(false);
    }
  };

  // Handle claim pending tokens
  const handleClaimPending = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const signature = await claimPendingMint();
      if (signature) {
        setSuccess(`Pending tokens claimed! TX: ${signature.slice(0, 20)}...`);
        await loadData();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to claim pending tokens');
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

        {/* Stats Cards — always visible */}
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

        {/* Pending Tokens Alert — only when connected and pending > 0 */}
        {isConnected && pendingBalance > BigInt(0) && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-yellow-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <p className="text-sm text-yellow-400 font-medium">
                  You have <span className="text-[#ff6600] font-bold">{formatXmr(pendingBalance)} wXMR</span> pending
                </p>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  These tokens were minted when you didn&apos;t have a token account. Click here to claim.
                </p>
              </div>
            </div>
            <button
              onClick={handleClaimPending}
              disabled={loading}
              className="px-4 py-2 bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/30 text-yellow-400 rounded-lg text-sm font-medium transition-colors flex-shrink-0"
            >
              {loading ? 'Claiming...' : 'Claim'}
            </button>
          </div>
        )}

        {/* Tab Navigation — always visible */}
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
          <button
            onClick={() => setShowSwapModal(true)}
            className="xmr-tab px-6 py-2.5 rounded-lg font-semibold transition-all bg-[var(--card)] text-[var(--muted)] hover:bg-[var(--card-hover)] hover:text-white border border-[var(--border)] flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            Swap
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
            {/* Deposit Section */}
            <div className="xmr-card p-6 xmr-glow">
              <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
                <svg className="w-5 h-5 text-[#ff6600]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
                Deposit XMR
              </h2>
              
              {!isConnected ? (
                // Not connected — prompt to connect
                <div className="text-center py-10">
                  <div className="flex justify-center mb-4">
                    <div className="relative">
                      <MoneroLogo className="w-16 h-16 xmr-pulse" />
                      <div className="absolute inset-0 bg-[#ff6600]/20 blur-2xl rounded-full" />
                    </div>
                  </div>
                  <p className="text-[var(--muted)] mb-6">Connect a Solana wallet to create a deposit account and start bridging XMR.</p>
                  <div className="inline-block">
                    <WalletMultiButton />
                  </div>
                </div>
              ) : !depositAccount ? (
                // No deposit account - show create button
                <>
                  <p className="text-[var(--muted)] mb-6">
                    Create a deposit account to get your permanent XMR deposit address. 
                    Minimum 0.01 XMR per transfer (and per input!). You can deposit any number of times.
                  </p>
                  <button
                    onClick={handleCreateDepositAccount}
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
                    ) : 'Create Deposit Account'}
                  </button>
                </>
              ) : depositAccount.status === 'pending' ? (
                // Deposit account pending - waiting for address assignment
                <>
                  <div className="flex items-center gap-2 mb-4">
                    <StatusBadge status="pending" />
                    <span className="text-sm text-[var(--muted)]">Created {formatTime(depositAccount.createdAt)}</span>
                  </div>
                  <p className="text-[var(--muted)] flex items-center gap-2">
                    <svg className="animate-spin w-5 h-5 text-[#ff6600]" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Waiting for XMR address assignment (usually takes a few seconds)...
                  </p>
                </>
              ) : depositAccount.status === 'active' ? (
                // Active deposit account - show address
                <>
                  <div className="flex items-center gap-2 mb-4">
                    <StatusBadge status="active" />
                    <span className="text-sm text-[var(--muted)]">
                      Total deposited: <span className="text-[#ff6600] font-medium">{formatXmr(depositAccount.totalDeposited)} XMR</span>
                    </span>
                  </div>
                  
                  <div className="bg-[var(--background)] rounded-xl p-4 border border-[var(--border)] mb-4">
                    <p className="text-xs text-[var(--muted)] mb-2 uppercase tracking-wide">Your Permanent XMR Deposit Address</p>
                    <div className="flex gap-2">
                      <code className="text-sm bg-[var(--card)] p-3 rounded-lg flex-1 break-all font-mono border border-[var(--border)] text-[#ff6600] select-all cursor-pointer">
                        {depositAccount.xmrDepositAddress}
                      </code>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(depositAccount.xmrDepositAddress);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                        className="p-3 bg-[var(--card)] hover:bg-[var(--card-hover)] border border-[var(--border)] hover:border-[#ff6600] rounded-lg transition-all flex-shrink-0"
                        title="Copy Address"
                      >
                        {copied ? (
                          <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        )}
                      </button>
                      <button
                        onClick={() => setQrAddress(depositAccount.xmrDepositAddress)}
                        className="p-3 bg-[var(--card)] hover:bg-[var(--card-hover)] border border-[var(--border)] hover:border-[#ff6600] rounded-lg transition-all flex-shrink-0"
                        title="Show QR Code"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 mb-4">
                    <p className="text-sm text-green-400">
                      <strong>Minimum 0.01 XMR per transfer.</strong> Once confirmed (10 blocks), 
                      wXMR will be automatically minted to your wallet. You can deposit multiple times.
                    </p>
                  </div>

                  <div className="pt-4 border-t border-[var(--border)]">
                    <p className="text-xs text-[var(--muted)] mb-2">
                      Need a new address for privacy? Close this account to get a fresh one.
                    </p>
                    <button
                      onClick={() => setShowCloseConfirm(true)}
                      disabled={loading}
                      className="text-sm text-red-400 hover:text-red-300 transition-colors"
                    >
                      Close deposit account
                    </button>
                  </div>
                </>
              ) : (
                // Closed account - shouldn't happen (account is deleted)
                <p className="text-[var(--muted)]">Account closed. Create a new one to deposit.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Withdraw Section */}
            <div className="xmr-card p-6 xmr-glow">
              <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
                <svg className="w-5 h-5 text-[#ff6600]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
                Withdraw XMR
              </h2>

              {!isConnected ? (
                // Not connected — prompt to connect
                <div className="text-center py-10">
                  <div className="flex justify-center mb-4">
                    <div className="relative">
                      <MoneroLogo className="w-16 h-16 xmr-pulse" />
                      <div className="absolute inset-0 bg-[#ff6600]/20 blur-2xl rounded-full" />
                    </div>
                  </div>
                  <p className="text-[var(--muted)] mb-6">Connect a Solana wallet to withdraw XMR.</p>
                  <div className="inline-block">
                    <WalletMultiButton />
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-[var(--muted)] mb-6">
                    Burn wXMR and receive XMR at your specified address. Minimum: 0.01 XMR.
                  </p>
                  <div className="space-y-5">
                    <div>
                      <label className="block text-sm font-semibold mb-2 uppercase tracking-wide text-[var(--muted)]">Amount (XMR)</label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          step="0.000000000001"
                          min="0.01"
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
                </>
              )}
            </div>

            {/* Withdrawal History — only when connected */}
            {isConnected && (
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
            )}
          </div>
        )}

        {/* Footer Info — always visible */}
        <div className="mt-10 pt-6 border-t border-[var(--border)]">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-[var(--muted)]">
            {isConnected ? (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span>Connected: <code className="text-[var(--foreground)]">{truncateAddress(publicKey?.toBase58() || '', 8)}</code></span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-gray-500" />
                <span>Wallet not connected</span>
              </div>
            )}
            {bridgeConfig && (
              <p>
                Bridge Authority: <code className="text-[var(--foreground)]">{truncateAddress(bridgeConfig.authority, 8)}</code>
              </p>
            )}
          </div>
        </div>

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

        {/* Close Deposit Account Confirmation Modal */}
        {showCloseConfirm && (
          <ConfirmModal
            title="Close Deposit Account?"
            message="WARNING: Any XMR sent to this address that hasn't been minted yet will be LOST. Only close if you're sure no deposits are pending. You can create a new account with a fresh XMR address."
            confirmText="Close Account"
            onConfirm={handleCloseDepositAccount}
            onCancel={() => setShowCloseConfirm(false)}
          />
        )}

        {/* Swap Modal */}
        <SwapModal isOpen={showSwapModal} onClose={() => setShowSwapModal(false)} />

        {/* Global Footer */}
        <footer className="mt-16 pt-8 border-t border-[var(--border)]">
          {/* Transparency Link */}
          <div className="xmr-card p-6 mb-6 xmr-glow">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <svg className="w-6 h-6 text-[#ff6600]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <div>
                  <h3 className="font-semibold">Verify Our Reserves</h3>
                  <p className="text-sm text-[var(--muted)]">View key, tx proofs, and on-chain data</p>
                </div>
              </div>
              <Link
                href="/transparency"
                className="px-5 py-2.5 bg-[var(--background)] hover:bg-[var(--card-hover)] border border-[var(--border)] hover:border-[#ff6600] rounded-lg text-sm font-medium transition-all flex items-center gap-2"
              >
                Transparency
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
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
            <Link
              href="/transparency"
              className="flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[#ff6600] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              Transparency
            </Link>
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

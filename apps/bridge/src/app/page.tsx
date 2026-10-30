"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  useWxmrBridge,
  DepositAccountInfo,
  WithdrawalInfo,
  BridgeConfig,
} from "@/hooks/useWxmrBridge";
import { CancelWithdrawalButton } from "@/components/CancelWithdrawalButton";
import { QRCodeSVG } from "qrcode.react";
import { CopyAddress } from "@wxmr/shared";
import { BridgeShell, WalletButton } from "@/components/BridgeShell";
import { Icon, TokenIcon } from "@/components/BridgeIcons";
import { MoneroQrScanner } from "@/components/MoneroQrScanner";
import { BridgeDialog } from "@/components/BridgeDialog";
import { BridgeStatus } from "@/components/BridgeStatus";
import { compactXmr, ReserveOverview } from "@/components/ReserveOverview";
import { JupiterSwap } from "@/components/JupiterSwap";
import {
  PICONERO_PER_XMR,
  MIN_XMR_DEPOSIT_PICONERO,
  MIN_XMR_WITHDRAWAL_PICONERO,
  XMR_DEPOSIT_DUST_PICONERO,
  formatXmrAmount,
  validateMoneroAddress,
} from "@wxmr/core";

const BASIS_POINTS = BigInt(10000);
const DEPOSIT_FEE_BPS = 10;
const WITHDRAW_FEE_BPS = 10;
const TRANSFER_TABS = ["deposit", "withdraw", "swap"] as const;
type TransferTab = (typeof TRANSFER_TABS)[number];
const MIN_WITHDRAW_XMR = formatXmrAmount(MIN_XMR_WITHDRAWAL_PICONERO);
const MIN_DEPOSIT_XMR = formatXmrAmount(MIN_XMR_DEPOSIT_PICONERO);
const DEPOSIT_DUST_XMR = formatXmrAmount(XMR_DEPOSIT_DUST_PICONERO);
const DEPOSIT_FEE_PERCENT = formatFeePercent(DEPOSIT_FEE_BPS);

// Format piconero to XMR (12 decimal places)
function formatXmr(piconero: bigint): string {
  const whole = (piconero / PICONERO_PER_XMR).toLocaleString("en-US");
  const fraction = (piconero % PICONERO_PER_XMR)
    .toString()
    .padStart(12, "0")
    .replace(/0+$/, "")
    .padEnd(4, "0");
  return `${whole}.${fraction}`;
}

function parseXmrToPiconero(amount: string): bigint | null {
  const trimmed = amount.trim();
  const match = trimmed.match(/^(?:(\d+)(?:\.(\d{0,12})?)?|\.(\d{1,12}))$/);
  if (!match) return null;

  const whole = match[1] ?? "0";
  const fractional = match[2] ?? match[3] ?? "";
  return (
    BigInt(whole) * PICONERO_PER_XMR + BigInt(fractional.padEnd(12, "0") || "0")
  );
}

function formatFeePercent(feeBps: number): string {
  const percent = feeBps / 100;
  return `${percent.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}%`;
}

function calculateWithdrawalFee(amount: bigint, feeBps: number): bigint {
  if (amount <= BigInt(0) || feeBps <= 0) return BigInt(0);

  return (amount * BigInt(feeBps)) / BASIS_POINTS;
}

function getGrossAmountForExactReceive(
  receiveAmount: bigint,
  feeBps: number,
): bigint | null {
  if (receiveAmount <= BigInt(0)) return null;
  if (feeBps <= 0) return receiveAmount;

  const feeBpsBigInt = BigInt(feeBps);
  const netBps = BASIS_POINTS - feeBpsBigInt;
  if (netBps <= BigInt(0)) return null;

  let grossAmount =
    (receiveAmount * BASIS_POINTS + netBps - BigInt(1)) / netBps;

  while (grossAmount > BigInt(0)) {
    const netAmount = grossAmount - calculateWithdrawalFee(grossAmount, feeBps);
    if (netAmount <= receiveAmount) break;
    grossAmount -= BigInt(1);
  }

  while (
    grossAmount - calculateWithdrawalFee(grossAmount, feeBps) <
    receiveAmount
  ) {
    grossAmount += BigInt(1);
  }

  return grossAmount;
}

function getWithdrawalPreview(
  amount: bigint | null,
  exactOut: boolean,
  feeBps: number,
) {
  if (amount === null || amount <= BigInt(0)) return null;

  if (exactOut) {
    const debitAmount = getGrossAmountForExactReceive(amount, feeBps);
    if (debitAmount === null) return null;

    return {
      requestAmount: amount,
      burnAmount: debitAmount,
      receiveAmount: amount,
      feeAmount: debitAmount - amount,
    };
  }

  const feeAmount = calculateWithdrawalFee(amount, feeBps);

  return {
    requestAmount: amount,
    burnAmount: amount,
    receiveAmount: amount > feeAmount ? amount - feeAmount : BigInt(0),
    feeAmount,
  };
}

function getMaxExactReceiveAmount(balance: bigint, feeBps: number): bigint {
  if (balance <= BigInt(0)) return BigInt(0);
  if (feeBps <= 0) return balance;
  if (BigInt(feeBps) >= BASIS_POINTS) return BigInt(0);

  return balance - calculateWithdrawalFee(balance, feeBps);
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

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

// QR Code Modal component
function QRCodeModal({
  address,
  onClose,
}: {
  address: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
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
            <TokenIcon token="xmr" className="w-5 h-5" />
            Native XMR Bridge Address
          </h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--background)] rounded-lg transition-colors"
            aria-label="Close"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
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
          <p className="text-xs text-[var(--muted)] mb-2 uppercase tracking-wide">
            Address
          </p>
          <CopyAddress
            address={address}
            label="XMR bridge address"
            className="text-xs bg-[var(--background)] p-3 rounded-lg block break-all font-mono border border-[var(--border)] text-[#ff6600] w-full"
          >
            {address}
          </CopyAddress>
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

export default function Home() {
  const {
    isConnected,
    isWalletConnecting,
    publicKey,
    createDepositAccount,
    requestWithdrawal,
    cancelWithdrawal,
    discoverMyWithdrawals,
    fetchPageSnapshot,
    claimPendingMint,
  } = useWxmrBridge();

  const [activeTab, setActiveTab] = useState<TransferTab>("deposit");
  const [depositAccount, setDepositAccount] =
    useState<DepositAccountInfo | null>(null);
  const [withdrawals, setWithdrawals] = useState<WithdrawalInfo[]>([]);
  const [bridgeConfig, setBridgeConfig] = useState<BridgeConfig | null>(null);
  const [circulatingSupply, setCirculatingSupply] = useState<bigint>(BigInt(0));
  const [wxmrBalance, setWxmrBalance] = useState<bigint>(BigInt(0));
  const [pendingBalance, setPendingBalance] = useState<bigint>(BigInt(0));
  const [loading, setLoading] = useState(false);
  const [cancelingWithdrawal, setCancelingWithdrawal] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectTab = (tab: TransferTab) => {
    setActiveTab(tab);
    setError(null);
    const hash = tab === "deposit" ? "" : `#${tab}`;
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}${hash}`,
    );
  };

  useEffect(() => {
    const readTab = () => {
      const hash = window.location.hash;
      setActiveTab(hash === "#swap" ? "swap" : hash === "#withdraw" ? "withdraw" : "deposit");
    };
    readTab();
    window.addEventListener("hashchange", readTab);
    return () => window.removeEventListener("hashchange", readTab);
  }, []);

  // Withdrawal form state
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [xmrAddress, setXmrAddress] = useState("");
  const [withdrawExactOut, setWithdrawExactOut] = useState(false);
  const withdrawFeeBps = WITHDRAW_FEE_BPS;
  const withdrawFeePercent = formatFeePercent(withdrawFeeBps);
  const parsedWithdrawAmount = parseXmrToPiconero(withdrawAmount);
  const withdrawPreview = getWithdrawalPreview(
    parsedWithdrawAmount,
    withdrawExactOut,
    withdrawFeeBps,
  );
  const maxWithdrawAmount = withdrawExactOut
    ? getMaxExactReceiveAmount(wxmrBalance, withdrawFeeBps)
    : wxmrBalance;
  const isWithdrawAmountBelowMinimum =
    parsedWithdrawAmount !== null &&
    parsedWithdrawAmount > BigInt(0) &&
    parsedWithdrawAmount < MIN_XMR_WITHDRAWAL_PICONERO;
  const isWithdrawAmountOverBalance =
    withdrawPreview !== null && withdrawPreview.burnAmount > wxmrBalance;
  // Same validation the on-chain program runs (base58, checksum, network tag,
  // ed25519 keys) so a bad address never reaches the Solana network.
  const trimmedXmrAddress = xmrAddress.trim();
  const xmrAddressValidation = trimmedXmrAddress
    ? validateMoneroAddress(trimmedXmrAddress)
    : null;
  const canRequestWithdrawal =
    !loading &&
    isConnected &&
    Boolean(withdrawAmount) &&
    xmrAddressValidation?.valid === true &&
    parsedWithdrawAmount !== null &&
    withdrawPreview !== null &&
    parsedWithdrawAmount >= MIN_XMR_WITHDRAWAL_PICONERO &&
    !isWithdrawAmountOverBalance;

  // Modal states
  const [qrAddress, setQrAddress] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [dataReady, setDataReady] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [refreshingData, setRefreshingData] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const loadRequestRef = useRef(0);
  const historyRequestRef = useRef(0);
  const [dataError, setDataError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<string | null | undefined>(
    undefined,
  );
  const [historyThrough, setHistoryThrough] = useState<number | null>(null);

  // Load data — bridge config always, wallet-specific data only when connected
  const loadData = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setRefreshingData(true);

    try {
      const snapshot = await fetchPageSnapshot();

      if (requestId !== loadRequestRef.current) return;

      setDataError(null);
      setDataReady(true);
      setLastSynced(new Date());
      setBridgeConfig(snapshot.bridgeConfig);
      setCirculatingSupply(snapshot.circulatingSupply);
      setWxmrBalance(snapshot.wxmrBalance);
      setPendingBalance(snapshot.pendingBalance);
      setDepositAccount(snapshot.depositAccount);
      setWithdrawals(
        snapshot.withdrawals.sort((a, b) => b.createdAt - a.createdAt),
      );
    } catch (err) {
      if (requestId === loadRequestRef.current)
        setDataError(getErrorMessage(err, "Unable to refresh bridge balances"));
      console.error("Error loading data:", err);
    } finally {
      if (requestId === loadRequestRef.current) setRefreshingData(false);
    }
  }, [fetchPageSnapshot]);

  // Invalidate old wallet requests on both disconnect and account switches.
  useEffect(() => {
    const loadRequests = loadRequestRef;
    const historyRequests = historyRequestRef;
    setDataReady(false);
    setLastSynced(null);
    setReviewOpen(false);
    setWxmrBalance(BigInt(0));
    setPendingBalance(BigInt(0));
    setDepositAccount(null);
    setWithdrawals([]);
    setHistoryCursor(undefined);
    setHistoryThrough(null);
    setHistoryLoading(false);
    return () => {
      loadRequests.current++;
      historyRequests.current++;
    };
  }, [publicKey]);

  const loadOlderWithdrawals = async () => {
    const requestId = ++historyRequestRef.current;
    setHistoryLoading(true);
    setError(null);
    try {
      const page = await discoverMyWithdrawals(historyCursor || undefined);
      if (requestId !== historyRequestRef.current) return;
      setHistoryCursor(page.nextCursor);
      setHistoryThrough(page.searchedThrough);
      await loadData();
    } catch (err) {
      if (requestId === historyRequestRef.current)
        setError(getErrorMessage(err, "Unable to load earlier transfers"));
    } finally {
      if (requestId === historyRequestRef.current) setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (isWalletConnecting) return;

    const timeout = window.setTimeout(loadData, isConnected ? 0 : 150);
    return () => window.clearTimeout(timeout);
  }, [isConnected, isWalletConnecting, loadData]);

  // Handle create deposit account
  const handleCreateDepositAccount = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await createDepositAccount();
      if (result) {
        setSuccess(
          `Bridge address created! TX: ${result.signature.slice(0, 20)}...`,
        );
        await loadData();
      }
    } catch (err) {
      setError(getErrorMessage(err, "Failed to create bridge address"));
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
    } catch (err) {
      setError(getErrorMessage(err, "Failed to claim pending tokens"));
    } finally {
      setLoading(false);
    }
  };

  const handleCancelWithdrawal = async (withdrawal: WithdrawalInfo) => {
    if (loading) return;
    setLoading(true);
    setCancelingWithdrawal(withdrawal.withdrawalPda);
    setError(null);
    setSuccess(null);
    try {
      const result = await cancelWithdrawal(withdrawal.withdrawalPda);
      setSuccess(
        `Withdrawal canceled. ${formatXmr(result.refundAmount)} wXMR returned; the original bridge fee was retained. TX: ${result.signature}`,
      );
      await loadData();
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Unable to confirm cancellation. Refresh status before trying again.",
        ),
      );
      await loadData();
    } finally {
      setLoading(false);
      setCancelingWithdrawal(null);
    }
  };

  // Handle withdrawal request
  const handleWithdraw = async () => {
    const destination = xmrAddress.trim();
    if (!withdrawAmount || !destination) {
      setError("Please enter amount and Monero destination address");
      return;
    }

    // Run the exact validation the on-chain program performs, so an address it
    // would reject never gets submitted to the Solana network.
    const addressValidation = validateMoneroAddress(destination);
    if (!addressValidation.valid) {
      setError(`Invalid Monero address: ${addressValidation.reason}`);
      return;
    }

    const amountPiconero = parseXmrToPiconero(withdrawAmount);
    if (amountPiconero === null || amountPiconero <= BigInt(0)) {
      setError("Invalid amount");
      return;
    }

    const preview = getWithdrawalPreview(
      amountPiconero,
      withdrawExactOut,
      withdrawFeeBps,
    );
    if (!preview) {
      setError("Invalid amount");
      return;
    }

    if (amountPiconero < MIN_XMR_WITHDRAWAL_PICONERO) {
      setError(`Minimum Solana to Monero transfer is ${MIN_WITHDRAW_XMR} XMR`);
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      if (preview.burnAmount > wxmrBalance) {
        throw new Error("Insufficient XMR balance");
      }

      const result = await requestWithdrawal(
        preview.requestAmount,
        destination,
        withdrawExactOut,
      );
      if (result) {
        setSuccess(
          `Solana to Monero bridge request created! TX: ${result.signature.slice(0, 20)}...`,
        );
        setWithdrawAmount("");
        setXmrAddress("");
        await loadData();
      }
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Failed to create Solana to Monero bridge request",
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <BridgeShell
      activeView={activeTab === "swap" ? "swap" : "bridge"}
      onViewChange={(view) => selectTab(view === "swap" ? "swap" : "deposit")}
    >
      <main id="main" className="bridge-main bridge-home">
        <h1 className="sr-only">Bridge Monero and wrapped XMR on Solana</h1>
        <div className="balance-cards">
          <section
            className="xmr-card xmr-stat-card balance-card"
            aria-label="Your wXMR balance"
          >
            <p>YOUR SOLANA XMR BALANCE</p>
            <strong
              className="wallet-balance"
              title={isConnected && dataReady ? `${formatXmr(wxmrBalance)} wXMR` : undefined}
            >
              {isConnected ? dataReady ? compactXmr(wxmrBalance) : "—" : "0.0000"}
            </strong>
            <span>wXMR on Solana</span>
          </section>
          <section
            className="xmr-card xmr-stat-card balance-card"
            aria-label="Circulating supply"
          >
            <p>CIRCULATING SUPPLY</p>
            <strong title={dataReady ? `${formatXmr(circulatingSupply)} wXMR` : undefined}>
              {dataReady ? compactXmr(circulatingSupply) : "—"}
            </strong>
            <span>wXMR on Solana</span>
          </section>
        </div>
        <div
          className="direction-selector"
          role="tablist"
          aria-label="Transfer type"
          onKeyDown={(event) => {
            const index = TRANSFER_TABS.indexOf(activeTab);
            const next = event.key === "ArrowRight"
              ? TRANSFER_TABS[(index + 1) % TRANSFER_TABS.length]
              : event.key === "ArrowLeft"
                ? TRANSFER_TABS[(index + TRANSFER_TABS.length - 1) % TRANSFER_TABS.length]
                : event.key === "Home"
                  ? "deposit"
                  : event.key === "End" ? "swap" : null;
            if (next) {
              event.preventDefault();
              selectTab(next);
              document.getElementById(`tab-${next}`)?.focus();
            }
          }}
        >
          <button
            id="tab-deposit"
            type="button"
            role="tab"
            className={activeTab === "deposit" ? "selected" : ""}
            aria-selected={activeTab === "deposit"}
            aria-controls="bridge-panel"
            tabIndex={activeTab === "deposit" ? 0 : -1}
            onClick={() => selectTab("deposit")}
          >
            <span>Monero → Solana</span>
            <small>Fee: {DEPOSIT_FEE_PERCENT}</small>
          </button>
          <button
            id="tab-withdraw"
            type="button"
            role="tab"
            className={activeTab === "withdraw" ? "selected" : ""}
            aria-selected={activeTab === "withdraw"}
            aria-controls="bridge-panel"
            tabIndex={activeTab === "withdraw" ? 0 : -1}
            onClick={() => selectTab("withdraw")}
          >
            <span>Solana → Monero</span>
            <small>Fee: {withdrawFeePercent}</small>
          </button>
          <button
            id="tab-swap"
            type="button"
            role="tab"
            className={`swap-tab ${activeTab === "swap" ? "selected" : ""}`}
            aria-selected={activeTab === "swap"}
            aria-controls="swap-panel"
            tabIndex={activeTab === "swap" ? 0 : -1}
            onClick={() => selectTab("swap")}
          >
            <Icon name="switch" />
            Swap
          </button>
        </div>
        <div
          id="bridge-panel"
          className="bridge-workspace"
          role="tabpanel"
          aria-labelledby={activeTab === "withdraw" ? "tab-withdraw" : "tab-deposit"}
          hidden={activeTab === "swap"}
        >
          <section
            className={`transfer-card ${!isConnected ? "wallet-disconnected" : ""} ${activeTab === "deposit" ? "deposit-card" : "withdraw-card"}`}
            aria-labelledby="bridge-title"
          >
            <div className="card-heading">
              <h2 id="bridge-title">
                <Icon name="arrow" />
                {activeTab === "deposit" ? "Bridge to Solana" : "Bridge to Monero"}
              </h2>
            </div>
            {activeTab === "deposit" ? (
              <div className="deposit-introduction">
                {!isConnected ? (
                  <TokenIcon token="xmr" className="deposit-connect-logo" />
                ) : (
                  <>
                    <div className="deposit-route">
                      <div>
                        <TokenIcon token="xmr" />
                        <strong>XMR</strong>
                        <span>Monero</span>
                      </div>
                      <span className="route-line">
                        <Icon name="arrow" />
                      </span>
                      <div>
                        <TokenIcon token="wxmr" />
                        <strong>wXMR</strong>
                        <span>Solana</span>
                      </div>
                    </div>
                    <h3>Your Monero. On Solana.</h3>
                  </>
                )}
                <p>
                  {!isConnected ? (
                    "Connect a Solana wallet to bridge native XMR onto Solana."
                  ) : (
                    <>
                      Send native XMR to your reusable deposit address.
                      <br />
                      Receive wXMR in your connected Solana wallet.
                    </>
                  )}
                </p>
              </div>
            ) : (
              <>
                <div className="amount-stack">
                  <div
                    className={`amount-field ${withdrawExactOut ? "computed-field" : "editable-field"}`}
                  >
                    <div className="amount-caption">
                      <label htmlFor="bridge-amount">You send</label>
                      <span>
                        {isConnected && dataReady ? (
                          <>
                            Balance: {formatXmr(wxmrBalance)}{" "}
                            <button
                              className="max-button"
                              onClick={() =>
                                setWithdrawAmount(
                                  formatXmrAmount(maxWithdrawAmount),
                                )
                              }
                            >
                              MAX
                            </button>
                          </>
                        ) : (
                          "From your Solana wallet"
                        )}
                      </span>
                    </div>
                    <div className="amount-entry">
                      <input
                        id="bridge-amount"
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="0.00"
                        aria-label="wXMR amount you send"
                        value={
                          withdrawExactOut
                            ? withdrawPreview
                              ? formatXmrAmount(withdrawPreview.burnAmount)
                              : ""
                            : withdrawAmount
                        }
                        readOnly={withdrawExactOut}
                        onChange={(event) => {
                          if (!withdrawExactOut)
                            setWithdrawAmount(event.target.value);
                        }}
                      />
                      <span className="asset-pill">
                        <TokenIcon token="wxmr" />
                        wXMR<small>Solana</small>
                      </span>
                    </div>
                  </div>
                  <div className="amount-connector">
                    <Icon name="arrow" />
                  </div>
                  <div
                    className={`amount-field receive-field ${withdrawExactOut ? "editable-field" : "computed-field"}`}
                  >
                    <div className="amount-caption">
                      <label htmlFor="bridge-receive-amount">You receive</label>
                      <span>On Monero</span>
                    </div>
                    <div className="amount-entry">
                      <input
                        id="bridge-receive-amount"
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="0.00"
                        aria-label="XMR amount you receive"
                        value={
                          withdrawExactOut
                            ? withdrawAmount
                            : withdrawPreview
                              ? formatXmrAmount(withdrawPreview.receiveAmount)
                              : ""
                        }
                        readOnly={!withdrawExactOut}
                        onChange={(event) => {
                          if (withdrawExactOut)
                            setWithdrawAmount(event.target.value);
                        }}
                      />
                      <span className="asset-pill">
                        <TokenIcon token="xmr" />
                        XMR<small>Monero</small>
                      </span>
                    </div>
                  </div>
                </div>
                <div className="amount-hint">
                  <label className="exact-receive">
                    <input
                      type="checkbox"
                      checked={withdrawExactOut}
                      onChange={(event) => {
                        const exact = event.target.checked;
                        if (withdrawPreview)
                          setWithdrawAmount(
                            formatXmrAmount(
                              exact
                                ? withdrawPreview.receiveAmount
                                : withdrawPreview.burnAmount,
                            ),
                          );
                        setWithdrawExactOut(exact);
                      }}
                    />
                    Set the exact XMR amount to receive
                  </label>
                </div>
                {isWithdrawAmountBelowMinimum && (
                  <p className="field-error">
                    Minimum withdrawal {MIN_WITHDRAW_XMR} XMR.
                  </p>
                )}
                {withdrawAmount && parsedWithdrawAmount === null && (
                  <p className="field-error">
                    Enter a valid amount with up to 12 decimal places.
                  </p>
                )}
                {isConnected && dataReady && isWithdrawAmountOverBalance && (
                  <p className="field-error">
                    The amount and fee exceed your available wXMR balance.
                  </p>
                )}
              </>
            )}
            {activeTab === "withdraw" && (
              <div className="destination-field">
                <label className="field-label" htmlFor="xmr-destination">
                  Monero destination
                </label>
                <div className="destination-input">
                  <input
                    id="xmr-destination"
                    placeholder="Enter your Monero address"
                    value={xmrAddress}
                    onChange={(e) => setXmrAddress(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    onClick={() => setShowScanner(true)}
                    aria-label="Scan a Monero destination QR code"
                  >
                    <Icon name="qr" />
                  </button>
                </div>
                {xmrAddressValidation && (
                  <p
                    className={
                      xmrAddressValidation.valid ? "field-valid" : "field-error"
                    }
                  >
                    {xmrAddressValidation.valid
                      ? "Valid Monero address"
                      : `Invalid Monero address: ${xmrAddressValidation.reason}`}
                  </p>
                )}
              </div>
            )}
            <dl className="fee-breakdown">
              <div>
                <dt>
                  Bridge fee{" "}
                  {activeTab === "withdraw" && (
                    <span>({withdrawFeePercent})</span>
                  )}
                </dt>
                <dd>
                  {activeTab === "deposit"
                    ? `${DEPOSIT_FEE_PERCENT} in wXMR`
                    : `${withdrawPreview ? formatXmr(withdrawPreview.feeAmount) : "—"} wXMR`}
                </dd>
              </div>
              {activeTab === "deposit" && (
                <div>
                  <dt>Minimum deposit</dt>
                  <dd>{MIN_DEPOSIT_XMR} XMR</dd>
                </div>
              )}
              <div>
                <dt>
                  {activeTab === "deposit"
                    ? "Minting starts after"
                    : "Minimum withdrawal"}
                </dt>
                <dd>
                  {activeTab === "deposit"
                    ? "10 Monero confirmations"
                    : `${MIN_WITHDRAW_XMR} XMR`}
                </dd>
              </div>
            </dl>
            {dataError && (
              <div className="notice error-notice" role="alert">
                <Icon name="info" />
                <p>Balance data unavailable. {dataError}</p>
                <button className="text-button" onClick={() => void loadData()}>
                  Retry
                </button>
              </div>
            )}
            {error && (
              <div className="notice error-notice" role="alert">
                <Icon name="info" />
                <p>{error}</p>
                <button
                  onClick={() => setError(null)}
                  aria-label="Dismiss error"
                >
                  <Icon name="close" />
                </button>
              </div>
            )}
            {success && (
              <div className="notice success-notice" role="status">
                <Icon name="check" />
                <p>{success}</p>
              </div>
            )}
            {!isConnected ? (
              <div className="connect-action">
                <WalletButton />
                <p>Connect a Solana wallet to continue.</p>
              </div>
            ) : activeTab === "deposit" ? (
              <>
                {!dataReady ? (
                  <button
                    className="primary-button"
                    disabled={!dataError}
                    onClick={() => void loadData()}
                  >
                    {dataError
                      ? "Retry loading your deposit address"
                      : "Loading your deposit address…"}
                  </button>
                ) : !depositAccount ? (
                  <>
                    <button
                      className="primary-button"
                      disabled={loading}
                      onClick={handleCreateDepositAccount}
                    >
                      {loading
                        ? "Confirm in your wallet…"
                        : "Create deposit address"}
                      <Icon name="arrow" />
                    </button>
                    <p className="action-footnote">
                      One address, reusable for future deposits. Solana network
                      and account creation costs are shown in your wallet.
                    </p>
                  </>
                ) : depositAccount.status === "pending" ? (
                  <div className="address-pending">
                    <span className="spinner" />
                    <div>
                      <strong>Getting your Monero address ready</strong>
                      <p>This usually takes a few seconds. Refresh to check.</p>
                    </div>
                    <button
                      className="icon-button"
                      onClick={() => void loadData()}
                      aria-label="Refresh deposit address"
                    >
                      <Icon name="refresh" />
                    </button>
                  </div>
                ) : (
                  <div className="deposit-address-box">
                    <div className="section-label">
                      <span className="status-dot" />
                      Your reusable Monero address
                    </div>
                    <CopyAddress
                      address={depositAccount.xmrDepositAddress}
                      label="Monero deposit address"
                      className="deposit-address"
                    />
                    <div className="address-actions">
                      <CopyAddress
                        address={depositAccount.xmrDepositAddress}
                        label="Monero deposit address"
                        className="secondary-button"
                      >
                        <Icon name="copy" />
                        Copy address
                      </CopyAddress>
                      <button
                        className="secondary-button"
                        onClick={() =>
                          setQrAddress(depositAccount.xmrDepositAddress)
                        }
                      >
                        <Icon name="qr" />
                        Show QR
                      </button>
                    </div>
                    <p>
                      Send native XMR to this address. Each eligible deposit
                      mints automatically after 10 confirmations. Transfers
                      under {DEPOSIT_DUST_XMR} XMR per transfer or input are
                      ignored as dust.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <>
                <button
                  className="primary-button"
                  disabled={!canRequestWithdrawal || !dataReady}
                  onClick={() => setReviewOpen(true)}
                >
                  {loading ? "Confirming withdrawal…" : "Review withdrawal"}
                  <Icon name="arrow" />
                </button>
                <p className="action-footnote">
                  The bridge fee is paid in wXMR. Solana network costs are
                  separate and shown in your wallet.
                </p>
              </>
            )}
            <div className="card-bottom-note">
              <Icon name="shield" />
              {activeTab === "deposit"
                ? "0.1% minted to the fee treasury. 99.9% to you."
                : "Review your destination before signing."}
            </div>
          </section>
        </div>
        <div
          id="swap-panel"
          className="swap-workspace"
          role="tabpanel"
          aria-labelledby="tab-swap"
          hidden={activeTab !== "swap"}
        >
          <JupiterSwap active={activeTab === "swap"} onSwapConfirmed={loadData} />
        </div>
        <BridgeStatus owner={publicKey?.toBase58()} />
        <div className={`workspace-sidebar ${activeTab === "swap" ? "swap-view" : ""}`}>
          <ReserveOverview supply={circulatingSupply} ready={dataReady} />
          {activeTab !== "swap" && <div className="journey-panel">
            <div className="section-label">A SIMPLE PATH ACROSS</div>
            <ol>
              <li>
                <span>01</span>
                <div>
                  <strong>
                    {activeTab === "deposit"
                      ? "Connect & get an address"
                      : "Choose your amount"}
                  </strong>
                  <p>
                    {activeTab === "deposit"
                      ? "Use your Solana wallet to create a reusable Monero deposit address."
                      : "Enter the wXMR to send, or the exact XMR you want to receive."}
                  </p>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <strong>
                    {activeTab === "deposit"
                      ? "Send native XMR"
                      : "Review & sign"}
                  </strong>
                  <p>
                    {activeTab === "deposit"
                      ? "Deposit at least 0.1 XMR. Wait for 10 Monero confirmations."
                      : "Confirm your Monero destination and approve the request in your Solana wallet."}
                  </p>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <strong>
                    {activeTab === "deposit"
                      ? "Receive wXMR"
                      : "Receive native XMR"}
                  </strong>
                  <p>
                    {activeTab === "deposit"
                      ? "wXMR is minted to your wallet, minus the 0.1% bridge fee."
                      : "The bridge processes your withdrawal. Follow its status below."}
                  </p>
                </div>
              </li>
            </ol>
            <Link href="/docs" className="text-link">
              Understand the bridge
              <Icon name="arrow" />
            </Link>
          </div>}
        </div>
        <section
          id="activity"
          className="activity-section"
          aria-labelledby="activity-title"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">YOUR WALLET</p>
              <h2 id="activity-title">Transfer activity</h2>
            </div>
            {isConnected && (
              <div className="activity-actions">
                <button
                  className="text-button"
                  disabled={refreshingData}
                  onClick={() => void loadData()}
                >
                  <Icon name="refresh" />
                  {refreshingData ? "Refreshing…" : "Refresh"}
                </button>
                {historyCursor !== null && (
                  <button
                    className="text-button"
                    disabled={historyLoading}
                    onClick={() => void loadOlderWithdrawals()}
                  >
                    {historyLoading
                      ? "Loading…"
                      : historyCursor
                        ? "Load earlier activity"
                        : "Find wallet withdrawals"}
                    <Icon name="arrow" />
                  </button>
                )}
              </div>
            )}
          </div>
          {dataError && (
            <div className="notice error-notice" role="alert">
              <Icon name="info" />
              <p>{dataError}</p>
              <button className="text-button" onClick={() => void loadData()}>
                Retry
              </button>
            </div>
          )}
          {pendingBalance > BigInt(0) && isConnected && (
            <div className="claim-banner">
              <Icon name="wallet" />
              <div>
                <strong>{formatXmr(pendingBalance)} wXMR ready to claim</strong>
                <p>Your minted tokens are waiting in the deposit account.</p>
              </div>
              <button
                className="secondary-button"
                disabled={loading}
                onClick={handleClaimPending}
              >
                {loading ? "Claiming…" : "Claim wXMR"}
                <Icon name="arrow" />
              </button>
            </div>
          )}
          {!isConnected ? (
            <div className="activity-empty">
              <div className="empty-icon">
                <Icon name="activity" />
              </div>
              <h3>Your next transfer starts here.</h3>
              <p>
                Connect your wallet to see your deposit address
                <br className="desktop-break" /> and track pending withdrawals.
              </p>
              <span className="private-note">
                <Icon name="wallet" />
                Only activity for your connected wallet
              </span>
            </div>
          ) : (
            <>
              {depositAccount?.status === "active" && (
                <div className="deposit-activity-summary">
                  <TokenIcon token="xmr" />
                  <div>
                    <strong>Monero deposits</strong>
                    <p>Lifetime gross XMR deposited to your address</p>
                  </div>
                  <span>{formatXmr(depositAccount.totalDeposited)} XMR</span>
                </div>
              )}
              {withdrawals.length === 0 ? (
                <div className="activity-empty compact">
                  <Icon name="clock" />
                  <h3>No pending withdrawals in the records loaded.</h3>
                  <p>
                    Use “Find wallet withdrawals” to search earlier activity.
                  </p>
                </div>
              ) : (
                <div className="transfer-list">
                  {withdrawals.map((withdrawal) => (
                    <article
                      className="transfer-row"
                      key={withdrawal.withdrawalPda}
                    >
                      <div className="transfer-row-main">
                        <span className="transfer-direction-icon">
                          <Icon name="arrow" />
                        </span>
                        <div>
                          <h3>Solana → Monero</h3>
                          <p>{formatTime(withdrawal.createdAt)}</p>
                        </div>
                        <div className="transfer-row-amount">
                          <strong>{formatXmr(withdrawal.amount)} XMR</strong>
                          <span
                            className={`transfer-status status-${withdrawal.status}`}
                          >
                            {withdrawal.status === "pending"
                              ? "Queued"
                              : withdrawal.status === "sending"
                                ? "Sending XMR"
                                : withdrawal.status === "reverted"
                                  ? "Reverted"
                                  : "Completed"}
                          </span>
                        </div>
                      </div>
                      <details className="transfer-details">
                        <summary>
                          Transfer details
                          <Icon name="chevron" />
                        </summary>
                        <dl>
                          <div>
                            <dt>Monero destination</dt>
                            <dd>
                              <CopyAddress
                                address={withdrawal.xmrAddress}
                                label="withdrawal destination address"
                                className="break-all"
                              />
                            </dd>
                          </div>
                          <div>
                            <dt>Solana request</dt>
                            <dd>
                              <a
                                href={`https://solscan.io/account/${withdrawal.withdrawalPda}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {truncateAddress(withdrawal.withdrawalPda)}
                                <Icon name="external" />
                              </a>
                            </dd>
                          </div>
                        </dl>
                        <div className="transfer-progress">
                          <span className="done">Requested</span>
                          <span
                            className={
                              withdrawal.status === "sending" ||
                              withdrawal.status === "completed"
                                ? "done"
                                : ""
                            }
                          >
                            Processing
                          </span>
                          <span
                            className={
                              withdrawal.status === "completed" ? "done" : ""
                            }
                          >
                            Completed
                          </span>
                        </div>
                      </details>
                      {withdrawal.status === "pending" &&
                        withdrawal.user === publicKey?.toBase58() && (
                          <CancelWithdrawalButton
                            createdAt={withdrawal.createdAt}
                            disabled={loading}
                            canceling={
                              cancelingWithdrawal === withdrawal.withdrawalPda
                            }
                            onCancel={() =>
                              void handleCancelWithdrawal(withdrawal)
                            }
                          />
                        )}
                    </article>
                  ))}
                </div>
              )}
              <p className="activity-scope">
                This view tracks requests saved in this browser and wallet
                history you load. It is not a complete transaction statement.
                {historyThrough
                  ? ` Searched back to ${formatTime(historyThrough)}.`
                  : ""}
                {lastSynced
                  ? ` Last refreshed ${lastSynced.toLocaleTimeString()}.`
                  : ""}
              </p>
            </>
          )}
        </section>
        <section className="bottom-information">
          <div>
            <Icon name="code" />
            <h3>Open to inspection.</h3>
            <p>
              Read the source. Inspect the program.
              <br />
              Check the evidence for yourself.
            </p>
            <a
              className="text-link"
              href="https://github.com/sullystuff/wxmr-frontend"
              target="_blank"
              rel="noopener noreferrer"
            >
              Explore the code
              <Icon name="external" />
            </a>
          </div>
          <div>
            <Icon name="shield" />
            <h3>Keep privacy in view.</h3>
            <p>
              wXMR lives on a public blockchain. Understand what Solana activity
              and bridge records can reveal before you transfer.
            </p>
            <Link className="text-link" href="/docs#privacy">
              Understand privacy
              <Icon name="arrow" />
            </Link>
          </div>
          <details className="contract-details">
            <summary>
              <span>Official contracts</span>
              <Icon name="chevron" />
            </summary>
            <div>
              <p className="field-label">wXMR token mint</p>
              <CopyAddress
                address="WXMRyRZhsa19ety5erZhHg4N3xj3EVN92u94422teJp"
                label="wXMR mint"
                className="contract-address"
              />
              <p className="field-label">Bridge program</p>
              <CopyAddress
                address="EzBkC8P5wxab9kwrtV5hRdynHAfB5w3UPcPXNgMseVA8"
                label="bridge program"
                className="contract-address"
              />
              {bridgeConfig && (
                <>
                  <p className="field-label">Bridge authority</p>
                  <CopyAddress
                    address={bridgeConfig.authority}
                    label="bridge authority"
                    className="contract-address"
                  />
                </>
              )}
            </div>
          </details>
        </section>
      </main>
      {qrAddress && (
        <QRCodeModal address={qrAddress} onClose={() => setQrAddress(null)} />
      )}
      {showScanner && (
        <MoneroQrScanner
          onScan={({ address, amount }) => {
            setXmrAddress(address);
            if (amount !== null) {
              setWithdrawAmount(amount);
              setWithdrawExactOut(true);
            }
            setError(null);
            setShowScanner(false);
          }}
          onClose={() => setShowScanner(false)}
        />
      )}
      {reviewOpen && withdrawPreview && (
        <BridgeDialog
          labelledBy="review-title"
          onClose={() => setReviewOpen(false)}
        >
          <div className="card-heading">
            <h2 id="review-title">Review withdrawal</h2>
            <button
              className="icon-button"
              onClick={() => setReviewOpen(false)}
              aria-label="Close withdrawal review"
            >
              <Icon name="close" />
            </button>
          </div>
          <p className="muted">
            Check the destination carefully. Confirming opens your wallet to
            approve the Solana transaction.
          </p>
          <dl className="review-amounts">
            <div>
              <dt>You pay</dt>
              <dd>{formatXmr(withdrawPreview.burnAmount)} wXMR</dd>
            </div>
            <div>
              <dt>Bridge fee (0.1%)</dt>
              <dd>{formatXmr(withdrawPreview.feeAmount)} wXMR</dd>
            </div>
            <div>
              <dt>You receive</dt>
              <dd>{formatXmr(withdrawPreview.receiveAmount)} XMR</dd>
            </div>
          </dl>
          <p className="field-label">To your Monero address</p>
          <p className="review-destination">{trimmedXmrAddress}</p>
          <p className="action-footnote">
            Solana network costs are separate. Your wallet shows the final
            transaction costs.
          </p>
          <button
            className="primary-button"
            disabled={loading || !canRequestWithdrawal}
            onClick={() => {
              setReviewOpen(false);
              void handleWithdraw();
            }}
          >
            Confirm in wallet
            <Icon name="arrow" />
          </button>
        </BridgeDialog>
      )}
    </BridgeShell>
  );
}

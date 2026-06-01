'use client';

import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';

function normalizeMoneroUri(text: string): string {
  const trimmed = text.trim();
  if (trimmed.toLowerCase().startsWith('monero:')) {
    return trimmed.slice(7).split('?')[0];
  }
  return trimmed;
}

export function QRScannerModal({
  onScan,
  onClose,
}: {
  onScan: (address: string) => void;
  onClose: () => void;
}) {
  const scannerRef = useRef<HTMLDivElement>(null);
  const html5QrCodeRef = useRef<{ stop: () => Promise<void> } | null>(null);
  const stoppedRef = useRef(false);
  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  const [error, setError] = useState<string | null>(null);
  const [cameraUnavailable, setCameraUnavailable] = useState(false);
  const [isStarting, setIsStarting] = useState(true);

  useEffect(() => { onScanRef.current = onScan; }, [onScan]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    let mounted = true;

    const startScanner = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (mounted) { setIsStarting(false); setCameraUnavailable(true); }
        return;
      }

      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (!mounted || !scannerRef.current) return;

        const html5QrCode = new Html5Qrcode('qr-scanner-region');
        html5QrCodeRef.current = html5QrCode;

        const startPromise = html5QrCode.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 230, height: 230 } },
          async (decodedText) => {
            if (stoppedRef.current) return;
            stoppedRef.current = true;
            onScanRef.current(normalizeMoneroUri(decodedText));
            try { await html5QrCode.stop(); } catch { /* already stopped */ }
            onCloseRef.current();
          },
          () => {}
        );

        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 8000)
        );

        await Promise.race([startPromise, timeout]);
        if (mounted) setIsStarting(false);
      } catch (err) {
        if (mounted) {
          setIsStarting(false);
          const name = err instanceof Error ? err.name : '';
          if (name === 'NotAllowedError') {
            setError('Camera access denied. Allow camera access to scan, or paste an address instead.');
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
  }, []);

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        onScan(normalizeMoneroUri(text));
        onClose();
      }
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <Modal title={cameraUnavailable ? 'Enter Monero destination' : 'Scan Monero destination'} onClose={onClose}>
      <div className="px-6 pb-6 pt-5">
        {error ? (
          <div className="rounded-field p-4 text-[13px]" style={{ background: 'var(--color-danger-wash)', color: 'var(--color-danger)' }}>
            {error}
          </div>
        ) : cameraUnavailable ? (
          <div className="space-y-4">
            <p className="text-[13.5px] text-ink-2 leading-relaxed">
              Camera isn&apos;t available in this browser. Paste an address from your clipboard instead.
            </p>
            <button
              onClick={handlePasteFromClipboard}
              className="btn-secondary w-full py-3 text-[13.5px] font-semibold flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" />
              </svg>
              Paste from clipboard
            </button>
          </div>
        ) : (
          <>
            {isStarting && (
              <div className="flex items-center justify-center py-10 text-ink-3">
                <Spinner className="w-7 h-7" />
              </div>
            )}
            <div
              id="qr-scanner-region"
              ref={scannerRef}
              className="rounded-field overflow-hidden border border-line"
              style={{ display: isStarting ? 'none' : 'block' }}
            />
            {!isStarting && (
              <p className="text-[12px] text-ink-3 mt-4 text-center">Point your camera at a Monero address QR code</p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import {
  parseMoneroPaymentRequest,
  type MoneroPaymentRequest,
} from "@/lib/monero-payment";
import { BridgeDialog } from "./BridgeDialog";
import { Icon } from "./BridgeIcons";

type Mode = "camera" | "image" | "paste";

export function MoneroQrScanner({
  onScan,
  onClose,
}: {
  onScan: (request: MoneroPaymentRequest) => void;
  onClose: () => void;
}) {
  const id = useId().replace(/:/g, "");
  const cameraId = `qr-camera-${id}`;
  const fileId = `qr-file-${id}`;
  const [mode, setMode] = useState<Mode>("camera");
  const [attempt, setAttempt] = useState(0);
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [decoding, setDecoding] = useState(false);
  const [decoded, setDecoded] = useState<MoneroPaymentRequest | null>(null);
  const [pasted, setPasted] = useState("");
  const scanCallback = useRef(onScan);
  useEffect(() => {
    scanCallback.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (mode !== "camera") return;
    let disposed = false;
    let failed = false;
    let handling = false;
    let scanner: Html5Qrcode | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    setStarting(true);
    setError(null);
    const stop = async () => {
      if (scanner?.isScanning) {
        try {
          await scanner.stop();
        } catch {
          /* A parallel close may already have stopped it. */
        }
      }
    };
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStarting(false);
        setError(
          window.isSecureContext
            ? "Camera access is unavailable. Choose a QR image or paste a Monero payment request."
            : "Camera access needs HTTPS or localhost. You can choose a QR image or paste a payment request here.",
        );
        return;
      }
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import(
          "html5-qrcode"
        );
        if (disposed) return;
        scanner = new Html5Qrcode(cameraId, {
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
          useBarCodeDetectorIfSupported: false,
          verbose: false,
        });
        timeout = setTimeout(() => {
          if (disposed) return;
          failed = true;
          setStarting(false);
          setError(
            "The camera did not start. Check browser camera access, retry, or choose a QR image.",
          );
          void stop();
        }, 10000);
        // The region stays visible while starting. Firefox needs real layout
        // dimensions when html5-qrcode sizes the video and scanning canvas.
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 8,
            qrbox: (width, height) => {
              const size = Math.floor(Math.min(width, height) * 0.78);
              return { width: size, height: size };
            },
          },
          async (text) => {
            if (disposed || failed || handling) return;
            let request: MoneroPaymentRequest;
            try {
              request = parseMoneroPaymentRequest(text);
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : "This QR code is not a Monero payment request.",
              );
              return;
            }
            handling = true;
            await stop();
            if (!disposed) scanCallback.current(request);
          },
          () => {
            /* Frames without QR codes are expected. */
          },
        );
        if (timeout) clearTimeout(timeout);
        if (disposed || failed) {
          await stop();
          return;
        }
        setStarting(false);
      } catch (e) {
        if (timeout) clearTimeout(timeout);
        if (disposed) return;
        setStarting(false);
        const name = (e as { name?: string })?.name;
        setError(
          name === "NotAllowedError"
            ? "Camera access was denied. Allow it in Firefox or choose a QR image below."
            : "No camera could be started. Choose a QR image or paste a Monero payment request.",
        );
      }
    };
    void start();
    return () => {
      disposed = true;
      if (timeout) clearTimeout(timeout);
      // A still-pending start also checks disposed and stops its late stream.
      void stop();
    };
  }, [mode, attempt, cameraId]);

  useEffect(() => {
    if (!imageFile) {
      setImageUrl(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  useEffect(() => {
    if (mode !== "image" || !imageFile) return;
    let disposed = false;
    let scanner: Html5Qrcode | null = null;
    setDecoding(true);
    setDecoded(null);
    setError(null);
    const decode = async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import(
          "html5-qrcode"
        );
        if (disposed) return;
        scanner = new Html5Qrcode(fileId, {
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
          useBarCodeDetectorIfSupported: false,
          verbose: false,
        });
        const text = await scanner.scanFile(imageFile, false);
        const request = parseMoneroPaymentRequest(text);
        if (!disposed) setDecoded(request);
      } catch (e) {
        if (!disposed)
          setError(
            e instanceof Error
              ? e.message
              : "No readable QR code found. Try a clearer image with the full QR code visible.",
          );
      } finally {
        try {
          scanner?.clear();
        } catch {
          /* The dialog may have closed. */
        }
        if (!disposed) setDecoding(false);
      }
    };
    void decode();
    return () => {
      disposed = true;
    };
  }, [imageFile, mode, fileId]);

  const selectImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
      setError("Choose an image smaller than 10 MB.");
      return;
    }
    setImageFile(file);
  };
  const changeMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };
  const applyPasted = () => {
    try {
      onScan(parseMoneroPaymentRequest(pasted));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to read this payment request.",
      );
    }
  };

  return (
    <BridgeDialog labelledBy={`${id}-title`} onClose={onClose}>
      <div className="card-heading">
        <h2 id={`${id}-title`}>Scan Monero destination</h2>
        <button
          className="icon-button"
          aria-label="Close QR scanner"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <p className="scanner-description">
        Scan a receive QR code. If it includes an amount, we’ll use it as the
        exact XMR amount to receive.
      </p>
      <div className="scanner-tabs" aria-label="QR input method">
        {(["camera", "image", "paste"] as const).map((item) => (
          <button
            key={item}
            aria-pressed={mode === item}
            onClick={() => changeMode(item)}
          >
            {item === "camera"
              ? "Camera"
              : item === "image"
                ? "QR image"
                : "Paste request"}
          </button>
        ))}
      </div>
      {mode === "camera" && (
        <>
          <div className="qr-camera-view">
            <div id={cameraId} className="qr-camera-region" />
            {starting && (
              <div className="camera-loading" role="status">
                <span className="spinner" />
                Starting camera…
              </div>
            )}
          </div>
          <p className="scanner-hint">
            Point your camera at the complete Monero receive QR code.
          </p>
          {error && (
            <button
              className="text-button"
              onClick={() => setAttempt((n) => n + 1)}
            >
              <Icon name="refresh" />
              Retry camera
            </button>
          )}
          <button
            className="secondary-button scanner-alternative"
            onClick={() => changeMode("image")}
          >
            <Icon name="qr" />
            Choose a QR image instead
          </button>
        </>
      )}
      {mode === "image" && (
        <>
          <label
            className="secondary-button scanner-file-button"
            htmlFor={`${id}-image`}
          >
            <Icon name="qr" />
            {imageFile ? "Choose another QR image" : "Choose QR image"}
            <input
              id={`${id}-image`}
              className="sr-only"
              type="file"
              accept="image/*"
              onChange={selectImage}
            />
          </label>
          {imageUrl && (
            <div className="qr-image-preview">
              <img src={imageUrl} alt="Selected Monero receive QR code" />
            </div>
          )}
          {imageFile && (
            <p className="scanner-hint selected-file-name">{imageFile.name}</p>
          )}
          {decoding && (
            <p className="scanner-hint" role="status">
              Reading QR image…
            </p>
          )}
          {decoded && (
            <div className="scanned-payment">
              <span className="section-label">
                <Icon name="check" />
                MONERO REQUEST FOUND
              </span>
              <p>{decoded.address}</p>
              {decoded.amount && (
                <strong>Exact receive: {decoded.amount} XMR</strong>
              )}
              <button
                className="primary-button"
                onClick={() => onScan(decoded)}
              >
                Use payment details
                <Icon name="arrow" />
              </button>
            </div>
          )}
        </>
      )}
      {mode === "paste" && (
        <div className="scanner-paste">
          <label className="field-label" htmlFor={`${id}-request`}>
            Monero address or payment URI
          </label>
          <textarea
            id={`${id}-request`}
            value={pasted}
            onChange={(e) => {
              setPasted(e.target.value);
              setError(null);
            }}
            placeholder="monero:address?tx_amount=1.25"
            rows={4}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            className="text-button"
            onClick={async () => {
              try {
                setPasted(await navigator.clipboard.readText());
                setError(null);
              } catch {
                setError(
                  "Paste your address or payment request in the field above.",
                );
              }
            }}
          >
            <Icon name="copy" />
            Paste from clipboard
          </button>
          <button
            className="primary-button"
            disabled={!pasted.trim()}
            onClick={applyPasted}
          >
            Use payment details
            <Icon name="arrow" />
          </button>
        </div>
      )}
      {error && (
        <div className="notice error-notice" role="alert">
          <Icon name="info" />
          <p>{error}</p>
        </div>
      )}
      <div id={fileId} className="qr-decode-buffer" aria-hidden="true" />
    </BridgeDialog>
  );
}

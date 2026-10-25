import { ImageResponse } from "next/og";

export const alt = "wXMR — Wrapped Monero on Solana";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <div style={{ background: "#111210", color: "#f5f5ee", width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "80px", borderBottom: "12px solid #ff6600" }}>
      <div style={{ display: "flex", fontSize: 38, color: "#ff6600", marginBottom: 40 }}>wXMR.</div>
      <div style={{ display: "flex", fontSize: 76, fontWeight: 700 }}>Wrapped Monero.</div>
      <div style={{ display: "flex", fontSize: 76, color: "#ff6600" }}>Connected to Solana.</div>
      <div style={{ display: "flex", fontSize: 27, marginTop: 38, color: "#c1c3b9" }}>Bridge XMR ↔ wXMR · Public reserve proofs · wxmr.io</div>
    </div>,
    size,
  );
}

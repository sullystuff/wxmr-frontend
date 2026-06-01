# wXMR Bridge — Frontend Redesign

**Date:** 2026-06-01
**Goal:** Recast the bridge frontend so it reads as a deliberately-designed payments product (Stripe / Mercury / Ramp lineage), not a templated, AI-generated crypto dashboard. Front-end only — no wallet, program, or RPC logic changes.

## Direction (decided)

**Light, Mercury/Stripe surface.** Chosen over a Linear-style dark theme because a light, calm, financial surface is the strongest lever for the "trust this with money" repositioning and is rare in Monero tooling, so it stands out.

## The anti-"vibe-coded" rules (the actual brief)

The look-and-feel must avoid every common AI-UI tell:

1. **No centered everything.** Content sits on a constrained column with one shared optical left edge. Asymmetry on purpose.
2. **Real type hierarchy.** A defined scale (≈40 / 24 / 15 / 13 / 11 px) with exactly one dominant element per zone. Amounts use heavier optical weight + `tabular-nums` so digits don't jump.
3. **Surfaces differ by role**, not "rounded-border-shadow card, repeated." Bridge = elevated white; reserves = flat inset; FAQ = hairline dividers, not cards.
4. **Tuned spacing rhythm.** 8px base, tight (4–6px) inside field groups, generous (56–72px) between sections. Space communicates grouping.
5. **One icon set**, single ~1.75px stroke, 16px grid. **Zero emoji.**
6. **No gradient text, glow, glassmorphism, or blur.** Color does the work: `#F6F6F4` canvas, `#1A1A1F` ink, **one** orange accent on <5% of the surface. CTA is near-black ink, not orange.
7. **Specific copy.** Verbs and real numbers ("Generate deposit address", "Arrives in ~20 min", live reserve figures), never generic filler.
8. **Deliberate states.** Loading, empty, error, success each designed — not a spinner bolted on.
9. **Considered typography.** Inter with tracking on headings and `font-feature-settings` for tabular numerals / fractions.
10. **No 1100-line files.** Decompose into focused components — itself a craft signal.

## Structure — app-first (the transaction dominates)

The bridge widget *is* the hero; no empty hero band.

```
slim top bar: wordmark .......... [Connect wallet]

  Bridge Monero to Solana            (one quiet H1, left-aligned)
  Move XMR on-chain in ~20 minutes.

  ┌ THE dominant element ─────────┐
  │ [XMR→SOL] [SOL→XMR]            │
  │ You send      2.50   XMR       │
  │      ↓                          │
  │ You receive   2.4998 wXMR      │
  │ [ Generate deposit address ]   │
  │ Rate 1:0.9999 · ~20 min        │
  └────────────────────────────────┘

  Reserves · live  ✓842.61 XMR held ✓1:1 backed · Updated 2m   Proof →

  How it works   1 Generate · 2 Send · 3 Receive · 4 Redeem
  FAQ            (hairline rows)
  · technical details (mint, program) — small, at the bottom ·
```

Swap stays a modal (re-skinned). Transparency page gets the same system.

## Scope / architecture

- **`globals.css`** — replace dark tokens with the light design system (tokens, type scale, radii, subtle shadows, base element styles, light wallet-adapter overrides, tabular-num utility).
- **`src/lib/format.ts`** — `formatXmr`, `formatXmrCompact`, `relativeTime`, `truncateAddress`, `getErrorMessage` (de-duplicated from the two pages).
- **`src/lib/audits.ts`** — lifted `fetchAuditRecords` + types, shared by transparency and the live reserve strip.
- **`src/components/`** — `brand/MoneroMark`, `TopBar`, `BridgePanel`, `ReserveStrip`, `HowItWorks`, `Faq`, `TechDetails`, plus extracted `QRCodeModal`, `QRScannerModal`, `ConfirmModal`, `StatusBadge`.
- **`page.tsx`** — thin composition; bridge state/handlers stay (logic untouched) but JSX is rebuilt.
- **`transparency/page.tsx`** and **`SwapModal.tsx`** — restyled to the system.

## Out of scope

Solana program, Anchor calls, RPC config, Jupiter/AMM routing logic, the `Date.now()` nonce and memcmp-offset issues noted earlier (logic, not front-end). Reserve figures shown on the homepage are read from existing on-chain audit records; if none exist the strip degrades to circulating-supply only.

## Verification

Headless-Chrome screenshots of home, transparency, and the swap modal; `next build` + `eslint` clean; manual pass on spacing/hierarchy/states.

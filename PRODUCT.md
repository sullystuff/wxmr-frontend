# Product

## Register

product

## Users

Two audiences, served by two apps:

- **Monero holders** (wxmr.io bridge): privacy-minded XMR users moving value into Solana, often unfamiliar with Solana wallets and SPL tokens. They are skeptical by default — they chose Monero for a reason — and need verifiable reassurance at every step of a bridge flow that custodies their funds mid-transit.
- **Solana DeFi natives** (swap.wxmr.io): experienced traders who want wXMR exposure. They care about price, route quality, and speed; they will bounce off anything slower or clunkier than Jupiter.

The job to be done is the same on both sides: move value across the Monero/Solana boundary without wondering whether the machine ate it.

## Product Purpose

wXMR is a Monero ↔ Solana bridge: users deposit XMR and receive wrapped XMR (an SPL token) on Solana, redeemable back to native XMR. The frontend consists of the bridge UI with a transparency page (wxmr.io) and a lean Jupiter-powered swap site (swap.wxmr.io). Success means users complete bridge and swap flows confidently, and the transparency page lets anyone audit that the wrap is fully backed.

## Brand Personality

**Cypherpunk, competent, verifiable.** Monero-native: the orange-on-dark identity of getmonero.org, underground but professional — built by people who take the tech seriously, not a marketing department. The interface should feel like an auditable tool, not a pitch. Warmth comes from the Monero orange and plain-spoken copy, never from gloss.

## Anti-references

- **Corporate fintech gloss**: pastel gradients, stock-illustration mascots, compliance-brochure tone. This audience distrusts polish that hides mechanics.
- **Degen casino UI**: flashing PnL, confetti, meme-coin energy. This is money infrastructure.
- **Dated crypto-dashboard clutter**: widget soup, ten fonts, glowing everything.

## Design Principles

1. **Show the mechanics.** Balances, reserves, transaction states, and fees are displayed raw and verifiable — link to explorers, show addresses, never abstract away what the user is trusting.
2. **Calm during custody.** Any moment the user's funds are in flight, the UI is at its most legible and explicit: clear state, clear next step, no ambiguity about what's pending.
3. **Monero orange is the signal, dark is the room.** One saturated accent on a near-black ground; orange marks action and status, never decoration for its own sake.
4. **As fast as Jupiter or don't bother.** The swap surface competes directly with pro tooling; latency, quote freshness, and input ergonomics are design features.
5. **Plain words over crypto-speak.** Say "your XMR arrives in ~20 minutes," not "finalizing cross-chain settlement."

## Accessibility & Inclusion

WCAG AA baseline: ≥4.5:1 contrast for body text (audit orange-on-dark combinations specifically — #ff6600 on dark passes for large text but is borderline for small), full keyboard operability for swap and bridge forms, visible focus states, and `prefers-reduced-motion` alternatives for all animation.

# wXMR Bridge Frontend

A modern web interface for bridging XMR to Solana as wXMR.

Public deployment: [wxmr.io](https://wxmr.io)

## Features

- Connect Solana wallet (Phantom, Solflare)
- Create deposit accounts with permanent XMR addresses
- View deposit status and balances
- Withdraw wXMR back to XMR
- Swap wXMR ↔ USDC via AMM pool or Jupiter aggregator
- QR code generation and scanning for addresses
- Transparency page with reserve verification
- Real-time balance updates

## Getting Started

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env.local
   ```
   
   Edit `.env.local` with your settings:
   - `NEXT_PUBLIC_SOLANA_RPC_URL` - Solana RPC endpoint
   - `NEXT_PUBLIC_JUPITER_API_KEY` - (Optional) Jupiter API key for swap routing
   - `NEXT_PUBLIC_JUPITER_REFERRAL_ACCOUNT` - (Optional) Jupiter referral account for swap fees
   - `NEXT_PUBLIC_JUPITER_REFERRAL_FEE` - (Optional) Jupiter referral fee percentage

3. **Run development server:**
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000)

## Usage

### Depositing XMR

1. Connect your Solana wallet
2. Click "Create Deposit Account"
3. Send XMR to the provided address (minimum 0.01 XMR)
4. Wait for confirmations (20 blocks)
5. wXMR will be minted to your wallet

### Withdrawing XMR

1. Connect your Solana wallet
2. Switch to "Withdraw XMR" tab
3. Enter amount and your XMR address
4. Click "Withdraw XMR"
5. Your wXMR will be burned
6. XMR will be sent to your address

### Swapping

1. Click "Swap" button
2. Enter amount to swap
3. Choose between AMM pool or Jupiter route (best rate auto-selected)
4. Confirm the swap transaction

## Scripts

### Jupiter Referral Setup

```bash
npx tsx scripts/setup-jupiter-referral.ts
```

Sets up a Jupiter referral account for earning swap fees.

### Claim Jupiter Fees

```bash
npx tsx scripts/claim-jupiter-fees.ts
```

Claims accumulated referral fees from Jupiter swaps.

## Development

```bash
# Run dev server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Lint code
npm run lint
```

## Tech Stack

- Next.js 16 (App Router)
- React 19
- TypeScript
- Tailwind CSS 4
- @solana/wallet-adapter
- @coral-xyz/anchor
- Jupiter Ultra API
- qrcode.react / html5-qrcode

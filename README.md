# wXMR Bridge Frontend

A modern web interface for bridging XMR to Solana as wXMR.

## Features

- Connect Solana wallet (Phantom, Solflare)
- Request XMR deposit addresses
- View deposit status and assigned addresses
- Withdraw wXMR back to XMR
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
   - `NEXT_PUBLIC_BRIDGE_PROGRAM_ID` - Deployed bridge program ID

3. **Run development server:**
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000)

## Usage

### Depositing XMR

1. Connect your Solana wallet
2. Click "Request Deposit Address"
3. Send XMR to the provided address
4. Wait for confirmations (20 blocks)
5. wXMR will be minted to your wallet

### Withdrawing XMR

1. Connect your Solana wallet
2. Switch to "Withdraw XMR" tab
3. Enter amount and your XMR address
4. Click "Withdraw XMR"
5. Your wXMR will be burned
6. XMR will be sent to your address

## Development

```bash
# Run dev server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## Tech Stack

- Next.js 14+ (App Router)
- TypeScript
- Tailwind CSS
- @solana/wallet-adapter
- @coral-xyz/anchor

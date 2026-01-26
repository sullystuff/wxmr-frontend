/**
 * Setup Jupiter Referral Account for collecting swap fees
 * 
 * Run with: npx ts-node scripts/setup-jupiter-referral.ts
 * 
 * This creates:
 * 1. A referral account under Jupiter Ultra Referral Project
 * 2. Referral token accounts for SOL, USDC, and wXMR
 */

import { ReferralProvider } from '@jup-ag/referral-sdk';
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

// Configuration
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const JUPITER_ULTRA_PROJECT = new PublicKey('DkiqsTrw1u1bYFumumC7sCG2S8K25qc2vemJFHyW2wJc');
const REFERRAL_NAME = 'wXMR-Bridge';

// Token mints to collect fees in
const TOKEN_MINTS = {
  SOL: new PublicKey('So11111111111111111111111111111111111111112'),
  USDC: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  WXMR: new PublicKey('WXMRyRZhsa19ety5erZhHg4N3xj3EVN92u94422teJp'),
};

async function main() {
  // Load wallet
  const walletPath = process.env.WALLET_PATH || path.join(process.env.HOME!, '.config/solana/id.json');
  
  if (!fs.existsSync(walletPath)) {
    console.error(`Wallet not found at ${walletPath}`);
    console.error('Set WALLET_PATH environment variable or ensure default Solana wallet exists');
    process.exit(1);
  }

  const privateKeyArray = JSON.parse(fs.readFileSync(walletPath, 'utf8').trim());
  const wallet = Keypair.fromSecretKey(new Uint8Array(privateKeyArray));
  
  console.log('Wallet:', wallet.publicKey.toBase58());
  
  const connection = new Connection(RPC_URL);
  const provider = new ReferralProvider(connection);

  // Step 1: Create referral account
  console.log('\n--- Step 1: Create Referral Account ---');
  
  const referralTx = await provider.initializeReferralAccountWithName({
    payerPubKey: wallet.publicKey,
    partnerPubKey: wallet.publicKey,
    projectPubKey: JUPITER_ULTRA_PROJECT,
    name: REFERRAL_NAME,
  });

  const existingReferralAccount = await connection.getAccountInfo(referralTx.referralAccountPubKey);
  
  if (!existingReferralAccount) {
    console.log('Creating referral account...');
    const signature = await sendAndConfirmTransaction(connection, referralTx.tx, [wallet]);
    console.log('Signature:', `https://solscan.io/tx/${signature}`);
    console.log('Created referralAccountPubkey:', referralTx.referralAccountPubKey.toBase58());
  } else {
    console.log(`Referral account already exists: ${referralTx.referralAccountPubKey.toBase58()}`);
  }

  const referralAccountPubKey = referralTx.referralAccountPubKey;

  // Step 2: Create referral token accounts
  console.log('\n--- Step 2: Create Referral Token Accounts ---');

  for (const [name, mint] of Object.entries(TOKEN_MINTS)) {
    console.log(`\nCreating token account for ${name}...`);
    
    const tokenTx = await provider.initializeReferralTokenAccountV2({
      payerPubKey: wallet.publicKey,
      referralAccountPubKey,
      mint,
    });

    const existingTokenAccount = await connection.getAccountInfo(tokenTx.tokenAccount);
    
    if (!existingTokenAccount) {
      const signature = await sendAndConfirmTransaction(connection, tokenTx.tx, [wallet]);
      console.log(`  Signature: https://solscan.io/tx/${signature}`);
      console.log(`  Created token account: ${tokenTx.tokenAccount.toBase58()}`);
    } else {
      console.log(`  Token account already exists: ${tokenTx.tokenAccount.toBase58()}`);
    }
  }

  // Output configuration
  console.log('\n--- Configuration for Frontend ---');
  console.log(`NEXT_PUBLIC_JUPITER_REFERRAL_ACCOUNT=${referralAccountPubKey.toBase58()}`);
  console.log(`NEXT_PUBLIC_JUPITER_REFERRAL_FEE=50  // 50 bps (0.5%) - minimum allowed`);
  
  console.log('\n--- Add to .env.local ---');
  console.log(`
# Jupiter Referral (swap fees)
NEXT_PUBLIC_JUPITER_REFERRAL_ACCOUNT=${referralAccountPubKey.toBase58()}
NEXT_PUBLIC_JUPITER_REFERRAL_FEE=50
`);
}

main().catch(console.error);

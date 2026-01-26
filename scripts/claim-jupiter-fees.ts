/**
 * Claim accumulated Jupiter swap fees
 * 
 * Run with: npx ts-node scripts/claim-jupiter-fees.ts
 */

import { ReferralProvider } from '@jup-ag/referral-sdk';
import { Connection, Keypair, PublicKey, sendAndConfirmRawTransaction } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

// Configuration
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const REFERRAL_ACCOUNT = process.env.JUPITER_REFERRAL_ACCOUNT;

async function main() {
  if (!REFERRAL_ACCOUNT) {
    console.error('JUPITER_REFERRAL_ACCOUNT environment variable not set');
    console.error('Run setup-jupiter-referral.ts first to create your referral account');
    process.exit(1);
  }

  // Load wallet
  const walletPath = process.env.WALLET_PATH || path.join(process.env.HOME!, '.config/solana/id.json');
  
  if (!fs.existsSync(walletPath)) {
    console.error(`Wallet not found at ${walletPath}`);
    process.exit(1);
  }

  const privateKeyArray = JSON.parse(fs.readFileSync(walletPath, 'utf8').trim());
  const wallet = Keypair.fromSecretKey(new Uint8Array(privateKeyArray));
  
  console.log('Wallet:', wallet.publicKey.toBase58());
  console.log('Referral Account:', REFERRAL_ACCOUNT);
  
  const connection = new Connection(RPC_URL);
  const provider = new ReferralProvider(connection);

  console.log('\n--- Claiming All Fees ---');
  
  const transactions = await provider.claimAllV2({
    payerPubKey: wallet.publicKey,
    referralAccountPubKey: new PublicKey(REFERRAL_ACCOUNT),
  });

  if (transactions.length === 0) {
    console.log('No fees to claim!');
    return;
  }

  console.log(`Found ${transactions.length} claim transaction(s)`);

  // Send each claim transaction one by one
  for (let i = 0; i < transactions.length; i++) {
    const transaction = transactions[i];
    console.log(`\nSending transaction ${i + 1}/${transactions.length}...`);
    
    transaction.sign([wallet]);
    const signature = await sendAndConfirmRawTransaction(
      connection,
      Buffer.from(transaction.serialize())
    );
    
    console.log(`  Signature: https://solscan.io/tx/${signature}`);
  }

  console.log('\nAll fees claimed successfully!');
}

main().catch(console.error);

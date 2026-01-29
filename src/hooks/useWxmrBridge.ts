'use client';

import { useCallback, useMemo } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, ComputeBudgetProgram, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddress, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import type { WxmrBridge } from '@/idl/wxmr_bridge';
import IDL from '@/idl/wxmr_bridge.json';

// Program ID - should match deployed program
const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_BRIDGE_PROGRAM_ID || 'EzBkC8P5wxab9kwrtV5hRdynHAfB5w3UPcPXNgMseVA8'
);
const WXMR_MINT = new PublicKey('WXMRyRZhsa19ety5erZhHg4N3xj3EVN92u94422teJp');

// Priority fee configuration
const PRIORITY_FEE_MICROLAMPORTS = 50000;
const COMPUTE_UNIT_LIMIT = 100000;

function getPriorityFeeInstructions() {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICROLAMPORTS }),
  ];
}

// Deposit account info (permanent, one per user)
export interface DepositAccountInfo {
  depositPda: string;
  owner: string;
  xmrDepositAddress: string;
  totalDeposited: bigint;
  status: 'pending' | 'active' | 'closed';
  createdAt: number;
}

export interface WithdrawalInfo {
  withdrawalPda: string;
  user: string;
  nonce: bigint;
  amount: bigint;
  xmrAddress: string;
  status: 'pending' | 'sending' | 'completed' | 'reverted';
  createdAt: number;
}

export interface BridgeConfig {
  authority: string;
  wxmrMint: string;
  totalDeposits: bigint;
  totalWithdrawals: bigint;
}

export function useWxmrBridge() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const program = useMemo(() => {
    if (!wallet.publicKey) return null;

    const provider = new AnchorProvider(
      connection,
      wallet as any,
      { commitment: 'confirmed' }
    );

    return new Program(IDL as WxmrBridge, provider);
  }, [connection, wallet]);

  // Get bridge config PDA
  const getBridgeConfigPDA = useCallback(() => {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('config')],
      PROGRAM_ID
    );
    return pda;
  }, []);

  // Get deposit PDA for a user (permanent, one per wallet - no nonce!)
  const getDepositPDA = useCallback((owner: PublicKey) => {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('deposit'), owner.toBuffer()],
      PROGRAM_ID
    );
    return pda;
  }, []);

  // Get withdrawal PDA for a specific nonce
  const getWithdrawalPDA = useCallback((user: PublicKey, nonce: bigint) => {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('withdrawal'),
        user.toBuffer(),
        new BN(nonce.toString()).toArrayLike(Buffer, 'le', 8),
      ],
      PROGRAM_ID
    );
    return pda;
  }, []);

  // Fetch bridge configuration
  const fetchBridgeConfig = useCallback(async (): Promise<BridgeConfig | null> => {
    if (!program) return null;

    try {
      const configPda = getBridgeConfigPDA();
      const config = await (program.account as any).bridgeConfig.fetch(configPda);
      
      return {
        authority: config.authority.toBase58(),
        wxmrMint: config.wxmrMint.toBase58(),
        totalDeposits: BigInt(config.totalDeposits.toString()),
        totalWithdrawals: BigInt(config.totalWithdrawals.toString()),
      };
    } catch (error) {
      console.error('Error fetching bridge config:', error);
      return null;
    }
  }, [program, getBridgeConfigPDA]);

  // Create deposit account (one per wallet - permanent)
  const createDepositAccount = useCallback(async (): Promise<{ signature: string; depositPda: string } | null> => {
    if (!program || !wallet.publicKey) return null;

    try {
      const depositPda = getDepositPDA(wallet.publicKey);
      const tokenAccount: PublicKey = await getAssociatedTokenAddress(WXMR_MINT, wallet.publicKey, false, TOKEN_PROGRAM_ID);
      const createTokenAccountInstruction = createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, tokenAccount, wallet.publicKey, WXMR_MINT, TOKEN_PROGRAM_ID);
      const signature = await program.methods
        .createDepositAccount()
        .accountsPartial({
          config: getBridgeConfigPDA(),
          user: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([createTokenAccountInstruction, ...getPriorityFeeInstructions()])
        .rpc();

      return {
        signature,
        depositPda: depositPda.toBase58(),
      };
    } catch (error) {
      console.error('Error creating deposit account:', error);
      throw error;
    }
  }, [program, wallet.publicKey, getDepositPDA, getBridgeConfigPDA]);

  // Close deposit account (to get a new XMR address)
  const closeDepositAccount = useCallback(async (): Promise<string | null> => {
    if (!program || !wallet.publicKey) return null;

    try {
      const config = await fetchBridgeConfig();
      if (!config) throw new Error('Bridge not initialized');

      const depositPda = getDepositPDA(wallet.publicKey);

      const signature = await program.methods
        .closeDepositAccount()
        .accountsPartial({
          config: getBridgeConfigPDA(),
          deposit: depositPda,
          user: wallet.publicKey,
          authority: new PublicKey(config.authority),
        })
        .preInstructions(getPriorityFeeInstructions())
        .rpc();

      return signature;
    } catch (error) {
      console.error('Error closing deposit account:', error);
      throw error;
    }
  }, [program, wallet.publicKey, getDepositPDA, getBridgeConfigPDA, fetchBridgeConfig]);

  // Fetch user's deposit account (or null if none exists)
  const fetchMyDepositAccount = useCallback(async (): Promise<DepositAccountInfo | null> => {
    if (!program || !wallet.publicKey) return null;

    try {
      const depositPda = getDepositPDA(wallet.publicKey);
      const deposit = await (program.account as any).depositRecord.fetch(depositPda);
      
      let status: DepositAccountInfo['status'] = 'pending';
      if ('pending' in deposit.status) status = 'pending';
      else if ('active' in deposit.status) status = 'active';
      else if ('closed' in deposit.status) status = 'closed';

      return {
        depositPda: depositPda.toBase58(),
        owner: deposit.owner.toBase58(),
        xmrDepositAddress: deposit.xmrDepositAddress || '',
        totalDeposited: BigInt((deposit.totalDeposited || 0).toString()),
        status,
        createdAt: deposit.createdAt.toNumber(),
      };
    } catch (error) {
      // Account doesn't exist - user hasn't created one yet
      return null;
    }
  }, [program, wallet.publicKey, getDepositPDA]);

  // Request a withdrawal (burns wXMR)
  const requestWithdrawal = useCallback(async (
    amount: bigint,
    xmrAddress: string
  ): Promise<{ signature: string; withdrawalPda: string } | null> => {
    if (!program || !wallet.publicKey) return null;

    try {
      const config = await fetchBridgeConfig();
      if (!config) throw new Error('Bridge not initialized');

      // Get user's token account
      const wxmrMint = new PublicKey(config.wxmrMint);
      const userTokenAccount = await getAssociatedTokenAddress(wxmrMint, wallet.publicKey);

      // Generate unique nonce (timestamp-based)
      const nonce = BigInt(Date.now());
      const withdrawalPda = getWithdrawalPDA(wallet.publicKey, nonce);

      const signature = await program.methods
        .requestWithdrawal(new BN(nonce.toString()), new BN(amount.toString()), xmrAddress)
        .accountsPartial({
          config: getBridgeConfigPDA(),
          userTokenAccount,
          wxmrMint,
          user: wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .preInstructions(getPriorityFeeInstructions())
        .rpc();

      return {
        signature,
        withdrawalPda: withdrawalPda.toBase58(),
      };
    } catch (error) {
      console.error('Error requesting withdrawal:', error);
      throw error;
    }
  }, [program, wallet.publicKey, fetchBridgeConfig, getWithdrawalPDA, getBridgeConfigPDA]);

  // Fetch withdrawal info
  const fetchWithdrawal = useCallback(async (withdrawalPda: string): Promise<WithdrawalInfo | null> => {
    if (!program) return null;

    try {
      const withdrawal = await (program.account as any).withdrawalRecord.fetch(new PublicKey(withdrawalPda));
      
      let status: WithdrawalInfo['status'] = 'pending';
      if ('pending' in withdrawal.status) status = 'pending';
      else if ('sending' in withdrawal.status) status = 'sending';
      else if ('completed' in withdrawal.status) status = 'completed';
      else if ('reverted' in withdrawal.status) status = 'reverted';

      return {
        withdrawalPda,
        user: withdrawal.user.toBase58(),
        nonce: BigInt(withdrawal.nonce.toString()),
        amount: BigInt(withdrawal.amount.toString()),
        xmrAddress: withdrawal.xmrAddress,
        status,
        createdAt: withdrawal.createdAt.toNumber(),
      };
    } catch (error) {
      console.error('Error fetching withdrawal:', error);
      return null;
    }
  }, [program]);

  // Fetch all withdrawals for current user
  const fetchMyWithdrawals = useCallback(async (): Promise<WithdrawalInfo[]> => {
    if (!program || !wallet.publicKey) return [];

    try {
      const withdrawals = await (program.account as any).withdrawalRecord.all([
        {
          memcmp: {
            offset: 8, // discriminator
            bytes: wallet.publicKey.toBase58(),
          },
        },
      ]);

      return withdrawals.map((w: any) => {
        let status: WithdrawalInfo['status'] = 'pending';
        if ('pending' in w.account.status) status = 'pending';
        else if ('sending' in w.account.status) status = 'sending';
        else if ('completed' in w.account.status) status = 'completed';
        else if ('reverted' in w.account.status) status = 'reverted';

        return {
          withdrawalPda: w.publicKey.toBase58(),
          user: w.account.user.toBase58(),
          nonce: BigInt(w.account.nonce.toString()),
          amount: BigInt(w.account.amount.toString()),
          xmrAddress: w.account.xmrAddress,
          status,
          createdAt: w.account.createdAt.toNumber(),
        };
      });
    } catch (error) {
      console.error('Error fetching withdrawals:', error);
      return [];
    }
  }, [program, wallet.publicKey]);

  // Get wXMR balance for current user
  const getWxmrBalance = useCallback(async (): Promise<bigint> => {
    if (!connection || !wallet.publicKey) return BigInt(0);

    try {
      const config = await fetchBridgeConfig();
      if (!config) return BigInt(0);

      const wxmrMint = new PublicKey(config.wxmrMint);
      const tokenAccount = await getAssociatedTokenAddress(wxmrMint, wallet.publicKey);
      
      const accountInfo = await connection.getTokenAccountBalance(tokenAccount);
      return BigInt(accountInfo.value.amount);
    } catch {
      return BigInt(0);
    }
  }, [connection, wallet.publicKey, fetchBridgeConfig]);

  // Get pending token account address (ATA owned by deposit PDA)
  const getPendingTokenAccount = useCallback((depositPda: PublicKey) => {
    return getAssociatedTokenAddress(WXMR_MINT, depositPda, true, TOKEN_PROGRAM_ID);
  }, []);

  // Get pending wXMR balance (tokens minted before user had an ATA)
  const getPendingBalance = useCallback(async (): Promise<bigint> => {
    if (!connection || !wallet.publicKey) return BigInt(0);

    try {
      const depositPda = getDepositPDA(wallet.publicKey);
      const pendingAccount = await getPendingTokenAccount(depositPda);
      
      const accountInfo = await connection.getTokenAccountBalance(pendingAccount);
      return BigInt(accountInfo.value.amount);
    } catch {
      // Account doesn't exist = no pending tokens
      return BigInt(0);
    }
  }, [connection, wallet.publicKey, getDepositPDA, getPendingTokenAccount]);

  // Claim pending tokens (transfer from pending account to user's ATA)
  const claimPendingMint = useCallback(async (): Promise<string | null> => {
    if (!program || !wallet.publicKey) return null;

    try {
      const config = await fetchBridgeConfig();
      if (!config) throw new Error('Bridge not initialized');

      const depositPda = getDepositPDA(wallet.publicKey);
      const pendingTokenAccount = await getPendingTokenAccount(depositPda);
      const ownerTokenAccount = await getAssociatedTokenAddress(WXMR_MINT, wallet.publicKey, false, TOKEN_PROGRAM_ID);
      const createOwnerTokenAccountInstruction = createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, ownerTokenAccount, wallet.publicKey, WXMR_MINT, TOKEN_PROGRAM_ID);
      const signature = await program.methods
        .claimPendingMint()
        .accountsPartial({
          config: getBridgeConfigPDA(),
          deposit: depositPda,
          owner: wallet.publicKey,
          pendingTokenAccount,
          ownerTokenAccount,
          wxmrMint: WXMR_MINT,
          authority: new PublicKey(config.authority),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([createOwnerTokenAccountInstruction, ...getPriorityFeeInstructions()])
        .rpc();

      return signature;
    } catch (error) {
      console.error('Error claiming pending mint:', error);
      throw error;
    }
  }, [program, wallet.publicKey, getDepositPDA, getPendingTokenAccount, getBridgeConfigPDA, fetchBridgeConfig]);

  return {
    program,
    isConnected: !!wallet.publicKey,
    publicKey: wallet.publicKey,
    createDepositAccount,
    closeDepositAccount,
    fetchMyDepositAccount,
    requestWithdrawal,
    fetchWithdrawal,
    fetchMyWithdrawals,
    fetchBridgeConfig,
    getWxmrBalance,
    getPendingBalance,
    claimPendingMint,
  };
}

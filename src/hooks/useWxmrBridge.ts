'use client';

import { useCallback, useMemo } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, ComputeBudgetProgram } from '@solana/web3.js';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import type { WxmrBridge } from '@/idl/wxmr_bridge';
import IDL from '@/idl/wxmr_bridge.json';

// Program ID - should match deployed program
const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_BRIDGE_PROGRAM_ID || 'LTBXbfJNc2WZp2n1oB1VXpdXNa3R5xf18wq2dP8t8mQ'
);

// Priority fee configuration
const PRIORITY_FEE_MICROLAMPORTS = 50000;
const COMPUTE_UNIT_LIMIT = 300000;

function getPriorityFeeInstructions() {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICROLAMPORTS }),
  ];
}

export interface DepositInfo {
  depositPda: string;
  recipient: string;
  nonce: bigint;
  xmrDepositAddress: string;
  amountDeposited: bigint;
  status: 'pending' | 'awaitingDeposit' | 'completed' | 'cancelled';
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
  depositNonce: bigint;
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
      [Buffer.from('bridge_config')],
      PROGRAM_ID
    );
    return pda;
  }, []);

  // Get deposit PDA for a specific nonce
  const getDepositPDA = useCallback((recipient: PublicKey, nonce: bigint) => {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('deposit'),
        recipient.toBuffer(),
        new BN(nonce.toString()).toArrayLike(Buffer, 'le', 8),
      ],
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
        depositNonce: BigInt(config.depositNonce.toString()),
      };
    } catch (error) {
      console.error('Error fetching bridge config:', error);
      return null;
    }
  }, [program, getBridgeConfigPDA]);

  // Request a new deposit
  const requestDeposit = useCallback(async (): Promise<{ signature: string; depositPda: string; nonce: bigint } | null> => {
    if (!program || !wallet.publicKey) return null;

    try {
      // Get current nonce from config
      const config = await fetchBridgeConfig();
      if (!config) throw new Error('Bridge not initialized');

      const nonce = config.depositNonce;
      const depositPda = getDepositPDA(wallet.publicKey, nonce);

      const signature = await program.methods
        .requestDeposit()
        .accountsPartial({
          config: getBridgeConfigPDA(),
          recipient: wallet.publicKey,
        })
        .preInstructions(getPriorityFeeInstructions())
        .rpc();

      return {
        signature,
        depositPda: depositPda.toBase58(),
        nonce,
      };
    } catch (error) {
      console.error('Error requesting deposit:', error);
      throw error;
    }
  }, [program, wallet.publicKey, fetchBridgeConfig, getDepositPDA, getBridgeConfigPDA]);

  // Fetch deposit info
  const fetchDeposit = useCallback(async (depositPda: string): Promise<DepositInfo | null> => {
    if (!program) return null;

    try {
      const deposit = await (program.account as any).deposit.fetch(new PublicKey(depositPda));
      
      let status: DepositInfo['status'] = 'pending';
      if ('pending' in deposit.status) status = 'pending';
      else if ('awaitingDeposit' in deposit.status) status = 'awaitingDeposit';
      else if ('completed' in deposit.status) status = 'completed';
      else if ('cancelled' in deposit.status) status = 'cancelled';

      return {
        depositPda,
        recipient: deposit.recipient.toBase58(),
        nonce: BigInt(deposit.nonce.toString()),
        xmrDepositAddress: deposit.xmrDepositAddress,
        amountDeposited: BigInt(deposit.amountDeposited.toString()),
        status,
        createdAt: deposit.createdAt.toNumber(),
      };
    } catch (error) {
      console.error('Error fetching deposit:', error);
      return null;
    }
  }, [program]);

  // Fetch all deposits for current user
  const fetchMyDeposits = useCallback(async (): Promise<DepositInfo[]> => {
    if (!program || !wallet.publicKey) return [];

    try {
      const deposits = await (program.account as any).deposit.all([
        {
          memcmp: {
            offset: 8, // discriminator
            bytes: wallet.publicKey.toBase58(),
          },
        },
      ]);

      return deposits.map((d: any) => {
        let status: DepositInfo['status'] = 'pending';
        if ('pending' in d.account.status) status = 'pending';
        else if ('awaitingDeposit' in d.account.status) status = 'awaitingDeposit';
        else if ('completed' in d.account.status) status = 'completed';
        else if ('cancelled' in d.account.status) status = 'cancelled';

        return {
          depositPda: d.publicKey.toBase58(),
          recipient: d.account.recipient.toBase58(),
          nonce: BigInt(d.account.nonce.toString()),
          xmrDepositAddress: d.account.xmrDepositAddress,
          amountDeposited: BigInt(d.account.amountDeposited.toString()),
          status,
          createdAt: d.account.createdAt.toNumber(),
        };
      });
    } catch (error) {
      console.error('Error fetching deposits:', error);
      return [];
    }
  }, [program, wallet.publicKey]);

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
      const withdrawal = await (program.account as any).withdrawal.fetch(new PublicKey(withdrawalPda));
      
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
      const withdrawals = await (program.account as any).withdrawal.all([
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

  return {
    program,
    isConnected: !!wallet.publicKey,
    publicKey: wallet.publicKey,
    requestDeposit,
    fetchDeposit,
    fetchMyDeposits,
    requestWithdrawal,
    fetchWithdrawal,
    fetchMyWithdrawals,
    fetchBridgeConfig,
    getWxmrBalance,
  };
}

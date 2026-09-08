'use client';

import { useCallback, useMemo } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, ComputeBudgetProgram, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import type { Wallet as AnchorProviderWallet } from '@coral-xyz/anchor/dist/cjs/provider';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  unpackAccount,
  unpackMint,
} from '@solana/spl-token';
import IDL from '@wxmr/core/idl/wxmr_bridge.json';
import type { WxmrBridge } from '@wxmr/core/idl/wxmr_bridge';
import { XMR_MINT } from '@wxmr/shared';
import { knownWithdrawals, rememberWithdrawals } from '@/lib/withdrawal-storage';

// Program ID - should match deployed program
const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_BRIDGE_PROGRAM_ID || 'EzBkC8P5wxab9kwrtV5hRdynHAfB5w3UPcPXNgMseVA8'
);

// Priority fee configuration
const PRIORITY_FEE_MICROLAMPORTS = 50000;
const COMPUTE_UNIT_LIMIT = 100000;

function getPriorityFeeInstructions() {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICROLAMPORTS }),
  ];
}

function createReadonlyWallet(publicKey: PublicKey): AnchorProviderWallet {
  return {
    publicKey,
    signTransaction: async (tx) => tx,
    signAllTransactions: async (txs) => txs,
  };
}

// Deposit account info (permanent, one per user)
export interface DepositAccountInfo {
  depositPda: string;
  owner: string;
  xmrDepositAddress: string;
  totalDeposited: bigint;
  status: 'pending' | 'active';
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

export interface BridgePageSnapshot {
  bridgeConfig: BridgeConfig | null;
  circulatingSupply: bigint;
  wxmrBalance: bigint;
  pendingBalance: bigint;
  depositAccount: DepositAccountInfo | null;
  withdrawals: WithdrawalInfo[];
}

export function useWxmrBridge() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey, signTransaction, signAllTransactions } = wallet;

  const program = useMemo(() => {
    if (!publicKey) return null;
    const anchorWallet: AnchorProviderWallet = {
      publicKey: publicKey,
      signTransaction: signTransaction ?? (async (tx) => tx),
      signAllTransactions: signAllTransactions ?? (async (txs) => txs),
    };

    const provider = new AnchorProvider(
      connection,
      anchorWallet,
      { commitment: 'confirmed' }
    );

    return new Program<WxmrBridge>(IDL as WxmrBridge, provider);
  }, [connection, publicKey, signTransaction, signAllTransactions]);

  const readProgram = useMemo(() => {
    const readProvider = new AnchorProvider(
      connection,
      createReadonlyWallet(PublicKey.default),
      { commitment: 'confirmed' }
    );

    return new Program<WxmrBridge>(IDL as WxmrBridge, readProvider);
  }, [connection]);

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

  const decodeBridgeConfig = useCallback((data: Buffer): BridgeConfig => {
    const config = readProgram.coder.accounts.decode('bridgeConfig', data);
    return {
      authority: config.authority.toBase58(),
      wxmrMint: config.wxmrMint.toBase58(),
      totalDeposits: BigInt(config.totalDeposits.toString()),
      totalWithdrawals: BigInt(config.totalWithdrawals.toString()),
    };
  }, [readProgram]);

  const decodeDepositAccount = useCallback((depositPda: PublicKey, data: Buffer): DepositAccountInfo => {
    const deposit = readProgram.coder.accounts.decode('depositRecord', data);

    let status: DepositAccountInfo['status'] = 'pending';
    if ('pending' in deposit.status) status = 'pending';
    else if ('active' in deposit.status) status = 'active';

    return {
      depositPda: depositPda.toBase58(),
      owner: deposit.owner.toBase58(),
      xmrDepositAddress: deposit.xmrDepositAddress || '',
      totalDeposited: BigInt((deposit.totalDeposited || 0).toString()),
      status,
      createdAt: deposit.createdAt.toNumber(),
    };
  }, [readProgram]);

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

  // Fetch bridge configuration (works with or without wallet)
  const fetchBridgeConfig = useCallback(async (): Promise<BridgeConfig | null> => {
    try {
      const configPda = getBridgeConfigPDA();

      // If we have a program (wallet connected), use it
      if (program) {
        const config = await program.account.bridgeConfig.fetch(configPda);
        return {
          authority: config.authority.toBase58(),
          wxmrMint: config.wxmrMint.toBase58(),
          totalDeposits: BigInt(config.totalDeposits.toString()),
          totalWithdrawals: BigInt(config.totalWithdrawals.toString()),
        };
      }

      // No wallet — read the raw account and decode manually
      const accountInfo = await connection.getAccountInfo(configPda);
      if (!accountInfo) return null;

      return decodeBridgeConfig(accountInfo.data);
    } catch (error) {
      console.error('Error fetching bridge config:', error);
      return null;
    }
  }, [program, connection, getBridgeConfigPDA, decodeBridgeConfig]);

  const decodeWithdrawal = useCallback((withdrawalPda: PublicKey, data: Buffer): WithdrawalInfo | null => {
    const w = readProgram.coder.accounts.decode('withdrawalRecord', data);
    if (!wallet.publicKey?.equals(w.user)) return null;
    if (!getWithdrawalPDA(w.user, BigInt(w.nonce.toString())).equals(withdrawalPda)) {
      throw new Error('Invalid withdrawal account address');
    }
    const status: WithdrawalInfo['status'] = 'sending' in w.status ? 'sending'
      : 'completed' in w.status ? 'completed' : 'reverted' in w.status ? 'reverted' : 'pending';
    return {
      withdrawalPda: withdrawalPda.toBase58(), user: w.user.toBase58(), nonce: BigInt(w.nonce.toString()),
      amount: BigInt(w.amount.toString()), xmrAddress: w.xmrAddress, status, createdAt: w.createdAt.toNumber(),
    };
  }, [readProgram, wallet.publicKey, getWithdrawalPDA]);

  // Fetch all deterministic homepage accounts in one RPC request.
  const fetchPageSnapshot = useCallback(async (): Promise<BridgePageSnapshot> => {
    const snapshot: BridgePageSnapshot = {
      bridgeConfig: null,
      circulatingSupply: BigInt(0),
      wxmrBalance: BigInt(0),
      pendingBalance: BigInt(0),
      depositAccount: null,
      withdrawals: [],
    };

    try {
      const configPda = getBridgeConfigPDA();
      const accountKeys = [configPda, XMR_MINT];
      const userTokenAccount = wallet.publicKey
        ? getAssociatedTokenAddressSync(XMR_MINT, wallet.publicKey, false, TOKEN_PROGRAM_ID)
        : null;
      const depositPda = wallet.publicKey ? getDepositPDA(wallet.publicKey) : null;
      const pendingTokenAccount = depositPda
        ? getAssociatedTokenAddressSync(XMR_MINT, depositPda, true, TOKEN_PROGRAM_ID)
        : null;

      if (userTokenAccount && pendingTokenAccount && depositPda) {
        accountKeys.push(userTokenAccount, pendingTokenAccount, depositPda);
      }

      const baseAccountCount = accountKeys.length;
      if (wallet.publicKey) {
        for (const address of knownWithdrawals(PROGRAM_ID.toBase58(), wallet.publicKey.toBase58())) {
          try { accountKeys.push(new PublicKey(address)); } catch { /* Ignore invalid browser storage. */ }
        }
      }
      const infos = [];
      for (let offset = 0; offset < accountKeys.length; offset += 100) {
        infos.push(...await connection.getMultipleAccountsInfo(accountKeys.slice(offset, offset + 100), 'confirmed'));
      }
      const [configInfo, mintInfo, userTokenInfo, pendingTokenInfo, depositInfo] = infos;
      if (!configInfo || !mintInfo) throw new Error('Bridge configuration or mint is unavailable');
      for (let i = baseAccountCount; i < infos.length; i++) {
        const info = infos[i];
        if (!info || !info.owner.equals(PROGRAM_ID)) continue;
        const withdrawal = decodeWithdrawal(accountKeys[i], info.data);
        if (withdrawal) snapshot.withdrawals.push(withdrawal);
      }

      if (configInfo) {
        if (!configInfo.owner.equals(PROGRAM_ID)) throw new Error('Invalid bridge config owner');
        snapshot.bridgeConfig = decodeBridgeConfig(configInfo.data);
      }

      if (mintInfo) {
        snapshot.circulatingSupply = unpackMint(XMR_MINT, mintInfo, TOKEN_PROGRAM_ID).supply;
      }

      if (userTokenAccount && userTokenInfo) {
        snapshot.wxmrBalance = unpackAccount(userTokenAccount, userTokenInfo, TOKEN_PROGRAM_ID).amount;
      }

      if (pendingTokenAccount && pendingTokenInfo) {
        snapshot.pendingBalance = unpackAccount(pendingTokenAccount, pendingTokenInfo, TOKEN_PROGRAM_ID).amount;
      }

      if (depositPda && depositInfo) {
        if (!depositInfo.owner.equals(PROGRAM_ID)) throw new Error('Invalid deposit owner');
        snapshot.depositAccount = decodeDepositAccount(depositPda, depositInfo.data);
      }
    } catch (error) {
      console.error('Error fetching bridge page snapshot:', error);
      throw error;
    }

    return snapshot;
  }, [connection, wallet.publicKey, getBridgeConfigPDA, getDepositPDA, decodeBridgeConfig, decodeDepositAccount, decodeWithdrawal]);

  // Create deposit account (one per wallet - permanent)
  const createDepositAccount = useCallback(async (): Promise<{ signature: string; depositPda: string } | null> => {
    if (!program || !wallet.publicKey) return null;

    try {
      const depositPda = getDepositPDA(wallet.publicKey);
      const tokenAccount: PublicKey = await getAssociatedTokenAddress(XMR_MINT, wallet.publicKey, false, TOKEN_PROGRAM_ID);
      const createTokenAccountInstruction = createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, tokenAccount, wallet.publicKey, XMR_MINT, TOKEN_PROGRAM_ID);
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

  // Fetch user's deposit account (or null if none exists)
  const fetchMyDepositAccount = useCallback(async (): Promise<DepositAccountInfo | null> => {
    if (!program || !wallet.publicKey) return null;

    try {
      const depositPda = getDepositPDA(wallet.publicKey);
      const deposit = await program.account.depositRecord.fetch(depositPda);
      
      let status: DepositAccountInfo['status'] = 'pending';
      if ('pending' in deposit.status) status = 'pending';
      else if ('active' in deposit.status) status = 'active';

      return {
        depositPda: depositPda.toBase58(),
        owner: deposit.owner.toBase58(),
        xmrDepositAddress: deposit.xmrDepositAddress || '',
        totalDeposited: BigInt((deposit.totalDeposited || 0).toString()),
        status,
        createdAt: deposit.createdAt.toNumber(),
      };
    } catch {
      // Account doesn't exist - user hasn't created one yet
      return null;
    }
  }, [program, wallet.publicKey, getDepositPDA]);

  // Request a withdrawal (burns Solana XMR)
  const requestWithdrawal = useCallback(async (
    amount: bigint,
    xmrAddress: string,
    exactOut = false
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
      // Save before asking the wallet to sign: an uncertain confirmation must remain discoverable.
      rememberWithdrawals(PROGRAM_ID.toBase58(), wallet.publicKey.toBase58(), [withdrawalPda.toBase58()]);

      const signature = await program.methods
        .requestWithdrawal(new BN(nonce.toString()), new BN(amount.toString()), xmrAddress, exactOut)
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
      const withdrawal = await program.account.withdrawalRecord.fetch(new PublicKey(withdrawalPda));
      
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

  // Older/cross-browser records are discovered only on request, one history page at a time.
  const discoverMyWithdrawals = useCallback(async (before?: string): Promise<{ nextCursor: string | null; searchedThrough: number | null }> => {
    if (!wallet.publicKey) throw new Error('Connect a wallet first');
    const params = new URLSearchParams({ owner: wallet.publicKey.toBase58() });
    if (before) params.set('before', before);
    const response = await fetch(`/api/withdrawals?${params}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Failed to load withdrawal history');
    rememberWithdrawals(PROGRAM_ID.toBase58(), wallet.publicKey.toBase58(), body.addresses);
    return { nextCursor: body.nextCursor, searchedThrough: body.searchedThrough };
  }, [wallet.publicKey]);

  // Get pending token account address (ATA owned by deposit PDA)
  const getPendingTokenAccount = useCallback((depositPda: PublicKey) => {
    return getAssociatedTokenAddress(XMR_MINT, depositPda, true, TOKEN_PROGRAM_ID);
  }, []);

  // Claim pending tokens (transfer from pending account to user's ATA)
  const claimPendingMint = useCallback(async (): Promise<string | null> => {
    if (!program || !wallet.publicKey) return null;

    try {
      const config = await fetchBridgeConfig();
      if (!config) throw new Error('Bridge not initialized');

      const depositPda = getDepositPDA(wallet.publicKey);
      const pendingTokenAccount = await getPendingTokenAccount(depositPda);
      const ownerTokenAccount = await getAssociatedTokenAddress(XMR_MINT, wallet.publicKey, false, TOKEN_PROGRAM_ID);
      const createOwnerTokenAccountInstruction = createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, ownerTokenAccount, wallet.publicKey, XMR_MINT, TOKEN_PROGRAM_ID);
      const signature = await program.methods
        .claimPendingMint()
        .accountsPartial({
          config: getBridgeConfigPDA(),
          deposit: depositPda,
          owner: wallet.publicKey,
          pendingTokenAccount,
          ownerTokenAccount,
          wxmrMint: XMR_MINT,
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
    isWalletConnecting: wallet.connecting,
    publicKey: wallet.publicKey,
    createDepositAccount,
    fetchMyDepositAccount,
    requestWithdrawal,
    fetchWithdrawal,
    discoverMyWithdrawals,
    fetchPageSnapshot,
    fetchBridgeConfig,
    claimPendingMint,
  };
}

import { AnchorProvider, Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import type { Program as AnchorProgram } from "@coral-xyz/anchor";
import {
  type Commitment,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  Transaction,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import IDL from "./idl/wxmr_bridge.json" with { type: "json" };
import type { WxmrBridge } from "./idl/wxmr_bridge.js";
import { BRIDGE_PROGRAM_ID } from "./constants.js";

export interface AnchorProviderWallet {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
}

export interface BridgeConfig {
  authority: string;
  wxmrMint: string;
  totalDeposits: bigint;
  totalWithdrawals: bigint;
}

export interface RequestWithdrawalOptions {
  connection: Connection;
  signer: Keypair;
  amount: bigint;
  xmrAddress: string;
  exactOut?: boolean;
  programId?: PublicKey | string;
  nonce?: bigint;
  commitment?: Commitment;
}

export interface BuildRequestWithdrawalTransactionOptions {
  connection: Connection;
  user: PublicKey;
  amount: bigint;
  xmrAddress: string;
  exactOut?: boolean;
  programId?: PublicKey | string;
  nonce?: bigint;
  commitment?: Commitment;
}

export interface RequestWithdrawalResult {
  signature: string;
  withdrawalPda: string;
  nonce: bigint;
}

export interface DepositAccountInfo {
  depositPda: string;
  owner: string;
  xmrDepositAddress: string;
  totalDeposited: bigint;
  status: "pending" | "active" | "closed";
  createdAt: number;
}

export interface DepositAccountOptions {
  connection: Connection;
  signer: Keypair;
  programId?: PublicKey | string;
  commitment?: Commitment;
}

const PRIORITY_FEE_MICROLAMPORTS = 50_000;
const COMPUTE_UNIT_LIMIT = 100_000;
export const WITHDRAWAL_CANCEL_DELAY_SECONDS = 300;

// A legacy request may have used a random u64 nonce above any timestamp.
// Read the retained watermark rather than assuming Date.now() exceeds it.
export async function getNextWithdrawalNonce(
  connection: Connection, user: PublicKey,
  programId: PublicKey | string = BRIDGE_PROGRAM_ID,
): Promise<bigint> {
  const id = getBridgeProgramId(programId);
  const statePda = PublicKey.findProgramAddressSync([Buffer.from('withdrawal_state'), user.toBuffer()], id)[0];
  const info = await connection.getAccountInfo(statePda, 'confirmed');
  let minimum = 1n;
  if (info) {
    if (!info.owner.equals(id)) throw new Error('Invalid withdrawal nonce account');
    const program = createBridgeProgram(connection, createReadonlyWallet(user), 'confirmed');
    const state = program.coder.accounts.decode('userWithdrawalState', info.data);
    if (!state.user.equals(user)) throw new Error('Invalid withdrawal nonce owner');
    minimum = BigInt(state.lastNonce.toString()) + 1n;
  }
  if (minimum > 0xffffffffffffffffn) throw new Error('This wallet has exhausted its withdrawal nonces');
  const timestamp = BigInt(Date.now());
  return minimum > timestamp ? minimum : timestamp;
}

export async function buildCancelWithdrawalTransaction(options: {
  connection: Connection; user: PublicKey; withdrawalPda: PublicKey | string;
  programId?: PublicKey | string;
}): Promise<{ transaction: Transaction; refundAmount: bigint }> {
  const id = getBridgeProgramId(options.programId);
  const withdrawal = new PublicKey(options.withdrawalPda);
  const program = createBridgeProgram(options.connection, createReadonlyWallet(options.user), 'confirmed');
  const [info, clock] = await options.connection.getMultipleAccountsInfo([withdrawal, SYSVAR_CLOCK_PUBKEY], 'confirmed');
  if (!info) throw new Error('This withdrawal has already been closed. Refresh its status.');
  if (!info.owner.equals(id)) throw new Error('Invalid withdrawal account');
  const record = program.coder.accounts.decode('withdrawalRecord', info.data);
  if (!record.user.equals(options.user) || !getWithdrawalPda(options.user, BigInt(record.nonce.toString()), id).equals(withdrawal)) {
    throw new Error('Only the withdrawal owner can cancel this request');
  }
  if (!('pending' in record.status)) throw new Error('This withdrawal is already being sent and cannot be canceled');
  if (!clock || clock.data.length < 40) throw new Error('Unable to check the withdrawal age');
  if (clock.data.readBigInt64LE(32) - BigInt(record.createdAt.toString()) < BigInt(WITHDRAWAL_CANCEL_DELAY_SECONDS)) {
    throw new Error('Wait until the withdrawal is five minutes old before canceling');
  }
  const configPda = getBridgeConfigPda(id);
  const config = await program.account.bridgeConfig.fetch(configPda);
  const userTokenAccount = await getAssociatedTokenAddress(config.wxmrMint, options.user);
  const withdrawalState = PublicKey.findProgramAddressSync([Buffer.from('withdrawal_state'), options.user.toBuffer()], id)[0];
  const instruction = await program.methods.cancelWithdrawal().accountsStrict({
    config: configPda, withdrawal, wxmrMint: config.wxmrMint, userTokenAccount,
    user: options.user, authority: config.authority, withdrawalState,
    tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  }).instruction();
  return { transaction: new Transaction().add(...getPriorityFeeInstructions(), instruction), refundAmount: BigInt(record.amount.toString()) };
}

export function getBridgeProgramId(programId: PublicKey | string = BRIDGE_PROGRAM_ID): PublicKey {
  return typeof programId === "string" ? new PublicKey(programId) : programId;
}

export function getBridgeConfigPda(programId: PublicKey | string = BRIDGE_PROGRAM_ID): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    getBridgeProgramId(programId),
  );
  return pda;
}

export function getWithdrawalPda(
  user: PublicKey,
  nonce: bigint,
  programId: PublicKey | string = BRIDGE_PROGRAM_ID,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("withdrawal"),
      user.toBuffer(),
      new BN(nonce.toString()).toArrayLike(Buffer, "le", 8),
    ],
    getBridgeProgramId(programId),
  );
  return pda;
}

export function getDepositPda(
  owner: PublicKey,
  programId: PublicKey | string = BRIDGE_PROGRAM_ID,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("deposit"), owner.toBuffer()],
    getBridgeProgramId(programId),
  );
  return pda;
}

export function getPriorityFeeInstructions() {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICROLAMPORTS }),
  ];
}

export function createKeypairWallet(signer: Keypair): AnchorProviderWallet {
  return {
    publicKey: signer.publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
      if (tx instanceof VersionedTransaction) {
        tx.sign([signer]);
      } else {
        tx.partialSign(signer);
      }
      return tx;
    },
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> =>
      txs.map((tx) => {
        if (tx instanceof VersionedTransaction) {
          tx.sign([signer]);
        } else {
          tx.partialSign(signer);
        }
        return tx;
      }),
  };
}

export function createReadonlyWallet(publicKey: PublicKey): AnchorProviderWallet {
  return {
    publicKey,
    signTransaction: async () => {
      throw new Error("readonly wallet cannot sign transactions");
    },
    signAllTransactions: async () => {
      throw new Error("readonly wallet cannot sign transactions");
    },
  };
}

export function createBridgeProgram(
  connection: Connection,
  wallet: AnchorProviderWallet,
  commitment: Commitment = "confirmed",
): AnchorProgram<WxmrBridge> {
  const provider = new AnchorProvider(connection, wallet, { commitment });
  return new Program<WxmrBridge>(IDL as WxmrBridge, provider);
}

export async function fetchBridgeConfig(
  connection: Connection,
  wallet: AnchorProviderWallet,
  programId: PublicKey | string = BRIDGE_PROGRAM_ID,
): Promise<BridgeConfig> {
  const program = createBridgeProgram(connection, wallet);
  const config = await program.account.bridgeConfig.fetch(getBridgeConfigPda(programId));
  return {
    authority: config.authority.toBase58(),
    wxmrMint: config.wxmrMint.toBase58(),
    totalDeposits: BigInt(config.totalDeposits.toString()),
    totalWithdrawals: BigInt(config.totalWithdrawals.toString()),
  };
}

export async function createDepositAccountWithKeypair(
  options: DepositAccountOptions,
): Promise<{ signature: string; depositPda: string }> {
  const programId = getBridgeProgramId(options.programId);
  const wallet = createKeypairWallet(options.signer);
  const program = createBridgeProgram(options.connection, wallet, options.commitment ?? "confirmed");
  const config = await program.account.bridgeConfig.fetch(getBridgeConfigPda(programId));
  const wxmrMint = config.wxmrMint as PublicKey;
  const ownerTokenAccount = await getAssociatedTokenAddress(wxmrMint, options.signer.publicKey);
  const createTokenAccountInstruction = createAssociatedTokenAccountIdempotentInstruction(
    options.signer.publicKey,
    ownerTokenAccount,
    options.signer.publicKey,
    wxmrMint,
    TOKEN_PROGRAM_ID,
  );
  const signature = await program.methods
    .createDepositAccount()
    .accountsPartial({
      config: getBridgeConfigPda(programId),
      user: options.signer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions([createTokenAccountInstruction, ...getPriorityFeeInstructions()])
    .rpc();

  return {
    signature,
    depositPda: getDepositPda(options.signer.publicKey, programId).toBase58(),
  };
}

export async function fetchDepositAccount(
  connection: Connection,
  owner: PublicKey,
  programId: PublicKey | string = BRIDGE_PROGRAM_ID,
): Promise<DepositAccountInfo | null> {
  const wallet = createKeypairWallet(Keypair.generate());
  const program = createBridgeProgram(connection, wallet);
  const depositPda = getDepositPda(owner, programId);
  try {
    const deposit = await program.account.depositRecord.fetch(depositPda);
    return decodeDepositAccount(depositPda, deposit);
  } catch {
    return null;
  }
}

export async function findDepositAccountByXmrAddress(
  connection: Connection,
  xmrAddress: string,
  programId: PublicKey | string = BRIDGE_PROGRAM_ID,
): Promise<DepositAccountInfo | null> {
  const normalizedAddress = xmrAddress.trim();
  if (!normalizedAddress) return null;

  const wallet = createKeypairWallet(Keypair.generate());
  const program = createBridgeProgram(connection, wallet);
  try {
    const deposits = await program.account.depositRecord.all();
    const match = deposits.find(({ account }) => account.xmrDepositAddress === normalizedAddress);
    return match ? decodeDepositAccount(match.publicKey, match.account) : null;
  } catch {
    return null;
  }
}

export async function claimPendingMintWithKeypair(
  options: DepositAccountOptions,
): Promise<string> {
  const programId = getBridgeProgramId(options.programId);
  const wallet = createKeypairWallet(options.signer);
  const program = createBridgeProgram(options.connection, wallet, options.commitment ?? "confirmed");
  const config = await program.account.bridgeConfig.fetch(getBridgeConfigPda(programId));
  const wxmrMint = config.wxmrMint as PublicKey;
  const authority = config.authority as PublicKey;
  const depositPda = getDepositPda(options.signer.publicKey, programId);
  const pendingTokenAccount = await getAssociatedTokenAddress(wxmrMint, depositPda, true, TOKEN_PROGRAM_ID);
  const ownerTokenAccount = await getAssociatedTokenAddress(wxmrMint, options.signer.publicKey, false, TOKEN_PROGRAM_ID);
  const createOwnerTokenAccountInstruction = createAssociatedTokenAccountIdempotentInstruction(
    options.signer.publicKey,
    ownerTokenAccount,
    options.signer.publicKey,
    wxmrMint,
    TOKEN_PROGRAM_ID,
  );

  return program.methods
    .claimPendingMint()
    .accountsPartial({
      config: getBridgeConfigPda(programId),
      deposit: depositPda,
      owner: options.signer.publicKey,
      pendingTokenAccount,
      ownerTokenAccount,
      wxmrMint,
      authority,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions([createOwnerTokenAccountInstruction, ...getPriorityFeeInstructions()])
    .rpc();
}

export async function requestWithdrawalWithKeypair(
  options: RequestWithdrawalOptions,
): Promise<RequestWithdrawalResult> {
  const built = await buildRequestWithdrawalTransaction({
    connection: options.connection,
    user: options.signer.publicKey,
    amount: options.amount,
    xmrAddress: options.xmrAddress,
    exactOut: options.exactOut,
    programId: options.programId,
    nonce: options.nonce,
    commitment: options.commitment,
  });
  const signature = await sendAndConfirmTransaction(options.connection, built.transaction, [options.signer], {
    commitment: options.commitment ?? "confirmed",
  });

  return {
    signature,
    withdrawalPda: built.withdrawalPda,
    nonce: built.nonce,
  };
}

export async function buildRequestWithdrawalTransaction(
  options: BuildRequestWithdrawalTransactionOptions,
): Promise<{ transaction: Transaction; withdrawalPda: string; nonce: bigint }> {
  const programId = getBridgeProgramId(options.programId);
  const wallet = createReadonlyWallet(options.user);
  const program = createBridgeProgram(options.connection, wallet, options.commitment ?? "confirmed");
  const config = await program.account.bridgeConfig.fetch(getBridgeConfigPda(programId));
  const wxmrMint = config.wxmrMint as PublicKey;
  const userTokenAccount = await getAssociatedTokenAddress(wxmrMint, options.user);
  const nonce = options.nonce ?? await getNextWithdrawalNonce(options.connection, options.user, programId);
  const withdrawalPda = getWithdrawalPda(options.user, nonce, programId);
  const instruction = await program.methods
    .requestWithdrawal(
      new BN(nonce.toString()),
      new BN(options.amount.toString()),
      options.xmrAddress,
      options.exactOut ?? false,
    )
    .accountsPartial({
      config: getBridgeConfigPda(programId),
      userTokenAccount,
      wxmrMint,
      user: options.user,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions(getPriorityFeeInstructions())
    .instruction();

  const transaction = new Transaction().add(instruction);

  return {
    transaction,
    withdrawalPda: withdrawalPda.toBase58(),
    nonce,
  };
}

function decodeDepositAccount(depositPda: PublicKey, deposit: {
  owner: PublicKey;
  xmrDepositAddress?: string;
  totalDeposited?: { toString(): string };
  status: Record<string, unknown>;
  createdAt: { toNumber(): number };
}): DepositAccountInfo {
  let status: DepositAccountInfo["status"] = "pending";
  if ("active" in deposit.status) status = "active";
  else if ("closed" in deposit.status) status = "closed";

  return {
    depositPda: depositPda.toBase58(),
    owner: deposit.owner.toBase58(),
    xmrDepositAddress: deposit.xmrDepositAddress || "",
    totalDeposited: BigInt(deposit.totalDeposited?.toString() ?? "0"),
    status,
    createdAt: deposit.createdAt.toNumber(),
  };
}

export { IDL as WXMR_BRIDGE_IDL, SystemProgram };
export type { WxmrBridge };

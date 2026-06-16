import anchor from "@coral-xyz/anchor";
import type { Program as AnchorProgram } from "@coral-xyz/anchor";
import {
  type Commitment,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
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

const { AnchorProvider, BN, Program } = anchor;

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
  const programId = getBridgeProgramId(options.programId);
  const wallet = createKeypairWallet(options.signer);
  const program = createBridgeProgram(options.connection, wallet, options.commitment ?? "confirmed");
  const config = await program.account.bridgeConfig.fetch(getBridgeConfigPda(programId));
  const wxmrMint = config.wxmrMint as PublicKey;
  const userTokenAccount = await getAssociatedTokenAddress(wxmrMint, options.signer.publicKey);
  const nonce = options.nonce ?? BigInt(Date.now());
  const withdrawalPda = getWithdrawalPda(options.signer.publicKey, nonce, programId);
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
      user: options.signer.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions(getPriorityFeeInstructions())
    .instruction();

  const transaction = new Transaction().add(instruction);
  const signature = await sendAndConfirmTransaction(options.connection, transaction, [options.signer], {
    commitment: options.commitment ?? "confirmed",
  });

  return {
    signature,
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

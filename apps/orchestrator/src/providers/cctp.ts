import { createHash } from "node:crypto";
import {
  AccountMeta,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  type Connection,
  type Keypair,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  CCTP_V2,
  CHAINS,
  USDC_MINT,
  buildEvmCctpBurnFunding,
  decodeCctpV2Nonce,
  getCctpAttestationUrl,
  solanaPublicKeyToBytes32,
  type CctpAttestationResponse,
  type EvmCctpBurnFunding,
  type Order,
} from "@wxmr/core";

export class CctpProvider {
  readonly id = "cctp";

  constructor(
    private readonly connection: Connection,
    private readonly hotWallet: Keypair,
    private readonly hotWalletUsdcAta: PublicKey,
    private readonly attestationBaseUrl: string,
  ) {}

  buildFunding(order: Order): EvmCctpBurnFunding {
    return buildEvmCctpBurnFunding({
      orderId: order.id,
      sourceChain: order.sourceChain,
      amount: order.amount,
      mintRecipient: this.hotWalletUsdcAta,
      destinationCaller: this.hotWallet.publicKey,
    });
  }

  async fetchAttestation(order: Order): Promise<{ message: `0x${string}`; attestation: `0x${string}` }> {
    if (!order.sourceTxHash) {
      throw new Error("Order has no source transaction hash");
    }
    const chain = CHAINS[order.sourceChain];
    if (typeof chain.cctpDomain !== "number") {
      throw new Error(`${order.sourceChain} is not a CCTP source chain`);
    }

    const response = await fetch(getCctpAttestationUrl(chain.cctpDomain, order.sourceTxHash, this.attestationBaseUrl));
    const data = (await response.json().catch(() => ({}))) as CctpAttestationResponse;
    const message = data.messages?.[0];

    if (!response.ok && isTransientAttestationMiss(data.error)) {
      throw new Error(`Circle attestation pending: ${data.error}`);
    }
    if (!response.ok) {
      throw new Error(data.error || `Circle attestation request failed: ${response.status}`);
    }
    if (!message || message.attestation === "PENDING") {
      throw new Error("Circle attestation pending");
    }
    if (!message.message || !message.attestation) {
      throw new Error("Circle attestation response missing message or attestation");
    }
    return { message: message.message, attestation: message.attestation };
  }

  async receiveMessage(order: Order, messageHex: string, attestationHex: string): Promise<string> {
    const chain = CHAINS[order.sourceChain];
    if (chain.kind !== "evm" || typeof chain.cctpDomain !== "number" || !chain.usdc) {
      throw new Error(`${order.sourceChain} cannot be finalized through CCTP receiveMessage`);
    }

    const messageTransmitterProgram = new PublicKey(CCTP_V2.solana.messageTransmitter);
    const tokenMessengerMinterProgram = new PublicKey(CCTP_V2.solana.tokenMessengerMinter);
    const nonce = decodeCctpV2Nonce(messageHex);
    const remoteTokenBytes32 = evmAddressToBytes32(chain.usdc);
    const remoteDomain = chain.cctpDomain.toString();
    const pdas = await this.getReceiveMessagePdas(
      messageTransmitterProgram,
      tokenMessengerMinterProgram,
      remoteDomain,
      remoteTokenBytes32,
      nonce,
    );

    const remainingAccounts: AccountMeta[] = [
      readonly(pdas.tokenMessengerAccount.publicKey),
      readonly(pdas.remoteTokenMessengerKey.publicKey),
      writable(pdas.tokenMinterAccount.publicKey),
      writable(pdas.localToken.publicKey),
      readonly(pdas.tokenPair.publicKey),
      writable(pdas.feeRecipientTokenAccount),
      writable(this.hotWalletUsdcAta),
      writable(pdas.custodyTokenAccount.publicKey),
      readonly(TOKEN_PROGRAM_ID),
      readonly(pdas.tokenMessengerEventAuthority.publicKey),
      readonly(tokenMessengerMinterProgram),
    ];

    const instruction = new TransactionInstruction({
      programId: messageTransmitterProgram,
      keys: [
        writableSigner(this.hotWallet.publicKey),
        readonlySigner(this.hotWallet.publicKey),
        readonly(pdas.authorityPda),
        readonly(pdas.messageTransmitterAccount.publicKey),
        writable(pdas.usedNonce),
        readonly(tokenMessengerMinterProgram),
        readonly(SystemProgram.programId),
        ...remainingAccounts,
      ],
      data: encodeReceiveMessageData(hexToBuffer(messageHex), hexToBuffer(attestationHex)),
    });

    const transaction = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        this.hotWallet.publicKey,
        this.hotWalletUsdcAta,
        this.hotWallet.publicKey,
        USDC_MINT,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
      instruction,
    );

    return sendAndConfirmTransaction(this.connection, transaction, [this.hotWallet], {
      commitment: "confirmed",
    });
  }

  private async getReceiveMessagePdas(
    messageTransmitterProgram: PublicKey,
    tokenMessengerMinterProgram: PublicKey,
    remoteDomain: string,
    remoteTokenBytes32: Buffer,
    nonce: Buffer,
  ) {
    const tokenMessengerAccount = findProgramAddress("token_messenger", tokenMessengerMinterProgram);
    const messageTransmitterAccount = findProgramAddress("message_transmitter", messageTransmitterProgram);
    const tokenMinterAccount = findProgramAddress("token_minter", tokenMessengerMinterProgram);
    const localToken = findProgramAddress("local_token", tokenMessengerMinterProgram, [USDC_MINT]);
    const remoteTokenMessengerKey = findProgramAddress("remote_token_messenger", tokenMessengerMinterProgram, [remoteDomain]);
    const remoteTokenKey = new PublicKey(remoteTokenBytes32);
    const tokenPair = findProgramAddress("token_pair", tokenMessengerMinterProgram, [remoteDomain, remoteTokenKey]);
    const custodyTokenAccount = findProgramAddress("custody", tokenMessengerMinterProgram, [USDC_MINT]);
    const authorityPda = findProgramAddress(
      "message_transmitter_authority",
      messageTransmitterProgram,
      [tokenMessengerMinterProgram],
    ).publicKey;
    const tokenMessengerEventAuthority = findProgramAddress("__event_authority", tokenMessengerMinterProgram);
    const usedNonce = findProgramAddress("used_nonce", messageTransmitterProgram, [nonce]).publicKey;
    const feeRecipient = await this.fetchTokenMessengerFeeRecipient(tokenMessengerAccount.publicKey);
    const feeRecipientTokenAccount = getAssociatedTokenAddressSync(USDC_MINT, feeRecipient);

    return {
      tokenMessengerAccount,
      messageTransmitterAccount,
      tokenMinterAccount,
      localToken,
      remoteTokenMessengerKey,
      tokenPair,
      custodyTokenAccount,
      authorityPda,
      tokenMessengerEventAuthority,
      usedNonce,
      feeRecipientTokenAccount,
    };
  }

  private async fetchTokenMessengerFeeRecipient(tokenMessenger: PublicKey): Promise<PublicKey> {
    const account = await this.connection.getAccountInfo(tokenMessenger, "confirmed");
    if (!account) {
      throw new Error("CCTP token messenger account not found");
    }
    const feeRecipientOffset = 8 + 32 + 32 + 32 + 4 + 1;
    return new PublicKey(account.data.subarray(feeRecipientOffset, feeRecipientOffset + 32));
  }
}

function encodeReceiveMessageData(message: Buffer, attestation: Buffer): Buffer {
  return Buffer.concat([
    discriminator("global:receive_message"),
    encodeVec(message),
    encodeVec(attestation),
  ]);
}

function discriminator(name: string): Buffer {
  return createHash("sha256").update(name).digest().subarray(0, 8);
}

function encodeVec(value: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32LE(value.length, 0);
  return Buffer.concat([length, value]);
}

function findProgramAddress(
  label: string,
  programId: PublicKey,
  extraSeeds: Array<string | Buffer | PublicKey> = [],
): { publicKey: PublicKey; bump: number } {
  const seeds: Uint8Array[] = [Buffer.from(label)];
  for (const seed of extraSeeds) {
    if (typeof seed === "string") seeds.push(Buffer.from(seed));
    else if (Buffer.isBuffer(seed)) seeds.push(new Uint8Array(seed));
    else seeds.push(seed.toBuffer());
  }
  const [publicKey, bump] = PublicKey.findProgramAddressSync(seeds, programId);
  return { publicKey, bump };
}

function evmAddressToBytes32(address: string): Buffer {
  const hex = address.replace(/^0x/, "").padStart(64, "0");
  return Buffer.from(hex, "hex");
}

function hexToBuffer(hex: string): Buffer {
  return Buffer.from(hex.replace(/^0x/, ""), "hex");
}

function isTransientAttestationMiss(error?: string): boolean {
  return Boolean(error?.toLowerCase().includes("message not found"));
}

function writable(pubkey: PublicKey): AccountMeta {
  return { pubkey, isSigner: false, isWritable: true };
}

function readonly(pubkey: PublicKey): AccountMeta {
  return { pubkey, isSigner: false, isWritable: false };
}

function writableSigner(pubkey: PublicKey): AccountMeta {
  return { pubkey, isSigner: true, isWritable: true };
}

function readonlySigner(pubkey: PublicKey): AccountMeta {
  return { pubkey, isSigner: true, isWritable: false };
}

export function buildSolanaDestinationCaller(publicKey: PublicKey): `0x${string}` {
  return solanaPublicKeyToBytes32(publicKey);
}

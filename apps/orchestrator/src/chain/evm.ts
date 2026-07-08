import { getSwapFromEvmTxPayload } from "@mayanfinance/swap-sdk";
import type { Quote as MayanSdkQuote } from "@mayanfinance/swap-sdk";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  http,
  keccak256,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import {
  CHAINS,
  ERC20_ALLOWANCE_ABI,
  ERC20_APPROVE_ABI,
  ERC20_BALANCE_OF_ABI,
  MAYAN,
  isEvmNativeToken,
  type MayanSwiftQuote,
  type SourceChainId,
} from "@wxmr/core";

// Blocks a detected deposit must age before the worker acts on it. Heuristic
// per-chain reorg guards, not finality proofs — execution re-quotes anyway,
// so the exposure is the deposit amount, not a locked rate.
export const EVM_DEPOSIT_CONFIRMATIONS: Partial<Record<SourceChainId, bigint>> = {
  ethereum: 2n,
  bsc: 3n,
  polygon: 15n,
  avalanche: 1n,
  base: 5n,
  arbitrum: 5n,
  optimism: 5n,
  linea: 5n,
  hyperevm: 5n,
  monad: 10n,
};
const DEFAULT_CONFIRMATIONS = 3n;

export function evmDepositConfirmations(chainId: SourceChainId): bigint {
  const override = process.env.EVM_DEPOSIT_CONFIRMATIONS;
  if (override && Number.isFinite(Number(override))) return BigInt(override);
  return EVM_DEPOSIT_CONFIRMATIONS[chainId] ?? DEFAULT_CONFIRMATIONS;
}

const APPROVE_GAS_UNITS = 80_000n;
const FORWARD_GAS_UNITS = 550_000n;
const NATIVE_TRANSFER_GAS_UNITS = 21_000n;
const ERC20_TRANSFER_GAS_UNITS = 80_000n;
// Numerator/denominator for the fee-headroom buffer applied to gas estimates.
const GAS_BUFFER_NUM = 13n;
const GAS_BUFFER_DEN = 10n;

const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const THORCHAIN_ROUTER_ABI = [
  {
    type: "function",
    name: "depositWithExpiry",
    stateMutability: "payable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "memo", type: "string" },
      { name: "expiration", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export class EvmExecutor {
  private readonly publicClients = new Map<SourceChainId, PublicClient>();
  private readonly viemChains = new Map<SourceChainId, Chain>();

  constructor(
    private readonly account: PrivateKeyAccount,
    private readonly rpcUrlByChain: Partial<Record<SourceChainId, string>>,
    private readonly mayanApiKey?: string,
  ) {}

  get address(): Address {
    return this.account.address;
  }

  hasChain(chainId: SourceChainId): boolean {
    return Boolean(this.rpcUrlByChain[chainId]);
  }

  private viemChain(chainId: SourceChainId): Chain {
    const cached = this.viemChains.get(chainId);
    if (cached) return cached;
    const config = CHAINS[chainId];
    const rpcUrl = this.rpcUrlByChain[chainId];
    if (config.kind !== "evm" || !config.chainId || !rpcUrl) {
      throw new Error(`no EVM RPC configured for ${chainId}`);
    }
    const chain = defineChain({
      id: config.chainId,
      name: config.name,
      nativeCurrency: { name: config.nativeCurrency ?? "ETH", symbol: config.nativeCurrency ?? "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    this.viemChains.set(chainId, chain);
    return chain;
  }

  private publicClient(chainId: SourceChainId): PublicClient {
    const cached = this.publicClients.get(chainId);
    if (cached) return cached;
    const chain = this.viemChain(chainId);
    const client = createPublicClient({ chain, transport: http(this.rpcUrlByChain[chainId]) });
    this.publicClients.set(chainId, client);
    return client;
  }

  private walletClient(chainId: SourceChainId, account: PrivateKeyAccount) {
    return createWalletClient({ account, chain: this.viemChain(chainId), transport: http(this.rpcUrlByChain[chainId]) });
  }

  getBlockNumber(chainId: SourceChainId): Promise<bigint> {
    return this.publicClient(chainId).getBlockNumber();
  }

  getNativeBalance(chainId: SourceChainId, address: Address): Promise<bigint> {
    return this.publicClient(chainId).getBalance({ address });
  }

  getErc20Balance(chainId: SourceChainId, token: Address, address: Address): Promise<bigint> {
    return this.publicClient(chainId).readContract({
      address: token,
      abi: ERC20_BALANCE_OF_ABI,
      functionName: "balanceOf",
      args: [address],
    });
  }

  async getTransactionReceiptStatus(chainId: SourceChainId, hash: Hex): Promise<"success" | "reverted" | null> {
    const receipt = await this.publicClient(chainId).getTransactionReceipt({ hash }).catch(() => null);
    return receipt ? receipt.status : null;
  }

  async maxFeePerGas(chainId: SourceChainId): Promise<bigint> {
    const client = this.publicClient(chainId);
    try {
      const fees = await client.estimateFeesPerGas();
      if (fees.maxFeePerGas) return fees.maxFeePerGas;
    } catch {
      // chain without EIP-1559 support — fall through to legacy gas price
    }
    return client.getGasPrice();
  }

  /** Worst-case native cost of the approve (optional) + Mayan forward legs, with headroom. */
  async forwardGasCost(chainId: SourceChainId, includeApprove: boolean): Promise<bigint> {
    const fee = await this.maxFeePerGas(chainId);
    const units = FORWARD_GAS_UNITS + (includeApprove ? APPROVE_GAS_UNITS : 0n);
    return (units * fee * GAS_BUFFER_NUM) / GAS_BUFFER_DEN;
  }

  async nativeTransferGasCost(chainId: SourceChainId): Promise<bigint> {
    const fee = await this.maxFeePerGas(chainId);
    return (NATIVE_TRANSFER_GAS_UNITS * fee * GAS_BUFFER_NUM) / GAS_BUFFER_DEN;
  }

  async erc20TransferGasCost(chainId: SourceChainId): Promise<bigint> {
    const fee = await this.maxFeePerGas(chainId);
    return (ERC20_TRANSFER_GAS_UNITS * fee * GAS_BUFFER_NUM) / GAS_BUFFER_DEN;
  }

  /** Tops up `to` with native gas money from the hot wallet. */
  async ensureNativeBalance(chainId: SourceChainId, to: Address, minWei: bigint): Promise<void> {
    const balance = await this.getNativeBalance(chainId, to);
    if (balance >= minWei) return;
    const needed = minWei - balance;
    const hotBalance = await this.getNativeBalance(chainId, this.account.address);
    if (hotBalance < needed) {
      throw new Error(
        `EVM hot wallet on ${chainId} holds ${hotBalance} wei but ${needed} wei of gas funding is needed — top it up`,
      );
    }
    const hash = await this.walletClient(chainId, this.account).sendTransaction({ to, value: needed });
    await this.publicClient(chainId).waitForTransactionReceipt({ hash });
  }

  async transferNative(chainId: SourceChainId, from: PrivateKeyAccount, to: Address, amount: bigint): Promise<Hex> {
    const hash = await this.walletClient(chainId, from).sendTransaction({ to, value: amount });
    await this.publicClient(chainId).waitForTransactionReceipt({ hash });
    return hash;
  }

  async transferErc20(chainId: SourceChainId, from: PrivateKeyAccount, token: Address, to: Address, amount: bigint): Promise<Hex> {
    const hash = await this.walletClient(chainId, from).writeContract({
      address: token,
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [to, amount],
    });
    await this.publicClient(chainId).waitForTransactionReceipt({ hash });
    return hash;
  }

  /** Hot-wallet Mayan forward on Ethereum (BTC eth-usdc fallback routes). */
  executeMayanSwift(quote: MayanSwiftQuote, destinationAddress: string): Promise<Hex> {
    return this.executeMayanSwiftFrom("ethereum", this.account, quote, destinationAddress);
  }

  async executeThorchainErc20Swap(params: {
    chainId: SourceChainId;
    token: Address;
    router: Address;
    vault: Address;
    amount: bigint;
    memo: string;
    expiry: bigint;
    onSigned?: (txHash: Hex) => void | Promise<void>;
  }): Promise<Hex> {
    if (params.amount <= 0n) throw new Error("THORChain swap amount must be positive");
    const publicClient = this.publicClient(params.chainId);
    const walletClient = this.walletClient(params.chainId, this.account);
    const balance = await this.getErc20Balance(params.chainId, params.token, this.account.address);
    if (balance < params.amount) {
      throw new Error(`EVM hot wallet holds ${balance} of ${params.token} on ${params.chainId}, below required ${params.amount}`);
    }
    const allowance = await publicClient.readContract({
      address: params.token,
      abi: ERC20_ALLOWANCE_ABI,
      functionName: "allowance",
      args: [this.account.address, params.router],
    });
    if (allowance < params.amount) {
      const approveHash = await walletClient.writeContract({
        address: params.token,
        abi: ERC20_APPROVE_ABI,
        functionName: "approve",
        args: [params.router, params.amount],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
    }

    const data = encodeFunctionData({
      abi: THORCHAIN_ROUTER_ABI,
      functionName: "depositWithExpiry",
      args: [params.vault, params.token, params.amount, params.memo, params.expiry],
    });
    const request = await walletClient.prepareTransactionRequest({
      to: params.router,
      data,
      value: 0n,
    });
    const serializedTransaction = await walletClient.signTransaction(request);
    const hash = keccak256(serializedTransaction);
    await params.onSigned?.(hash);
    await publicClient.sendRawTransaction({ serializedTransaction });
    return hash;
  }

  /**
   * Signs the (approve +) Mayan Swift forwarder transaction from `signer` on
   * `chainId`. The forward is signed locally and its hash handed to `onSigned`
   * BEFORE broadcast, so callers can persist it for crash recovery; the
   * forward is not awaited to a receipt — the worker confirms it via
   * getTransactionReceiptStatus and tracks the swap through the Mayan
   * explorer.
   */
  async executeMayanSwiftFrom(
    chainId: SourceChainId,
    signer: PrivateKeyAccount,
    quote: MayanSwiftQuote,
    destinationAddress: string,
    onSigned?: (txHash: Hex) => void | Promise<void>,
  ): Promise<Hex> {
    const config = CHAINS[chainId];
    if (config.kind !== "evm" || !config.chainId) {
      throw new Error(`chain ${chainId} is not an EVM Mayan source`);
    }
    const publicClient = this.publicClient(chainId);
    const walletClient = this.walletClient(chainId, signer);
    const token = quote.fromToken.contract as Address | undefined;
    const native = isEvmNativeToken(token);
    const amount = BigInt(quote.effectiveAmountIn64 ?? quote.expectedAmountOutBaseUnits);

    if (!native) {
      if (!token) throw new Error("Mayan quote is missing the input token contract");
      const balance = await this.getErc20Balance(chainId, token, signer.address);
      if (balance < amount) {
        throw new Error(`address ${signer.address} holds ${balance} of ${token} on ${chainId}, below required ${amount}`);
      }
      const allowance = await publicClient.readContract({
        address: token,
        abi: ERC20_ALLOWANCE_ABI,
        functionName: "allowance",
        args: [signer.address, MAYAN.forwarderContract],
      });
      if (allowance < amount) {
        const approveHash = await walletClient.writeContract({
          address: token,
          abi: ERC20_APPROVE_ABI,
          functionName: "approve",
          args: [MAYAN.forwarderContract, amount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }
    }

    const payload = await getSwapFromEvmTxPayload(
      quote as unknown as MayanSdkQuote,
      signer.address,
      destinationAddress,
      null,
      signer.address,
      config.chainId,
      null,
      null,
      { apiKey: this.mayanApiKey },
    );
    const request = await walletClient.prepareTransactionRequest({
      to: payload.to as Address,
      data: payload.data as Hex,
      value: BigInt((payload.value ?? "0x0") as string),
    });
    const serializedTransaction = await walletClient.signTransaction(request);
    const hash = keccak256(serializedTransaction);
    await onSigned?.(hash);
    await publicClient.sendRawTransaction({ serializedTransaction });
    return hash;
  }
}

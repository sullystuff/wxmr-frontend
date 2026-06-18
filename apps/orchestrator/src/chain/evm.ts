import { getSwapFromEvmTxPayload } from "@mayanfinance/swap-sdk";
import type { Quote as MayanSdkQuote } from "@mayanfinance/swap-sdk";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import {
  ERC20_ALLOWANCE_ABI,
  ERC20_APPROVE_ABI,
  ERC20_BALANCE_OF_ABI,
  MAYAN,
  type MayanSwiftQuote,
} from "@wxmr/core";

export class EvmExecutor {
  private readonly publicClient;
  private readonly walletClient;

  constructor(
    private readonly account: PrivateKeyAccount,
    rpcUrl: string,
    private readonly mayanApiKey?: string,
  ) {
    const transport = http(rpcUrl);
    this.publicClient = createPublicClient({ chain: mainnet, transport });
    this.walletClient = createWalletClient({ account, chain: mainnet, transport });
  }

  get address(): Address {
    return this.account.address;
  }

  async executeMayanSwift(quote: MayanSwiftQuote, destinationAddress: string): Promise<Hex> {
    const token = quote.fromToken.contract as Address | undefined;
    if (!token) throw new Error("Mayan ETH quote is missing the input token contract");
    const amount = BigInt(quote.effectiveAmountIn64 ?? quote.expectedAmountOutBaseUnits);
    const balance = await this.publicClient.readContract({
      address: token,
      abi: ERC20_BALANCE_OF_ABI,
      functionName: "balanceOf",
      args: [this.account.address],
    });
    if (balance < amount) {
      throw new Error(`EVM hot wallet USDC balance ${balance} is below required ${amount}`);
    }

    const allowance = await this.publicClient.readContract({
      address: token,
      abi: ERC20_ALLOWANCE_ABI,
      functionName: "allowance",
      args: [this.account.address, MAYAN.forwarderContract],
    });
    if (allowance < amount) {
      const approveHash = await this.walletClient.writeContract({
        address: token,
        abi: ERC20_APPROVE_ABI,
        functionName: "approve",
        args: [MAYAN.forwarderContract, amount],
      });
      await this.publicClient.waitForTransactionReceipt({ hash: approveHash });
    }

    const payload = await getSwapFromEvmTxPayload(
      quote as unknown as MayanSdkQuote,
      this.account.address,
      destinationAddress,
      null,
      this.account.address,
      mainnet.id,
      null,
      null,
      { apiKey: this.mayanApiKey },
    );
    const hash = await this.walletClient.sendTransaction({
      account: this.account,
      chain: mainnet,
      to: payload.to as Address,
      data: payload.data as Hex,
      value: BigInt((payload.value ?? "0x0") as string),
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }
}

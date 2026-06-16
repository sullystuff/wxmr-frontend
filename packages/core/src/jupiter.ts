import { USDC_MINT_ADDRESS, WXMR_MINT_ADDRESS } from "./constants.js";

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  routePlan: unknown[];
  transaction?: string | null;
  requestId?: string;
}

export interface JupiterClientOptions {
  apiKey?: string;
  fetch?: typeof fetch;
  baseUrl?: string;
}

export class JupiterClient {
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(options: JupiterClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://api.jup.ag/ultra/v1";
  }

  async quote(params: {
    inputMint: string;
    outputMint: string;
    amount: bigint | string;
    taker?: string;
  }): Promise<JupiterQuote> {
    const search = new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount.toString(),
    });

    if (params.taker) {
      search.set("taker", params.taker);
    }

    const response = await this.fetchImpl(`${this.baseUrl}/order?${search}`, {
      headers: this.headers(),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.errorCode || data.error) {
      throw new Error(data.errorMessage || data.error || `Jupiter quote failed: ${response.status}`);
    }

    return data as JupiterQuote;
  }

  quoteUsdcToWxmr(amount: bigint | string, taker?: string): Promise<JupiterQuote> {
    return this.quote({
      inputMint: USDC_MINT_ADDRESS,
      outputMint: WXMR_MINT_ADDRESS,
      amount,
      taker,
    });
  }

  quoteWxmrToUsdc(amount: bigint | string, taker?: string): Promise<JupiterQuote> {
    return this.quote({
      inputMint: WXMR_MINT_ADDRESS,
      outputMint: USDC_MINT_ADDRESS,
      amount,
      taker,
    });
  }

  async execute(signedTransactionBase64: string, requestId: string): Promise<{
    status: string;
    signature?: string;
    error?: string;
  }> {
    const response = await this.fetchImpl(`${this.baseUrl}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.headers(),
      },
      body: JSON.stringify({
        signedTransaction: signedTransactionBase64,
        requestId,
      }),
    });

    const data = await response.json().catch(() => ({}));
    return {
      status: data.status || "Failed",
      signature: data.signature,
      error: data.error || data.errorMessage,
    };
  }

  private headers(): Record<string, string> {
    return this.apiKey ? { "x-api-key": this.apiKey } : {};
  }
}

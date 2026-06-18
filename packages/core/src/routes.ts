import type { DepositReference, FundingInstructions, Order, Quote, QuoteRequest } from "./orders.js";

export interface RouteProvider {
  readonly id: "mayan" | "thorchain" | "chainflip";
  quote(input: QuoteRequest): Promise<Quote>;
  buildFunding(order: Order): Promise<FundingInstructions>;
  confirmDeposit(order: Order, ref: DepositReference): Promise<Order>;
  finalizeToSolanaUsdc(order: Order): Promise<Order>;
}

export class RouteSelector {
  constructor(private readonly providers: RouteProvider[]) {}

  select(input: QuoteRequest): RouteProvider {
    const provider = this.providers.find((candidate) => {
      if (candidate.id === "chainflip") return true;
      if (candidate.id === "mayan") return true;
      return candidate.id === "thorchain";
    });

    if (!provider) {
      throw new Error("No route provider available");
    }

    return provider;
  }
}

export class UnsupportedRouteProvider implements RouteProvider {
  constructor(
    readonly id: "mayan" | "thorchain" | "chainflip",
    private readonly message: string,
  ) {}

  quote(): Promise<Quote> {
    throw new Error(this.message);
  }

  buildFunding(): Promise<FundingInstructions> {
    throw new Error(this.message);
  }

  confirmDeposit(): Promise<Order> {
    throw new Error(this.message);
  }

  finalizeToSolanaUsdc(): Promise<Order> {
    throw new Error(this.message);
  }
}

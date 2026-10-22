import {
  PICONERO_PER_XMR,
  formatXmrAmount,
  validateMoneroAddress,
} from "@wxmr/core";

export interface MoneroPaymentRequest {
  address: string;
  /** An exact native XMR receive amount, normalized without floating point. */
  amount: string | null;
}

/** Parse plain addresses and Monero payment URIs without discarding payment terms. */
export function parseMoneroPaymentRequest(value: string): MoneroPaymentRequest {
  const input = value.trim();
  let address = input;
  let amount: string | null = null;
  if (/^monero:/i.test(input)) {
    const payload = input.slice(7);
    if (payload.includes("#"))
      throw new Error(
        "This Monero payment request contains an unsupported fragment.",
      );
    const separator = payload.indexOf("?");
    try {
      address = decodeURIComponent(
        separator < 0 ? payload : payload.slice(0, separator),
      );
    } catch {
      throw new Error("The Monero address in this QR code is malformed.");
    }
    const params = new URLSearchParams(
      separator < 0 ? "" : payload.slice(separator + 1),
    );
    if (params.get("tx_payment_id") || params.get("payment_id")) {
      throw new Error(
        "Separate payment IDs are not supported by this bridge. Use a compatible Monero address.",
      );
    }
    for (const key of params.keys()) {
      if (key.startsWith("req-"))
        throw new Error(
          `This payment request requires an unsupported field: ${key}.`,
        );
    }
    // tx_amount is the standard Monero URI field; some wallets use amount.
    const amounts = [...params.getAll("tx_amount"), ...params.getAll("amount")];
    if (amounts.length > 1)
      throw new Error(
        "This QR code contains multiple amounts. Use a request with one receive amount.",
      );
    if (amounts.length === 1) {
      const match = /^(\d+)(?:\.(\d{1,12}))?$/.exec(amounts[0]);
      if (!match)
        throw new Error(
          "The QR amount must be a positive XMR amount with at most 12 decimal places.",
        );
      const atomic =
        BigInt(match[1]) * PICONERO_PER_XMR +
        BigInt((match[2] ?? "").padEnd(12, "0"));
      if (atomic <= BigInt(0) || atomic > BigInt("18446744073709551615")) {
        throw new Error(
          "The XMR amount in this QR code is outside the supported range.",
        );
      }
      amount = formatXmrAmount(atomic);
    }
  }
  const validation = validateMoneroAddress(address);
  if (!validation.valid)
    throw new Error(
      `This is not a supported Monero address: ${validation.reason}.`,
    );
  return { address, amount };
}

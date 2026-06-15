export function isValidMoneroAddress(address: string): boolean {
  const value = address.trim();
  return (value.startsWith("4") || value.startsWith("8")) && value.length >= 95;
}

export function assertValidMoneroAddress(address: string): void {
  if (!isValidMoneroAddress(address)) {
    throw new Error("Invalid Monero address");
  }
}

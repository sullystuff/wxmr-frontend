import { PublicKey, VersionedTransaction } from "@solana/web3.js";

// The connected wallet is the user's signing authority. Wallets may wrap a
// Jupiter swap in safety instructions, rebuild account indexes, or sponsor it.
// Validate its required signature, not equality with the unsigned instruction list.
export function validateWalletSignedSwap(signed: VersionedTransaction, wallet: PublicKey) {
  const signerIndex = signed.message.staticAccountKeys.findIndex(key => key.equals(wallet));
  const signature = signed.signatures[signerIndex];
  if (signerIndex < 0 || !signed.message.isAccountSigner(signerIndex)
    || !signature || signature.length !== 64 || signature.every(byte => byte === 0)) {
    throw new Error("Your wallet did not sign this swap. Nothing was submitted.");
  }
}

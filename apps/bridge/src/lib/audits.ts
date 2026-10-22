import { Buffer } from "buffer";
import { BorshAccountsCoder, type Idl } from "@coral-xyz/anchor";
import IDL from "@wxmr/core/idl/wxmr_bridge.json";
import { BRIDGE_PROGRAM, readHistoryPage } from "./chain-history";
import { rpcResult } from "./rpc-client";

export async function fetchAuditPage(before?: string) {
  const { addresses, ...page } = await readHistoryPage(
    BRIDGE_PROGRAM,
    "audit",
    before,
  );
  const records = [];
  if (addresses.length) {
    const result = await rpcResult<{
      value: ({ owner: string; data: [string, string] } | null)[];
    }>("getMultipleAccounts", [
      addresses,
      { encoding: "base64", commitment: "finalized" },
    ]);
    const coder = new BorshAccountsCoder(IDL as Idl);
    for (const [index, info] of result.value.entries()) {
      if (!info || info.owner !== BRIDGE_PROGRAM.toBase58()) continue;
      const record = coder.decode(
        "AuditRecord",
        Buffer.from(info.data[0], "base64"),
      );
      if (record.data.startsWith('{"format":"wxmr-reserve-v1"')) {
        // Account uploads are incremental. Do not display a partial report as
        // either a reserve proof or a legacy consolidation audit.
        try {
          JSON.parse(record.data);
        } catch {
          continue;
        }
      }
      records.push({
        account: addresses[index],
        epoch: record.epoch.toNumber(),
        timestamp: record.timestamp.toNumber(),
        circulatingSupply: record.circulating_supply.toString(),
        spendableBalance: record.spendable_balance.toString(),
        unconfirmedBalance: record.unconfirmed_balance.toString(),
        data: record.data,
      });
    }
  }
  return {
    records: records.sort(
      (a, b) => b.timestamp - a.timestamp || b.epoch - a.epoch,
    ),
    ...page,
  };
}

// The heartbeat supplies the latest completed proof directly, independently of
// how many newer bridge transactions appear in the activity history.
export async function fetchReserveAccount(id: number, account: string) {
  const { PublicKey } = await import("@solana/web3.js");
  const { sha256 } = await import("@noble/hashes/sha256");
  const { parseReserveReport } = await import("./reserve-proof");
  const epoch = Buffer.alloc(8); epoch.writeBigUInt64LE(BigInt(id));
  const expected = PublicKey.findProgramAddressSync([Buffer.from("audit"), epoch], BRIDGE_PROGRAM)[0];
  if (expected.toBase58() !== account) throw new Error("Reserve proof address mismatch");
  const result = await rpcResult<{ value: { owner: string; data: [string,string] } | null }>("getAccountInfo", [account, { encoding: "base64", commitment: "finalized" }]);
  const info = result.value;
  if (!info || info.owner !== BRIDGE_PROGRAM.toBase58() || info.data[1] !== "base64") throw new Error("Reserve proof unavailable");
  const record = new BorshAccountsCoder(IDL as Idl).decode("AuditRecord", Buffer.from(info.data[0], "base64"));
  const report = parseReserveReport(record.data);
  if (!report || report.id !== id || record.epoch.toNumber() !== id || report.solana.program !== BRIDGE_PROGRAM.toBase58() ||
      report.solana.mint !== "WXMRyRZhsa19ety5erZhHg4N3xj3EVN92u94422teJp" || report.monero.network !== "mainnet" ||
      report.solana.supplyAtomic !== record.circulating_supply.toString() ||
      report.walletReported.unlockedAtomic !== record.spendable_balance.toString() ||
      BigInt(report.walletReported.balanceAtomic)-BigInt(report.walletReported.unlockedAtomic) !== BigInt(record.unconfirmed_balance.toString()) ||
      Buffer.from(sha256(new TextEncoder().encode(report.proof))).toString("hex") !== report.proofSha256) throw new Error("Invalid reserve proof report");
  return { account, report, data: record.data as string };
}

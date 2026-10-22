import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import { BRIDGE_PROGRAM } from "./chain-history";
import { rpcResult } from "./rpc-client";

export interface HeartbeatSnapshot {
  format: "wxmr-heartbeat-v1";
  observedAt: number;
  moneroHeight: number;
  balanceAtomic: string;
  unlockedAtomic: string;
  targetAtomic: string;
  unlocks: { blocks: number; amountAtomic: string; availableAtomic: string }[];
  deposits: {
    id: string; account: string; deposit: string; amountAtomic: string;
    confirmations: number; blocks: number;
    status: "confirming" | "minting" | "below-minimum" | "ready";
  }[];
  latestReserve: { account: string; id: number } | null;
}
export type Heartbeat = HeartbeatSnapshot & { generation: number; updatedAt: number; account: string };
export const HEARTBEAT_ACCOUNT = PublicKey.findProgramAddressSync([Buffer.from("heartbeat")], BRIDGE_PROGRAM)[0];
const discriminator = (name: string) => Buffer.from(sha256(new TextEncoder().encode(`account:${name}`)).slice(0, 8));
const integer = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
const amount = (x: unknown): x is string => typeof x === "string" && /^(0|[1-9]\d*)$/.test(x) && BigInt(x) <= BigInt("18446744073709551615");
const address = (x: unknown): x is string => {
  try { return typeof x === "string" && new PublicKey(x).toBase58() === x; } catch { return false; }
};
export function validateHeartbeat(value: unknown): HeartbeatSnapshot {
  const v = value as HeartbeatSnapshot;
  if (!v || v.format !== "wxmr-heartbeat-v1" || !integer(v.observedAt) || !integer(v.moneroHeight) ||
      !amount(v.balanceAtomic) || !amount(v.unlockedAtomic) || !amount(v.targetAtomic) ||
      BigInt(v.unlockedAtomic) > BigInt(v.balanceAtomic) || !Array.isArray(v.unlocks) || !Array.isArray(v.deposits)) throw new Error("Invalid heartbeat snapshot");
  let available = BigInt(v.unlockedAtomic), blocks = 0;
  for (const u of v.unlocks) {
    if (!integer(u.blocks) || u.blocks <= blocks || !amount(u.amountAtomic) || !amount(u.availableAtomic)) throw new Error("Invalid unlock schedule");
    blocks = u.blocks; available += BigInt(u.amountAtomic);
    if (available !== BigInt(u.availableAtomic) || available > BigInt(v.balanceAtomic)) throw new Error("Inconsistent unlock schedule");
  }
  const ids = new Set<string>();
  for (const d of v.deposits) {
    if (typeof d.id !== "string" || !/^[a-f0-9]{20}$/.test(d.id) || ids.has(d.id) || !address(d.account) || !address(d.deposit) ||
        !amount(d.amountAtomic) || !integer(d.confirmations) || !integer(d.blocks) || d.blocks !== Math.max(0, 10-d.confirmations) ||
        !["confirming", "minting", "below-minimum", "ready"].includes(d.status)) throw new Error("Invalid pending deposit");
    ids.add(d.id);
  }
  if (v.latestReserve !== null && (!address(v.latestReserve?.account) || !integer(v.latestReserve?.id))) throw new Error("Invalid reserve pointer");
  return v;
}
export function heartbeatOnline(heartbeat: Heartbeat, now = Date.now() / 1000): boolean {
  return heartbeat.updatedAt <= now + 30 && heartbeat.observedAt <= now + 30 &&
    now - heartbeat.updatedAt <= 360 && now - heartbeat.observedAt <= 360;
}
type AccountInfo = { owner: string; data: [string, string] };
function accountBytes(info: AccountInfo | null, name: string): Buffer {
  if (!info || info.owner !== BRIDGE_PROGRAM.toBase58() || info.data[1] !== "base64") throw new Error("Heartbeat account unavailable");
  const bytes = Buffer.from(info.data[0], "base64");
  if (!bytes.subarray(0,8).equals(discriminator(name))) throw new Error("Invalid heartbeat account type");
  return bytes;
}
export async function decodeHeartbeatPages(root: Buffer, pages: (AccountInfo | null)[]): Promise<HeartbeatSnapshot> {
  const generation = Number(root.readBigUInt64LE(8));
  const count = root.readUInt16LE(24);
  if (!Number.isSafeInteger(generation) || generation <= 0 || count < 1 || count > 128 || pages.length !== count) throw new Error("Incomplete heartbeat");
  const data = pages.map((info, index) => {
    const bytes = accountBytes(info, "HeartbeatPage");
    if (bytes.length < 22 || Number(bytes.readBigUInt64LE(8)) !== generation || bytes.readUInt16LE(16) !== index) throw new Error("Heartbeat is updating; retry shortly");
    const length = bytes.readUInt32LE(18);
    if (length < 1 || length > 700 || bytes.length < 22 + length) throw new Error("Invalid heartbeat page length");
    return bytes.subarray(22,22+length);
  });
  const compressed = Buffer.concat(data);
  if (!Buffer.from(sha256(compressed)).equals(root.subarray(26,58))) throw new Error("Heartbeat digest mismatch");
  const decompressor = new DecompressionStream("gzip");
  const writer = decompressor.writable.getWriter();
  const writing = writer.write(new Uint8Array(compressed)).then(() => writer.close());
  void writing.catch(() => {});
  const reader = decompressor.readable.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > 2_000_000) throw new Error("Heartbeat payload too large");
      chunks.push(part.value);
    }
    await writing;
  } finally { await reader.cancel(); }
  return validateHeartbeat(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}
let last: Heartbeat | null = null;
let pending: Promise<Heartbeat | null> | null = null;
let checked = 0;
export async function fetchHeartbeat(): Promise<Heartbeat | null> {
  if (pending) return pending;
  if (Date.now() - checked < 20_000) return last;
  pending = (async () => {
    const result = await rpcResult<{ context: { slot: number }; value: AccountInfo | null }>("getAccountInfo", [HEARTBEAT_ACCOUNT.toBase58(), { encoding: "base64", commitment: "finalized" }]);
    if (!result.value) { last = null; checked = Date.now(); return null; }
    const root = accountBytes(result.value, "Heartbeat");
    if (root.length !== 58) throw new Error("Invalid heartbeat header");
    const generation = Number(root.readBigUInt64LE(8)), updatedAt = Number(root.readBigInt64LE(16)), count = root.readUInt16LE(24);
    if (!integer(updatedAt) || !integer(generation) || count > 128) throw new Error("Invalid heartbeat header");
    if (generation === 0) { checked = Date.now(); return null; }
    if (last?.generation === generation) { checked = Date.now(); return last; }
    const addresses = Array.from({ length: count }, (_, index) => {
      const i = Buffer.alloc(2); i.writeUInt16LE(index);
      return PublicKey.findProgramAddressSync([Buffer.from("heartbeat-page"), Buffer.from([generation % 2]), i], BRIDGE_PROGRAM)[0].toBase58();
    });
    const pages: (AccountInfo | null)[] = [];
    const rootSlot = result.context.slot;
    for (let offset = 0; offset < addresses.length; offset += 100) {
      const result = await rpcResult<{ value: (AccountInfo | null)[] }>("getMultipleAccounts", [addresses.slice(offset,offset+100), { encoding: "base64", commitment: "finalized", minContextSlot: rootSlot }]);
      pages.push(...result.value);
    }
    const snapshot = await decodeHeartbeatPages(root, pages);
    last = { ...snapshot, generation, updatedAt, account: HEARTBEAT_ACCOUNT.toBase58() };
    checked = Date.now();
    return last;
  })();
  try { return await pending; } finally { pending = null; }
}

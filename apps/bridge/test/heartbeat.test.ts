import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { Buffer } from "buffer";
import { Keypair } from "@solana/web3.js";
import { BRIDGE_PROGRAM } from "../src/lib/chain-history";
import { decodeHeartbeatPages, heartbeatOnline, validateHeartbeat, type Heartbeat } from "../src/lib/heartbeat";
function fixture() {
  const snapshot = { format: "wxmr-heartbeat-v1", observedAt: 1000, moneroHeight: 100,
    balanceAtomic: "100000000000001", unlockedAtomic: "1", targetAtomic: "100000000000000",
    unlocks: [{ blocks: 5, amountAtomic: "100000000000000", availableAtomic: "100000000000001" }],
    deposits: [{ id: "a".repeat(20), account: Keypair.generate().publicKey.toBase58(), deposit: Keypair.generate().publicKey.toBase58(), amountAtomic: "100000000001", confirmations: 3, blocks: 7, status: "confirming" }], latestReserve: null };
  const compressed = gzipSync(Buffer.from(JSON.stringify(snapshot))), root = Buffer.alloc(58);
  root.writeBigUInt64LE(BigInt(1),8); root.writeBigInt64LE(BigInt(1000),16); root.writeUInt16LE(1,24);
  createHash("sha256").update(compressed).digest().copy(root,26);
  const page = Buffer.alloc(22+compressed.length);
  createHash("sha256").update("account:HeartbeatPage").digest().subarray(0,8).copy(page);
  page.writeBigUInt64LE(BigInt(1),8); page.writeUInt16LE(0,16); page.writeUInt32LE(compressed.length,18); compressed.copy(page,22);
  const info = () => ({ owner: BRIDGE_PROGRAM.toBase58(), data: [page.toString("base64"),"base64"] as [string,string] });
  return { snapshot, root, page, info };
}
test("reader verifies owner, generation and digest before decoding exact deposit amounts", async () => {
  const f = fixture(); assert.deepEqual(await decodeHeartbeatPages(f.root,[f.info()]),f.snapshot);
  await assert.rejects(decodeHeartbeatPages(f.root,[{ ...f.info(),owner:Keypair.generate().publicKey.toBase58() }]));
  f.page.writeBigUInt64LE(BigInt(2),8); await assert.rejects(decodeHeartbeatPages(f.root,[f.info()]),/updating/);
  f.page.writeBigUInt64LE(BigInt(1),8); f.page[30]^=1; await assert.rejects(decodeHeartbeatPages(f.root,[f.info()]),/digest/);
});
test("heartbeat expires at six minutes and a newly uploaded old observation stays offline", () => {
  const h = { ...fixture().snapshot, generation:1, updatedAt:1000, account:"test" } as Heartbeat;
  assert.equal(heartbeatOnline(h,1360),true); assert.equal(heartbeatOnline(h,1361),false);
  assert.equal(heartbeatOnline({ ...h,updatedAt:1400 },1400),false);
  assert.equal(heartbeatOnline({ ...h,observedAt:2000,updatedAt:2000 },1000),false);
});
test("invalid unlock totals, duplicate pending transfers and false confirmation ETAs are rejected", () => {
  const f = fixture();
  assert.throws(()=>validateHeartbeat({ ...f.snapshot,unlocks:[{blocks:5,amountAtomic:"10",availableAtomic:"100"}] }));
  assert.throws(()=>validateHeartbeat({ ...f.snapshot,deposits:[f.snapshot.deposits[0],f.snapshot.deposits[0]] }));
  assert.throws(()=>validateHeartbeat({ ...f.snapshot,deposits:[{...f.snapshot.deposits[0],blocks:0}] }));
});

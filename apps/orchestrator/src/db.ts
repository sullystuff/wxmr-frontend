import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import type { FundingInstructions, Order, OrderStatus, Quote } from "@wxmr/core";

export interface OrderRow {
  id: string;
  quote_id: string;
  status: OrderStatus;
  source_chain: string;
  source_token: string;
  amount: string;
  xmr_address: string;
  refund_address: string | null;
  funding_json: string;
  source_tx_hash: string | null;
  cctp_message: string | null;
  cctp_attestation: string | null;
  solana_mint_signature: string | null;
  swap_signature: string | null;
  withdrawal_signature: string | null;
  withdrawal_pda: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export class Store {
  readonly db: DatabaseType;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  insertQuote(quote: Quote): void {
    this.db
      .prepare(
        `INSERT INTO quotes (id, quote_json, expires_at, created_at)
         VALUES (@id, @quote_json, @expires_at, @created_at)`,
      )
      .run({
        id: quote.id,
        quote_json: JSON.stringify(quote),
        expires_at: quote.expiresAt,
        created_at: new Date().toISOString(),
      });
  }

  getQuote(id: string): Quote | null {
    const row = this.db.prepare("SELECT quote_json FROM quotes WHERE id = ?").get(id) as { quote_json: string } | undefined;
    return row ? (JSON.parse(row.quote_json) as Quote) : null;
  }

  createOrder(order: Order): void {
    this.db
      .prepare(
        `INSERT INTO orders (
          id, quote_id, status, source_chain, source_token, amount, xmr_address,
          refund_address, funding_json, created_at, updated_at, expires_at
        ) VALUES (
          @id, @quote_id, @status, @source_chain, @source_token, @amount,
          @xmr_address, @refund_address, @funding_json, @created_at, @updated_at, @expires_at
        )`,
      )
      .run({
        id: order.id,
        quote_id: order.quoteId,
        status: order.status,
        source_chain: order.sourceChain,
        source_token: order.sourceToken,
        amount: order.amount,
        xmr_address: order.xmrAddress,
        refund_address: order.refundAddress ?? null,
        funding_json: JSON.stringify(order.funding),
        created_at: order.createdAt,
        updated_at: order.updatedAt,
        expires_at: order.expiresAt,
      });
    this.addEvent(order.id, order.status, "order created");
  }

  getOrder(id: string): Order | null {
    const row = this.db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as OrderRow | undefined;
    return row ? rowToOrder(row) : null;
  }

  listOrdersByStatus(statuses: OrderStatus[], limit = 20): Order[] {
    const placeholders = statuses.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT * FROM orders WHERE status IN (${placeholders}) ORDER BY updated_at ASC LIMIT ?`)
      .all(...statuses, limit) as OrderRow[];
    return rows.map(rowToOrder);
  }

  updateOrder(id: string, patch: Partial<Order>, eventDetail?: string): Order {
    const current = this.getOrder(id);
    if (!current) throw new Error(`Order ${id} not found`);
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.db
      .prepare(
        `UPDATE orders SET
          status = @status,
          source_tx_hash = @source_tx_hash,
          cctp_message = @cctp_message,
          cctp_attestation = @cctp_attestation,
          solana_mint_signature = @solana_mint_signature,
          swap_signature = @swap_signature,
          withdrawal_signature = @withdrawal_signature,
          withdrawal_pda = @withdrawal_pda,
          error = @error,
          updated_at = @updated_at
        WHERE id = @id`,
      )
      .run({
        id,
        status: next.status,
        source_tx_hash: next.sourceTxHash ?? null,
        cctp_message: next.cctpMessage ?? null,
        cctp_attestation: next.cctpAttestation ?? null,
        solana_mint_signature: next.solanaMintSignature ?? null,
        swap_signature: next.swapSignature ?? null,
        withdrawal_signature: next.withdrawalSignature ?? null,
        withdrawal_pda: next.withdrawalPda ?? null,
        error: next.error ?? null,
        updated_at: next.updatedAt,
      });
    if (patch.status || eventDetail) {
      this.addEvent(id, next.status, eventDetail ?? `status -> ${next.status}`);
    }
    return next;
  }

  addEvent(orderId: string, status: OrderStatus, detail: string): void {
    this.db
      .prepare(
        `INSERT INTO order_events (order_id, status, detail, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(orderId, status, detail, new Date().toISOString());
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS quotes (
        id TEXT PRIMARY KEY,
        quote_json TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        quote_id TEXT NOT NULL REFERENCES quotes(id),
        status TEXT NOT NULL,
        source_chain TEXT NOT NULL,
        source_token TEXT NOT NULL,
        amount TEXT NOT NULL,
        xmr_address TEXT NOT NULL,
        refund_address TEXT,
        funding_json TEXT NOT NULL,
        source_tx_hash TEXT,
        cctp_message TEXT,
        cctp_attestation TEXT,
        solana_mint_signature TEXT,
        swap_signature TEXT,
        withdrawal_signature TEXT,
        withdrawal_pda TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS order_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT NOT NULL REFERENCES orders(id),
        status TEXT NOT NULL,
        detail TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_orders_status_updated ON orders(status, updated_at);
      CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id, created_at);
    `);
  }
}

function rowToOrder(row: OrderRow): Order {
  return {
    id: row.id,
    quoteId: row.quote_id,
    status: row.status,
    sourceChain: row.source_chain as Order["sourceChain"],
    sourceToken: row.source_token,
    amount: row.amount,
    xmrAddress: row.xmr_address,
    refundAddress: row.refund_address ?? undefined,
    funding: JSON.parse(row.funding_json) as FundingInstructions,
    sourceTxHash: row.source_tx_hash ?? undefined,
    cctpMessage: row.cctp_message ?? undefined,
    cctpAttestation: row.cctp_attestation ?? undefined,
    solanaMintSignature: row.solana_mint_signature ?? undefined,
    swapSignature: row.swap_signature ?? undefined,
    withdrawalSignature: row.withdrawal_signature ?? undefined,
    withdrawalPda: row.withdrawal_pda ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

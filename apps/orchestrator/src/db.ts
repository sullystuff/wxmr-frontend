import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import type { ExecutionPolicy, FundingInstructions, Order, OrderStatus, Quote } from "@wxmr/core";

export interface OrderRow {
  id: string;
  quote_id: string;
  direction: string | null;
  status: OrderStatus;
  source_chain: string;
  source_token: string;
  destination_chain: string | null;
  destination_token: string | null;
  amount: string;
  xmr_address: string;
  destination_address: string | null;
  destination_token_symbol: string | null;
  destination_token_decimals: number | null;
  refund_address: string | null;
  execution_policy: ExecutionPolicy | null;
  funding_json: string;
  source_tx_hash: string | null;
  destination_amount: string | null;
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
          id, quote_id, direction, status, source_chain, source_token, amount, xmr_address,
          destination_chain, destination_token, destination_address, destination_token_symbol, destination_token_decimals,
          refund_address, execution_policy, funding_json, created_at, updated_at, expires_at
        ) VALUES (
          @id, @quote_id, @direction, @status, @source_chain, @source_token, @amount,
          @xmr_address, @destination_chain, @destination_token, @destination_address, @destination_token_symbol, @destination_token_decimals,
          @refund_address, @execution_policy, @funding_json, @created_at, @updated_at, @expires_at
        )`,
      )
      .run({
        id: order.id,
        quote_id: order.quoteId,
        direction: order.direction,
        status: order.status,
        source_chain: order.sourceChain,
        source_token: order.sourceToken,
        destination_chain: order.destinationChain ?? null,
        destination_token: order.destinationToken ?? null,
        amount: order.amount,
        xmr_address: order.xmrAddress,
        destination_address: order.destinationAddress ?? null,
        destination_token_symbol: order.destinationTokenSymbol ?? null,
        destination_token_decimals: order.destinationTokenDecimals ?? null,
        refund_address: order.refundAddress ?? null,
        execution_policy: order.executionPolicy,
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
          funding_json = @funding_json,
          source_tx_hash = @source_tx_hash,
          destination_chain = @destination_chain,
          destination_token = @destination_token,
          destination_address = @destination_address,
          destination_token_symbol = @destination_token_symbol,
          destination_token_decimals = @destination_token_decimals,
          execution_policy = @execution_policy,
          destination_amount = @destination_amount,
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
        funding_json: JSON.stringify(next.funding),
        source_tx_hash: next.sourceTxHash ?? null,
        destination_chain: next.destinationChain ?? null,
        destination_token: next.destinationToken ?? null,
        destination_address: next.destinationAddress ?? null,
        destination_token_symbol: next.destinationTokenSymbol ?? null,
        destination_token_decimals: next.destinationTokenDecimals ?? null,
        execution_policy: next.executionPolicy,
        destination_amount: next.destinationAmount ?? null,
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
          direction TEXT NOT NULL DEFAULT 'mayan-to-xmr',
          status TEXT NOT NULL,
          source_chain TEXT NOT NULL,
          source_token TEXT NOT NULL,
          destination_chain TEXT,
          destination_token TEXT,
          amount TEXT NOT NULL,
          xmr_address TEXT NOT NULL,
          destination_address TEXT,
          destination_token_symbol TEXT,
          destination_token_decimals INTEGER,
          refund_address TEXT,
          execution_policy TEXT NOT NULL DEFAULT 'execute-anyway',
        funding_json TEXT NOT NULL,
        source_tx_hash TEXT,
        destination_amount TEXT,
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
    const columns = this.db.prepare("PRAGMA table_info(orders)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "destination_amount")) {
      this.db.exec("ALTER TABLE orders ADD COLUMN destination_amount TEXT");
    }
    if (!columns.some((column) => column.name === "direction")) {
      this.db.exec("ALTER TABLE orders ADD COLUMN direction TEXT NOT NULL DEFAULT 'mayan-to-xmr'");
    }
    if (!columns.some((column) => column.name === "destination_address")) {
      this.db.exec("ALTER TABLE orders ADD COLUMN destination_address TEXT");
    }
    if (!columns.some((column) => column.name === "destination_chain")) {
      this.db.exec("ALTER TABLE orders ADD COLUMN destination_chain TEXT");
    }
    if (!columns.some((column) => column.name === "destination_token")) {
      this.db.exec("ALTER TABLE orders ADD COLUMN destination_token TEXT");
    }
    if (!columns.some((column) => column.name === "destination_token_symbol")) {
      this.db.exec("ALTER TABLE orders ADD COLUMN destination_token_symbol TEXT");
    }
    if (!columns.some((column) => column.name === "destination_token_decimals")) {
      this.db.exec("ALTER TABLE orders ADD COLUMN destination_token_decimals INTEGER");
    }
    if (!columns.some((column) => column.name === "execution_policy")) {
      this.db.exec("ALTER TABLE orders ADD COLUMN execution_policy TEXT NOT NULL DEFAULT 'execute-anyway'");
    }
  }
}

function rowToOrder(row: OrderRow): Order {
  return {
    id: row.id,
    quoteId: row.quote_id,
    direction: (row.direction ?? "mayan-to-xmr") as Order["direction"],
    status: row.status,
    sourceChain: row.source_chain as Order["sourceChain"],
    sourceToken: row.source_token,
    destinationChain: (row.destination_chain ?? undefined) as Order["destinationChain"],
    destinationToken: row.destination_token ?? undefined,
    amount: row.amount,
    xmrAddress: row.xmr_address,
    destinationAddress: row.destination_address ?? undefined,
    destinationTokenSymbol: row.destination_token_symbol ?? undefined,
    destinationTokenDecimals: row.destination_token_decimals ?? undefined,
    refundAddress: row.refund_address ?? undefined,
    executionPolicy: normalizeExecutionPolicy(row.execution_policy),
    funding: JSON.parse(row.funding_json) as FundingInstructions,
    sourceTxHash: row.source_tx_hash ?? undefined,
    destinationAmount: row.destination_amount ?? undefined,
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

function normalizeExecutionPolicy(value: string | null): ExecutionPolicy {
  return value === "refund-on-slippage" ? "refund-on-slippage" : "execute-anyway";
}

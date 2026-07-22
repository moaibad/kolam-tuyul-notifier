import Database from 'better-sqlite3'
import type { Database as DatabaseType } from 'better-sqlite3'
import type { RangeStatus } from '../types.js'

export interface StoredPositionStatus {
  positionId: string
  lastStatus?: RangeStatus
  outOfRangeSinceMs?: number
}

export class StateDatabase {
  readonly db: DatabaseType

  constructor(path: string) {
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.migrate()
  }

  close() {
    this.db.close()
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS positions (
        position_id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        manager TEXT NOT NULL,
        token_id TEXT NOT NULL,
        mint_timestamp_ms INTEGER,
        mint_block TEXT
      );

      CREATE TABLE IF NOT EXISTS position_status (
        position_id TEXT PRIMARY KEY,
        last_status TEXT,
        out_of_range_since_ms INTEGER
      );

      CREATE TABLE IF NOT EXISTS cashflows (
        tx_hash TEXT NOT NULL,
        log_index INTEGER NOT NULL,
        position_id TEXT NOT NULL,
        block_number TEXT NOT NULL,
        timestamp_ms INTEGER NOT NULL,
        type TEXT NOT NULL,
        amount_usdg REAL NOT NULL,
        PRIMARY KEY (tx_hash, log_index)
      );

      CREATE TABLE IF NOT EXISTS token_metadata (
        address TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        decimals INTEGER NOT NULL
      );
    `)
  }

  getSyncBlock(key: string): bigint | undefined {
    const row = this.db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key) as { value: string } | undefined
    return row ? BigInt(row.value) : undefined
  }

  setSyncBlock(key: string, blockNumber: bigint) {
    this.db.prepare('INSERT INTO sync_state(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, blockNumber.toString())
  }

  upsertPosition(input: { positionId: string; version: string; manager: string; tokenId: bigint; mintTimestampMs?: number; mintBlock?: bigint }) {
    this.db
      .prepare(`
        INSERT INTO positions(position_id, version, manager, token_id, mint_timestamp_ms, mint_block)
        VALUES(?, ?, ?, ?, ?, ?)
        ON CONFLICT(position_id) DO UPDATE SET
          mint_timestamp_ms = COALESCE(excluded.mint_timestamp_ms, positions.mint_timestamp_ms),
          mint_block = COALESCE(excluded.mint_block, positions.mint_block)
      `)
      .run(input.positionId, input.version, input.manager, input.tokenId.toString(), input.mintTimestampMs ?? null, input.mintBlock?.toString() ?? null)
  }

  getMintTimestamp(positionId: string): number | undefined {
    const row = this.db.prepare('SELECT mint_timestamp_ms FROM positions WHERE position_id = ?').get(positionId) as { mint_timestamp_ms: number | null } | undefined
    return row?.mint_timestamp_ms ?? undefined
  }

  getPositionStatus(positionId: string): StoredPositionStatus {
    const row = this.db.prepare('SELECT last_status, out_of_range_since_ms FROM position_status WHERE position_id = ?').get(positionId) as { last_status: RangeStatus | null; out_of_range_since_ms: number | null } | undefined
    return { positionId, lastStatus: row?.last_status ?? undefined, outOfRangeSinceMs: row?.out_of_range_since_ms ?? undefined }
  }

  setPositionStatus(positionId: string, status: RangeStatus, outOfRangeSinceMs?: number) {
    this.db
      .prepare('INSERT INTO position_status(position_id, last_status, out_of_range_since_ms) VALUES(?, ?, ?) ON CONFLICT(position_id) DO UPDATE SET last_status = excluded.last_status, out_of_range_since_ms = excluded.out_of_range_since_ms')
      .run(positionId, status, outOfRangeSinceMs ?? null)
  }

  insertCashflow(input: { txHash: string; logIndex: number; positionId: string; blockNumber: bigint; timestampMs: number; type: string; amountUsdg: number }) {
    this.db
      .prepare('INSERT OR IGNORE INTO cashflows(tx_hash, log_index, position_id, block_number, timestamp_ms, type, amount_usdg) VALUES(?, ?, ?, ?, ?, ?, ?)')
      .run(input.txHash, input.logIndex, input.positionId, input.blockNumber.toString(), input.timestampMs, input.type, input.amountUsdg)
  }

  getAccounting(positionId: string) {
    const rows = this.db.prepare('SELECT type, SUM(amount_usdg) AS total FROM cashflows WHERE position_id = ? GROUP BY type').all(positionId) as Array<{ type: string; total: number }>
    return rows.reduce(
      (acc, row) => {
        if (row.type === 'deposit') acc.depositedUsdg = row.total
        if (row.type === 'withdrawal') acc.withdrawnUsdg = row.total
        if (row.type === 'fee') acc.claimedFeesUsdg = row.total
        return acc
      },
      { depositedUsdg: 0, withdrawnUsdg: 0, claimedFeesUsdg: 0 },
    )
  }

  getToken(address: string) {
    return this.db.prepare('SELECT symbol, decimals FROM token_metadata WHERE address = ?').get(address.toLowerCase()) as { symbol: string; decimals: number } | undefined
  }

  setToken(address: string, symbol: string, decimals: number) {
    this.db.prepare('INSERT INTO token_metadata(address, symbol, decimals) VALUES(?, ?, ?) ON CONFLICT(address) DO UPDATE SET symbol = excluded.symbol, decimals = excluded.decimals').run(address.toLowerCase(), symbol, decimals)
  }
}

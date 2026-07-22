import Database from 'better-sqlite3'
import type { Database as DatabaseType } from 'better-sqlite3'
import type { RangeStatus } from '../types.js'
import type { AccountingStatus, PositionVersion } from '../types.js'

export interface StoredPositionStatus {
  positionId: string
  lastStatus?: RangeStatus
  outOfRangeSinceMs?: number
}

export interface StoredDiscordReportMessage {
  messageId: string
  messageKey: string
  kind: 'portfolio' | 'position'
  positionId?: string
  generation: string
  status: 'current' | 'stale'
  createdAtMs: number
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

      CREATE TABLE IF NOT EXISTS position_accounting (
        position_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        deposited_usdg REAL,
        withdrawn_usdg REAL,
        claimed_fees_usdg REAL,
        last_synced_block TEXT,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS position_cashflows_v2 (
        position_id TEXT NOT NULL,
        tx_hash TEXT NOT NULL,
        log_index INTEGER NOT NULL,
        block_number TEXT NOT NULL,
        timestamp_ms INTEGER NOT NULL,
        type TEXT NOT NULL,
        token0_raw TEXT NOT NULL,
        token1_raw TEXT NOT NULL,
        value_usdg REAL NOT NULL,
        PRIMARY KEY (position_id, tx_hash, log_index, type)
      );

      CREATE TABLE IF NOT EXISTS discord_report_messages (
        message_id TEXT PRIMARY KEY,
        message_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        position_id TEXT,
        generation TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS discord_report_messages_status_idx
        ON discord_report_messages(status);
    `)
  }

  listDiscordReportMessages(status?: StoredDiscordReportMessage['status']): StoredDiscordReportMessage[] {
    const rows = (status
      ? this.db.prepare('SELECT message_id, message_key, kind, position_id, generation, status, created_at_ms FROM discord_report_messages WHERE status = ? ORDER BY created_at_ms DESC').all(status)
      : this.db.prepare('SELECT message_id, message_key, kind, position_id, generation, status, created_at_ms FROM discord_report_messages ORDER BY created_at_ms DESC').all()) as Array<{
        message_id: string
        message_key: string
        kind: StoredDiscordReportMessage['kind']
        position_id: string | null
        generation: string
        status: StoredDiscordReportMessage['status']
        created_at_ms: number
      }>
    return rows.map((row) => ({
      messageId: row.message_id,
      messageKey: row.message_key,
      kind: row.kind,
      positionId: row.position_id ?? undefined,
      generation: row.generation,
      status: row.status,
      createdAtMs: row.created_at_ms,
    }))
  }

  seedDiscordReportMessages(messages: StoredDiscordReportMessage[]) {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO discord_report_messages(message_id, message_key, kind, position_id, generation, status, created_at_ms)
      VALUES(?, ?, ?, ?, ?, ?, ?)
    `)
    this.db.transaction(() => {
      for (const message of messages) {
        insert.run(message.messageId, message.messageKey, message.kind, message.positionId ?? null, message.generation, message.status, message.createdAtMs)
      }
    })()
  }

  activateDiscordReportGeneration(messages: StoredDiscordReportMessage[]) {
    const markStale = this.db.prepare("UPDATE discord_report_messages SET status = 'stale' WHERE status = 'current'")
    const insert = this.db.prepare(`
      INSERT INTO discord_report_messages(message_id, message_key, kind, position_id, generation, status, created_at_ms)
      VALUES(?, ?, ?, ?, ?, ?, ?)
    `)
    this.db.transaction(() => {
      markStale.run()
      for (const message of messages) {
        insert.run(message.messageId, message.messageKey, message.kind, message.positionId ?? null, message.generation, 'current', message.createdAtMs)
      }
    })()
  }

  deleteDiscordReportMessage(messageId: string) {
    this.db.prepare('DELETE FROM discord_report_messages WHERE message_id = ?').run(messageId)
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

  listPositions(): Array<{ positionId: string; version: PositionVersion; manager: string; tokenId: bigint; mintTimestampMs?: number; mintBlock?: bigint }> {
    const rows = this.db.prepare('SELECT position_id, version, manager, token_id, mint_timestamp_ms, mint_block FROM positions').all() as Array<{
      position_id: string
      version: PositionVersion
      manager: string
      token_id: string
      mint_timestamp_ms: number | null
      mint_block: string | null
    }>
    return rows.map((row) => ({
      positionId: row.position_id,
      version: row.version,
      manager: row.manager,
      tokenId: BigInt(row.token_id),
      mintTimestampMs: row.mint_timestamp_ms ?? undefined,
      mintBlock: row.mint_block ? BigInt(row.mint_block) : undefined,
    }))
  }

  getPosition(positionId: string) {
    return this.listPositions().find((position) => position.positionId === positionId)
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
    const row = this.db.prepare('SELECT status, deposited_usdg, withdrawn_usdg, claimed_fees_usdg, last_synced_block, error FROM position_accounting WHERE position_id = ?').get(positionId) as
      | { status: AccountingStatus; deposited_usdg: number | null; withdrawn_usdg: number | null; claimed_fees_usdg: number | null; last_synced_block: string | null; error: string | null }
      | undefined
    return {
      status: row?.status ?? ('syncing' as const),
      depositedUsdg: row?.deposited_usdg ?? null,
      withdrawnUsdg: row?.withdrawn_usdg ?? null,
      claimedFeesUsdg: row?.claimed_fees_usdg ?? null,
      lastSyncedBlock: row?.last_synced_block ? BigInt(row.last_synced_block) : undefined,
      error: row?.error ?? undefined,
    }
  }


  setAccounting(input: { positionId: string; status: AccountingStatus; depositedUsdg: number | null; withdrawnUsdg: number | null; claimedFeesUsdg: number | null; lastSyncedBlock?: bigint; error?: string }) {
    this.db
      .prepare(`
        INSERT INTO position_accounting(position_id, status, deposited_usdg, withdrawn_usdg, claimed_fees_usdg, last_synced_block, error)
        VALUES(?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(position_id) DO UPDATE SET
          status = excluded.status,
          deposited_usdg = excluded.deposited_usdg,
          withdrawn_usdg = excluded.withdrawn_usdg,
          claimed_fees_usdg = excluded.claimed_fees_usdg,
          last_synced_block = excluded.last_synced_block,
          error = excluded.error
      `)
      .run(input.positionId, input.status, input.depositedUsdg, input.withdrawnUsdg, input.claimedFeesUsdg, input.lastSyncedBlock?.toString() ?? null, input.error ?? null)
  }

  insertPositionCashflow(input: { positionId: string; txHash: string; logIndex: number; blockNumber: bigint; timestampMs: number; type: 'deposit' | 'withdrawal' | 'fee' | 'decrease' | 'principal_collect'; token0Raw: bigint; token1Raw: bigint; valueUsdg: number }) {
    this.db
      .prepare('INSERT OR IGNORE INTO position_cashflows_v2(position_id, tx_hash, log_index, block_number, timestamp_ms, type, token0_raw, token1_raw, value_usdg) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(input.positionId, input.txHash, input.logIndex, input.blockNumber.toString(), input.timestampMs, input.type, input.token0Raw.toString(), input.token1Raw.toString(), input.valueUsdg)
  }

  getPositionCashflowTotals(positionId: string) {
    const rows = this.db.prepare('SELECT type, SUM(value_usdg) AS total FROM position_cashflows_v2 WHERE position_id = ? GROUP BY type').all(positionId) as Array<{ type: string; total: number }>
    const totals = { depositedUsdg: 0, withdrawnUsdg: 0, claimedFeesUsdg: 0 }
    for (const row of rows) {
      if (row.type === 'deposit') totals.depositedUsdg = row.total
      if (row.type === 'withdrawal') totals.withdrawnUsdg = row.total
      if (row.type === 'fee') totals.claimedFeesUsdg = row.total
    }
    return totals
  }

  getPendingPrincipal(positionId: string): [bigint, bigint] {
    const rows = this.db.prepare("SELECT type, token0_raw, token1_raw FROM position_cashflows_v2 WHERE position_id = ? AND type IN ('decrease', 'principal_collect')").all(positionId) as Array<{ type: string; token0_raw: string; token1_raw: string }>
    let amount0 = 0n
    let amount1 = 0n
    for (const row of rows) {
      const sign = row.type === 'decrease' ? 1n : -1n
      amount0 += sign * BigInt(row.token0_raw)
      amount1 += sign * BigInt(row.token1_raw)
    }
    return [amount0 > 0n ? amount0 : 0n, amount1 > 0n ? amount1 : 0n]
  }

  getToken(address: string) {
    return this.db.prepare('SELECT symbol, decimals FROM token_metadata WHERE address = ?').get(address.toLowerCase()) as { symbol: string; decimals: number } | undefined
  }

  setToken(address: string, symbol: string, decimals: number) {
    this.db.prepare('INSERT INTO token_metadata(address, symbol, decimals) VALUES(?, ?, ?) ON CONFLICT(address) DO UPDATE SET symbol = excluded.symbol, decimals = excluded.decimals').run(address.toLowerCase(), symbol, decimals)
  }
}

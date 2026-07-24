import { createClient, type Client, type InValue, type Row } from '@libsql/client'
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

export interface StoredReferencePool {
  key: string
  version: 'v3'
  poolAddress: string
  token0Address: string
  token1Address: string
  feeTier: number
  liquidity: bigint
  discoveredBlock: bigint
  refreshedAtMs: number
}

export interface StoredPositionCashflow {
  blockNumber: bigint
  logIndex: number
  type: 'deposit' | 'withdrawal' | 'fee'
  token0Raw: bigint
  token1Raw: bigint
}

export class StateDatabase {
  readonly db: Client

  constructor(path: string) {
    this.db = createClient({ url: toLibsqlUrl(path) })
  }

  close() {
    this.db.close()
  }

  async initialize() {
    await this.db.executeMultiple(`
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

      CREATE TABLE IF NOT EXISTS reference_pools (
        pool_key TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        pool_address TEXT NOT NULL,
        token0_address TEXT NOT NULL,
        token1_address TEXT NOT NULL,
        fee_tier INTEGER NOT NULL,
        liquidity TEXT NOT NULL,
        discovered_block TEXT NOT NULL,
        refreshed_at_ms INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS reference_pools_pair_idx
        ON reference_pools(token0_address, token1_address);
    `)
  }

  async listDiscordReportMessages(status?: StoredDiscordReportMessage['status']): Promise<StoredDiscordReportMessage[]> {
    const result = await this.db.execute(status
      ? { sql: 'SELECT message_id, message_key, kind, position_id, generation, status, created_at_ms FROM discord_report_messages WHERE status = ? ORDER BY created_at_ms DESC', args: [status] }
      : 'SELECT message_id, message_key, kind, position_id, generation, status, created_at_ms FROM discord_report_messages ORDER BY created_at_ms DESC')
    const rows = result.rows
    return rows.map((row) => ({
      messageId: String(row.message_id),
      messageKey: String(row.message_key),
      kind: String(row.kind) as StoredDiscordReportMessage['kind'],
      positionId: row.position_id == null ? undefined : String(row.position_id),
      generation: String(row.generation),
      status: String(row.status) as StoredDiscordReportMessage['status'],
      createdAtMs: Number(row.created_at_ms),
    }))
  }

  async seedDiscordReportMessages(messages: StoredDiscordReportMessage[]) {
    if (messages.length === 0) return
    await this.db.batch(messages.map((message) => statement(
      'INSERT OR IGNORE INTO discord_report_messages(message_id, message_key, kind, position_id, generation, status, created_at_ms) VALUES(?, ?, ?, ?, ?, ?, ?)',
      message.messageId, message.messageKey, message.kind, message.positionId ?? null, message.generation, message.status, message.createdAtMs,
    )), 'write')
  }

  async activateDiscordReportGeneration(messages: StoredDiscordReportMessage[]) {
    await this.db.batch([
      { sql: "UPDATE discord_report_messages SET status = 'stale' WHERE status = 'current'", args: [] },
      ...messages.map((message) => statement(
        'INSERT INTO discord_report_messages(message_id, message_key, kind, position_id, generation, status, created_at_ms) VALUES(?, ?, ?, ?, ?, ?, ?)',
        message.messageId, message.messageKey, message.kind, message.positionId ?? null, message.generation, 'current', message.createdAtMs,
      )),
    ], 'write')
  }

  async deleteDiscordReportMessage(messageId: string) {
    await this.execute('DELETE FROM discord_report_messages WHERE message_id = ?', messageId)
  }

  async getSyncBlock(key: string): Promise<bigint | undefined> {
    const row = await this.first('SELECT value FROM sync_state WHERE key = ?', key)
    return row ? BigInt(String(row.value)) : undefined
  }

  async setSyncBlock(key: string, blockNumber: bigint) {
    await this.execute('INSERT INTO sync_state(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, blockNumber.toString())
  }

  async upsertPosition(input: { positionId: string; version: string; manager: string; tokenId: bigint; mintTimestampMs?: number; mintBlock?: bigint }) {
    await this.execute(`
        INSERT INTO positions(position_id, version, manager, token_id, mint_timestamp_ms, mint_block)
        VALUES(?, ?, ?, ?, ?, ?)
        ON CONFLICT(position_id) DO UPDATE SET
          mint_timestamp_ms = COALESCE(excluded.mint_timestamp_ms, positions.mint_timestamp_ms),
          mint_block = COALESCE(excluded.mint_block, positions.mint_block)
      `, input.positionId, input.version, input.manager, input.tokenId.toString(), input.mintTimestampMs ?? null, input.mintBlock?.toString() ?? null)
  }

  async listPositions(): Promise<Array<{ positionId: string; version: PositionVersion; manager: string; tokenId: bigint; mintTimestampMs?: number; mintBlock?: bigint }>> {
    const rows = (await this.db.execute('SELECT position_id, version, manager, token_id, mint_timestamp_ms, mint_block FROM positions')).rows
    return rows.map((row) => ({
      positionId: String(row.position_id),
      version: String(row.version) as PositionVersion,
      manager: String(row.manager),
      tokenId: BigInt(String(row.token_id)),
      mintTimestampMs: row.mint_timestamp_ms == null ? undefined : Number(row.mint_timestamp_ms),
      mintBlock: row.mint_block == null ? undefined : BigInt(String(row.mint_block)),
    }))
  }

  async getPosition(positionId: string) {
    return (await this.listPositions()).find((position) => position.positionId === positionId)
  }

  async getMintTimestamp(positionId: string): Promise<number | undefined> {
    const row = await this.first('SELECT mint_timestamp_ms FROM positions WHERE position_id = ?', positionId)
    return row?.mint_timestamp_ms == null ? undefined : Number(row.mint_timestamp_ms)
  }

  async getPositionStatus(positionId: string): Promise<StoredPositionStatus> {
    const row = await this.first('SELECT last_status, out_of_range_since_ms FROM position_status WHERE position_id = ?', positionId)
    return { positionId, lastStatus: row?.last_status == null ? undefined : String(row.last_status) as RangeStatus, outOfRangeSinceMs: row?.out_of_range_since_ms == null ? undefined : Number(row.out_of_range_since_ms) }
  }

  async setPositionStatus(positionId: string, status: RangeStatus, outOfRangeSinceMs?: number) {
    await this.execute('INSERT INTO position_status(position_id, last_status, out_of_range_since_ms) VALUES(?, ?, ?) ON CONFLICT(position_id) DO UPDATE SET last_status = excluded.last_status, out_of_range_since_ms = excluded.out_of_range_since_ms', positionId, status, outOfRangeSinceMs ?? null)
  }

  async insertCashflow(input: { txHash: string; logIndex: number; positionId: string; blockNumber: bigint; timestampMs: number; type: string; amountUsdg: number }) {
    await this.execute('INSERT OR IGNORE INTO cashflows(tx_hash, log_index, position_id, block_number, timestamp_ms, type, amount_usdg) VALUES(?, ?, ?, ?, ?, ?, ?)', input.txHash, input.logIndex, input.positionId, input.blockNumber.toString(), input.timestampMs, input.type, input.amountUsdg)
  }

  async getAccounting(positionId: string) {
    const row = await this.first('SELECT status, deposited_usdg, withdrawn_usdg, claimed_fees_usdg, last_synced_block, error FROM position_accounting WHERE position_id = ?', positionId)
    return {
      status: row?.status == null ? ('syncing' as const) : String(row.status) as AccountingStatus,
      depositedUsdg: row?.deposited_usdg == null ? null : Number(row.deposited_usdg),
      withdrawnUsdg: row?.withdrawn_usdg == null ? null : Number(row.withdrawn_usdg),
      claimedFeesUsdg: row?.claimed_fees_usdg == null ? null : Number(row.claimed_fees_usdg),
      lastSyncedBlock: row?.last_synced_block == null ? undefined : BigInt(String(row.last_synced_block)),
      error: row?.error == null ? undefined : String(row.error),
    }
  }


  async setAccounting(input: { positionId: string; status: AccountingStatus; depositedUsdg: number | null; withdrawnUsdg: number | null; claimedFeesUsdg: number | null; lastSyncedBlock?: bigint; error?: string }) {
    await this.execute(`
        INSERT INTO position_accounting(position_id, status, deposited_usdg, withdrawn_usdg, claimed_fees_usdg, last_synced_block, error)
        VALUES(?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(position_id) DO UPDATE SET
          status = excluded.status,
          deposited_usdg = excluded.deposited_usdg,
          withdrawn_usdg = excluded.withdrawn_usdg,
          claimed_fees_usdg = excluded.claimed_fees_usdg,
          last_synced_block = excluded.last_synced_block,
          error = excluded.error
      `, input.positionId, input.status, input.depositedUsdg, input.withdrawnUsdg, input.claimedFeesUsdg, input.lastSyncedBlock?.toString() ?? null, input.error ?? null)
  }

  async insertPositionCashflow(input: { positionId: string; txHash: string; logIndex: number; blockNumber: bigint; timestampMs: number; type: 'deposit' | 'withdrawal' | 'fee' | 'decrease' | 'principal_collect'; token0Raw: bigint; token1Raw: bigint; valueUsdg: number }) {
    await this.execute('INSERT OR IGNORE INTO position_cashflows_v2(position_id, tx_hash, log_index, block_number, timestamp_ms, type, token0_raw, token1_raw, value_usdg) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)', input.positionId, input.txHash, input.logIndex, input.blockNumber.toString(), input.timestampMs, input.type, input.token0Raw.toString(), input.token1Raw.toString(), input.valueUsdg)
  }

  async getPositionCashflowTotals(positionId: string) {
    const rows = (await this.db.execute({ sql: 'SELECT type, SUM(value_usdg) AS total FROM position_cashflows_v2 WHERE position_id = ? GROUP BY type', args: [positionId] })).rows
    const totals = { depositedUsdg: 0, withdrawnUsdg: 0, claimedFeesUsdg: 0 }
    for (const row of rows) {
      if (row.type === 'deposit') totals.depositedUsdg = Number(row.total)
      if (row.type === 'withdrawal') totals.withdrawnUsdg = Number(row.total)
      if (row.type === 'fee') totals.claimedFeesUsdg = Number(row.total)
    }
    return totals
  }

  async listPositionCashflows(positionId: string): Promise<StoredPositionCashflow[]> {
    const rows = (await this.db.execute({
      sql: `
        SELECT block_number, log_index, type, token0_raw, token1_raw
        FROM position_cashflows_v2
        WHERE position_id = ? AND type IN ('deposit', 'withdrawal', 'fee')
        ORDER BY CAST(block_number AS INTEGER), log_index,
          CASE type WHEN 'deposit' THEN 0 WHEN 'withdrawal' THEN 1 ELSE 2 END
      `,
      args: [positionId],
    })).rows
    return rows.map((row) => ({
      blockNumber: BigInt(String(row.block_number)),
      logIndex: Number(row.log_index),
      type: String(row.type) as StoredPositionCashflow['type'],
      token0Raw: BigInt(String(row.token0_raw)),
      token1Raw: BigInt(String(row.token1_raw)),
    }))
  }

  async getPendingPrincipal(positionId: string): Promise<[bigint, bigint]> {
    const rows = (await this.db.execute({ sql: "SELECT type, token0_raw, token1_raw FROM position_cashflows_v2 WHERE position_id = ? AND type IN ('decrease', 'principal_collect')", args: [positionId] })).rows
    let amount0 = 0n
    let amount1 = 0n
    for (const row of rows) {
      const sign = row.type === 'decrease' ? 1n : -1n
      amount0 += sign * BigInt(String(row.token0_raw))
      amount1 += sign * BigInt(String(row.token1_raw))
    }
    return [amount0 > 0n ? amount0 : 0n, amount1 > 0n ? amount1 : 0n]
  }

  async getToken(address: string) {
    const row = await this.first('SELECT symbol, decimals FROM token_metadata WHERE address = ?', address.toLowerCase())
    return row ? { symbol: String(row.symbol), decimals: Number(row.decimals) } : undefined
  }

  async setToken(address: string, symbol: string, decimals: number) {
    await this.execute('INSERT INTO token_metadata(address, symbol, decimals) VALUES(?, ?, ?) ON CONFLICT(address) DO UPDATE SET symbol = excluded.symbol, decimals = excluded.decimals', address.toLowerCase(), symbol, decimals)
  }

  async listReferencePools(): Promise<StoredReferencePool[]> {
    const rows = (await this.db.execute('SELECT pool_key, version, pool_address, token0_address, token1_address, fee_tier, liquidity, discovered_block, refreshed_at_ms FROM reference_pools')).rows
    return rows.map((row) => ({
      key: String(row.pool_key),
      version: String(row.version) as 'v3',
      poolAddress: String(row.pool_address),
      token0Address: String(row.token0_address),
      token1Address: String(row.token1_address),
      feeTier: Number(row.fee_tier),
      liquidity: BigInt(String(row.liquidity)),
      discoveredBlock: BigInt(String(row.discovered_block)),
      refreshedAtMs: Number(row.refreshed_at_ms),
    }))
  }

  async upsertReferencePool(pool: StoredReferencePool) {
    await this.execute(`
      INSERT INTO reference_pools(pool_key, version, pool_address, token0_address, token1_address, fee_tier, liquidity, discovered_block, refreshed_at_ms)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pool_key) DO UPDATE SET
        liquidity = excluded.liquidity,
        refreshed_at_ms = excluded.refreshed_at_ms
    `, pool.key, pool.version, pool.poolAddress.toLowerCase(), pool.token0Address.toLowerCase(), pool.token1Address.toLowerCase(),
    pool.feeTier, pool.liquidity.toString(), pool.discoveredBlock.toString(), pool.refreshedAtMs)
  }

  private async execute(sql: string, ...args: InValue[]) {
    return this.db.execute({ sql, args })
  }

  private async first(sql: string, ...args: InValue[]): Promise<Row | undefined> {
    return (await this.execute(sql, ...args)).rows[0]
  }
}

function statement(sql: string, ...args: InValue[]) {
  return { sql, args }
}

function toLibsqlUrl(path: string) {
  if (path === ':memory:') return ':memory:'
  if (/^(file|libsql|https?):/.test(path)) return path
  return `file:${path.replaceAll('\\', '/')}`
}

import { afterEach, describe, expect, it } from 'vitest'
import { StateDatabase } from '../src/state/database.js'

const databases: StateDatabase[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('state database migrations', () => {
  it('caches discovered positions and nullable accounting status', async () => {
    const database = new StateDatabase(':memory:')
    databases.push(database)
    await database.initialize()
    await database.upsertPosition({ positionId: 'v4:manager:1', version: 'v4', manager: 'manager', tokenId: 1n, mintBlock: 10n, mintTimestampMs: 20 })
    expect((await database.listPositions())[0]).toMatchObject({ positionId: 'v4:manager:1', tokenId: 1n, mintBlock: 10n, mintTimestampMs: 20 })
    expect(await database.getAccounting('v4:manager:1')).toMatchObject({ status: 'syncing', depositedUsdg: null })
    await database.setAccounting({ positionId: 'v4:manager:1', status: 'unavailable', depositedUsdg: null, withdrawnUsdg: null, claimedFeesUsdg: null, error: 'archive unavailable' })
    expect(await database.getAccounting('v4:manager:1')).toMatchObject({ status: 'unavailable', error: 'archive unavailable' })
  })

  it('deduplicates raw cashflows across repeated syncs', async () => {
    const database = new StateDatabase(':memory:')
    databases.push(database)
    const cashflow = { positionId: 'v4:manager:1', txHash: '0x01', logIndex: 1, blockNumber: 10n, timestampMs: 20, type: 'deposit' as const, token0Raw: 1n, token1Raw: 2n, valueUsdg: 30 }
    await database.initialize()
    await database.insertPositionCashflow(cashflow)
    await database.insertPositionCashflow(cashflow)
    expect((await database.getPositionCashflowTotals(cashflow.positionId)).depositedUsdg).toBe(30)
    expect(await database.listPositionCashflows(cashflow.positionId)).toEqual([{
      blockNumber: 10n,
      logIndex: 1,
      type: 'deposit',
      token0Raw: 1n,
      token1Raw: 2n,
    }])
  })

  it('commits a completed block with cashflows and accounting totals atomically', async () => {
    const database = new StateDatabase(':memory:')
    databases.push(database)
    await database.initialize()
    const deposit = { positionId: 'v4:manager:1', txHash: '0x01', logIndex: 1, blockNumber: 10n, timestampMs: 20, type: 'deposit' as const, token0Raw: 1n, token1Raw: 2n, valueUsdg: 30 }

    await database.commitAccountingBlock({
      positionId: deposit.positionId,
      blockNumber: 10n,
      status: 'partial',
      cashflows: [deposit],
    })

    expect(await database.getAccounting(deposit.positionId)).toMatchObject({
      status: 'partial',
      depositedUsdg: 30,
      withdrawnUsdg: 0,
      claimedFeesUsdg: 0,
      lastSyncedBlock: 10n,
    })
    expect(await database.listPositionCashflows(deposit.positionId)).toHaveLength(1)
  })

  it('preserves checkpoint and totals when a later accounting attempt fails', async () => {
    const database = new StateDatabase(':memory:')
    databases.push(database)
    await database.initialize()
    const deposit = { positionId: 'v4:manager:1', txHash: '0x01', logIndex: 1, blockNumber: 10n, timestampMs: 20, type: 'deposit' as const, token0Raw: 1n, token1Raw: 2n, valueUsdg: 30 }
    await database.commitAccountingBlock({ positionId: deposit.positionId, blockNumber: 10n, status: 'partial', cashflows: [deposit] })

    await database.markAccountingFailure(deposit.positionId, 'archive unavailable at block 11')

    expect(await database.getAccounting(deposit.positionId)).toMatchObject({
      status: 'partial',
      depositedUsdg: 30,
      lastSyncedBlock: 10n,
      error: 'archive unavailable at block 11',
    })
    expect(await database.listPositionCashflows(deposit.positionId)).toHaveLength(1)
  })

  it('keeps first-pass failures unavailable without inventing a checkpoint', async () => {
    const database = new StateDatabase(':memory:')
    databases.push(database)
    await database.initialize()

    await database.markAccountingFailure('v4:manager:1', 'archive unavailable')

    expect(await database.getAccounting('v4:manager:1')).toMatchObject({
      status: 'unavailable',
      depositedUsdg: null,
      lastSyncedBlock: undefined,
      error: 'archive unavailable',
    })
  })

  it('does not duplicate a block batch when it is committed again', async () => {
    const database = new StateDatabase(':memory:')
    databases.push(database)
    await database.initialize()
    const deposit = { positionId: 'v4:manager:1', txHash: '0x01', logIndex: 1, blockNumber: 10n, timestampMs: 20, type: 'deposit' as const, token0Raw: 1n, token1Raw: 2n, valueUsdg: 30 }
    const commit = () => database.commitAccountingBlock({ positionId: deposit.positionId, blockNumber: 10n, status: 'partial' as const, cashflows: [deposit] })

    await commit()
    await commit()

    expect((await database.getPositionCashflowTotals(deposit.positionId)).depositedUsdg).toBe(30)
    expect(await database.listPositionCashflows(deposit.positionId)).toHaveLength(1)
  })

  it('never moves an accounting checkpoint backwards', async () => {
    const database = new StateDatabase(':memory:')
    databases.push(database)
    await database.initialize()
    await database.commitAccountingBlock({ positionId: 'v4:manager:1', blockNumber: 20n, status: 'synced' })
    await database.commitAccountingBlock({ positionId: 'v4:manager:1', blockNumber: 10n, status: 'partial', error: 'stale writer' })

    expect(await database.getAccounting('v4:manager:1')).toMatchObject({
      status: 'synced',
      lastSyncedBlock: 20n,
      error: undefined,
    })
  })

  it('allows only one accounting lease owner and permits takeover after expiry', async () => {
    const database = new StateDatabase(':memory:')
    databases.push(database)
    await database.initialize()

    expect(await database.acquireAccountingLease('v4:manager:1', 'owner-a', 1_000)).toBe(true)
    expect(await database.acquireAccountingLease('v4:manager:1', 'owner-b', 1_001)).toBe(false)
    expect(await database.acquireAccountingLease('v4:manager:1', 'owner-b', 301_001)).toBe(true)
    await database.releaseAccountingLease('v4:manager:1', 'owner-a')
    expect(await database.acquireAccountingLease('v4:manager:1', 'owner-c', 301_002)).toBe(false)
    await database.releaseAccountingLease('v4:manager:1', 'owner-b')
    expect(await database.acquireAccountingLease('v4:manager:1', 'owner-c', 301_003)).toBe(true)
  })

  it('scopes cached position discovery candidates by wallet', async () => {
    const database = new StateDatabase(':memory:')
    databases.push(database)
    await database.initialize()
    await database.upsertPosition({ positionId: 'v4:manager:1', version: 'v4', manager: 'manager', tokenId: 1n })
    await database.upsertPosition({ positionId: 'v4:manager:2', version: 'v4', manager: 'manager', tokenId: 2n })
    await database.linkWalletPosition('0xwallet-a', 'v4:manager:1', 1)
    await database.linkWalletPosition('0xwallet-b', 'v4:manager:2', 1)

    expect((await database.listPositionsForWallet('0xWALLET-A')).map((position) => position.positionId)).toEqual(['v4:manager:1'])
    expect((await database.listPositionsForWallet('0xwallet-b')).map((position) => position.positionId)).toEqual(['v4:manager:2'])
  })

  it('atomically activates a Discord report generation and retains stale messages for cleanup', async () => {
    const database = new StateDatabase(':memory:')
    databases.push(database)
    await database.initialize()
    await database.seedDiscordReportMessages([
      { messageId: 'old', messageKey: 'portfolio', kind: 'portfolio', generation: 'legacy', status: 'current', createdAtMs: 1 },
    ])

    await database.activateDiscordReportGeneration([
      { messageId: 'new', messageKey: 'portfolio', kind: 'portfolio', generation: 'generation-2', status: 'current', createdAtMs: 2 },
    ])

    expect((await database.listDiscordReportMessages('current')).map((message) => message.messageId)).toEqual(['new'])
    expect((await database.listDiscordReportMessages('stale')).map((message) => message.messageId)).toEqual(['old'])
    await database.deleteDiscordReportMessage('old')
    expect((await database.listDiscordReportMessages()).map((message) => message.messageId)).toEqual(['new'])
  })
})

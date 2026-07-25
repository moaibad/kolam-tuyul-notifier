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

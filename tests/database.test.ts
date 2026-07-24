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

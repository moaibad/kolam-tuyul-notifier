import { afterEach, describe, expect, it } from 'vitest'
import { StateDatabase } from '../src/state/database.js'

const databases: StateDatabase[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('state database migrations', () => {
  it('caches discovered positions and nullable accounting status', () => {
    const database = new StateDatabase(':memory:')
    databases.push(database)
    database.upsertPosition({ positionId: 'v4:manager:1', version: 'v4', manager: 'manager', tokenId: 1n, mintBlock: 10n, mintTimestampMs: 20 })
    expect(database.listPositions()[0]).toMatchObject({ positionId: 'v4:manager:1', tokenId: 1n, mintBlock: 10n, mintTimestampMs: 20 })
    expect(database.getAccounting('v4:manager:1')).toMatchObject({ status: 'syncing', depositedUsdg: null })
    database.setAccounting({ positionId: 'v4:manager:1', status: 'unavailable', depositedUsdg: null, withdrawnUsdg: null, claimedFeesUsdg: null, error: 'archive unavailable' })
    expect(database.getAccounting('v4:manager:1')).toMatchObject({ status: 'unavailable', error: 'archive unavailable' })
  })

  it('deduplicates raw cashflows across repeated syncs', () => {
    const database = new StateDatabase(':memory:')
    databases.push(database)
    const cashflow = { positionId: 'v4:manager:1', txHash: '0x01', logIndex: 1, blockNumber: 10n, timestampMs: 20, type: 'deposit' as const, token0Raw: 1n, token1Raw: 2n, valueUsdg: 30 }
    database.insertPositionCashflow(cashflow)
    database.insertPositionCashflow(cashflow)
    expect(database.getPositionCashflowTotals(cashflow.positionId).depositedUsdg).toBe(30)
  })

  it('atomically activates a Discord report generation and retains stale messages for cleanup', () => {
    const database = new StateDatabase(':memory:')
    databases.push(database)
    database.seedDiscordReportMessages([
      { messageId: 'old', messageKey: 'portfolio', kind: 'portfolio', generation: 'legacy', status: 'current', createdAtMs: 1 },
    ])

    database.activateDiscordReportGeneration([
      { messageId: 'new', messageKey: 'portfolio', kind: 'portfolio', generation: 'generation-2', status: 'current', createdAtMs: 2 },
    ])

    expect(database.listDiscordReportMessages('current').map((message) => message.messageId)).toEqual(['new'])
    expect(database.listDiscordReportMessages('stale').map((message) => message.messageId)).toEqual(['old'])
    database.deleteDiscordReportMessage('old')
    expect(database.listDiscordReportMessages().map((message) => message.messageId)).toEqual(['new'])
  })
})

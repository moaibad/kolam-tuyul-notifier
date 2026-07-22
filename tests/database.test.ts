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
})

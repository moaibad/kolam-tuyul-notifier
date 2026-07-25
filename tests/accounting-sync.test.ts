import { afterEach, describe, expect, it } from 'vitest'
import { getAddress } from 'viem'
import { StateDatabase } from '../src/state/database.js'
import { syncPositionAccounting } from '../src/uniswap/accounting-sync.js'

const databases: StateDatabase[] = []
const MANAGER = getAddress('0x0000000000000000000000000000000000000001')
const TOKEN0 = { address: getAddress('0x0000000000000000000000000000000000000002'), symbol: 'A', decimals: 0 }
const TOKEN1 = { address: getAddress('0x0000000000000000000000000000000000000003'), symbol: 'B', decimals: 0 }

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('resumable position accounting', () => {
  it('preserves a completed block and resumes from the following block', async () => {
    const database = new StateDatabase(':memory:')
    databases.push(database)
    await database.initialize()
    await database.upsertPosition({
      positionId: 'v3:manager:1',
      version: 'v3',
      manager: MANAGER,
      tokenId: 1n,
      mintBlock: 10n,
      mintTimestampMs: 1_000,
    })

    const requestedRanges: Array<[bigint, bigint]> = []
    const events = [
      increase(10n, '0x01', 1, 10n),
      increase(11n, '0x02', 2, 20n),
    ]
    const client = {
      getContractEvents: async (input: { eventName: string; fromBlock: bigint; toBlock: bigint }) => {
        if (input.eventName !== 'IncreaseLiquidity') return []
        requestedRanges.push([input.fromBlock, input.toBlock])
        return events.filter((event) => event.blockNumber >= input.fromBlock && event.blockNumber <= input.toBlock)
      },
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: blockNumber }),
    }
    let failAtBlock11 = true
    const oracle = {
      valueUsdg: async (_token: unknown, raw: bigint, blockNumber: bigint) => {
        if (failAtBlock11 && blockNumber === 11n) throw new Error('archive unavailable at block 11')
        return Number(raw)
      },
    }
    const data = {
      position: { version: 'v3' as const, manager: MANAGER, tokenId: 1n },
      id: 'v3:manager:1',
      token0: TOKEN0,
      token1: TOKEN1,
      feeTier: 3_000,
      tickLower: -60,
      tickUpper: 60,
      currentTick: 0,
      sqrtPriceX96: 2n ** 96n,
      liquidity: 1n,
      unclaimed0: 0n,
      unclaimed1: 0n,
      priceSource: { key: 'pool', token0: TOKEN0, token1: TOKEN1, currentTick: 0, readTickAt: async () => 0 },
    }
    const input = {
      client: client as never,
      db: database,
      data,
      oracle: oracle as never,
      deployments: { warnMissingV3: false },
      blockNumber: 12n,
    }

    await syncPositionAccounting(input)
    expect(await database.getAccounting(data.id)).toMatchObject({
      status: 'partial',
      depositedUsdg: 20,
      lastSyncedBlock: 10n,
      error: 'archive unavailable at block 11',
    })

    failAtBlock11 = false
    requestedRanges.length = 0
    await syncPositionAccounting(input)

    expect(requestedRanges).toContainEqual([11n, 12n])
    expect(await database.getAccounting(data.id)).toMatchObject({
      status: 'synced',
      depositedUsdg: 60,
      lastSyncedBlock: 12n,
      error: undefined,
    })
    expect(await database.listPositionCashflows(data.id)).toHaveLength(2)
  })
})

function increase(blockNumber: bigint, transactionHash: string, logIndex: number, amount: bigint) {
  return {
    blockNumber,
    transactionHash,
    logIndex,
    args: { amount0: amount, amount1: amount },
  }
}

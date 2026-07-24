import { getAddress, zeroAddress, type Address, type PublicClient } from 'viem'
import type { DeploymentAddresses } from '../contracts.js'
import { v3FactoryAbi, v3PoolAbi } from '../contracts.js'
import type { StateDatabase, StoredReferencePool } from '../state/database.js'
import type { TokenInfo } from '../types.js'
import type { PoolPriceSource } from './price-oracle.js'
import { getTokenInfo, type PositionData } from './positions.js'

const V3_FEE_TIERS = [100, 500, 3_000, 10_000] as const

export async function discoverReferencePriceSources(input: {
  client: PublicClient
  db: StateDatabase
  deployments: DeploymentAddresses
  positions: PositionData[]
  usdgAddress: Address
  wethAddress: Address
  intermediateTokens: Address[]
  blockNumber: bigint
  cacheMs: number
  nowMs: number
}): Promise<PoolPriceSource[]> {
  if (!input.deployments.v3Factory) return []
  const tokens = uniqueTokens(input.positions.flatMap((position) => [normalizeNative(position.token0, input.wethAddress), normalizeNative(position.token1, input.wethAddress)]))
  const intermediates = uniqueAddresses([input.wethAddress, ...input.intermediateTokens])
  const pairs = uniquePairs([
    ...tokens.flatMap((token) => [[token.address, input.usdgAddress] as const]),
    ...tokens.flatMap((token) => intermediates.map((intermediate) => [token.address, intermediate] as const)),
    ...intermediates.map((intermediate) => [intermediate, input.usdgAddress] as const),
  ]).filter(([left, right]) => !same(left, right))

  const scanKey = `reference-pools:last-scan-ms:${pairs.map(([left, right]) => `${left.toLowerCase()}-${right.toLowerCase()}`).sort().join(',')}`
  const lastScanMs = await input.db.getSyncBlock(scanKey)
  const cacheFresh = lastScanMs != null && input.nowMs - Number(lastScanMs) < input.cacheMs
  if (!cacheFresh) {
    for (const [tokenA, tokenB] of pairs) {
      for (const feeTier of V3_FEE_TIERS) {
        const poolAddress = await input.client.readContract({
          address: input.deployments.v3Factory,
          abi: v3FactoryAbi,
          functionName: 'getPool',
          args: [tokenA, tokenB, feeTier],
        })
        if (poolAddress === zeroAddress) continue
        const liquidity = await input.client.readContract({ address: poolAddress, abi: v3PoolAbi, functionName: 'liquidity' })
        if (liquidity === 0n) continue
        const [token0Address, token1Address] = sortAddresses(tokenA, tokenB)
        await input.db.upsertReferencePool({
          key: `v3:${poolAddress.toLowerCase()}`,
          version: 'v3',
          poolAddress,
          token0Address,
          token1Address,
          feeTier,
          liquidity,
          discoveredBlock: input.blockNumber,
          refreshedAtMs: input.nowMs,
        })
      }
    }
    await input.db.setSyncBlock(scanKey, BigInt(input.nowMs))
  }

  const pools = (await input.db.listReferencePools()).filter((pool) =>
    pool.liquidity > 0n && pairs.some(([left, right]) => samePair(pool, left, right)),
  )
  return Promise.all(pools.map((pool) => makeSource(input.client, input.db, pool)))
}

async function makeSource(client: PublicClient, db: StateDatabase, pool: StoredReferencePool): Promise<PoolPriceSource> {
  const address = getAddress(pool.poolAddress)
  const [token0, token1, slot0] = await Promise.all([
    getTokenInfo(client, db, getAddress(pool.token0Address)),
    getTokenInfo(client, db, getAddress(pool.token1Address)),
    client.readContract({ address, abi: v3PoolAbi, functionName: 'slot0' }),
  ])
  return {
    key: pool.key,
    token0,
    token1,
    currentTick: slot0[1],
    liquidity: pool.liquidity,
    readTickAt: async (blockNumber) => {
      const historical = await client.readContract({ address, abi: v3PoolAbi, functionName: 'slot0', blockNumber })
      return historical[1]
    },
  }
}

function normalizeNative(token: TokenInfo, wethAddress: Address): TokenInfo {
  return token.address === zeroAddress ? { address: wethAddress, symbol: 'WETH', decimals: 18 } : token
}

function uniqueTokens(tokens: TokenInfo[]) {
  return [...new Map(tokens.map((token) => [token.address.toLowerCase(), token])).values()]
}

function uniqueAddresses(addresses: Address[]) {
  return [...new Map(addresses.map((address) => [address.toLowerCase(), address])).values()]
}

function uniquePairs(pairs: ReadonlyArray<readonly [Address, Address]>) {
  return [...new Map(pairs.map(([left, right]) => {
    const sorted = sortAddresses(left, right)
    return [`${sorted[0].toLowerCase()}:${sorted[1].toLowerCase()}`, sorted] as const
  })).values()]
}

function sortAddresses(left: Address, right: Address): [Address, Address] {
  return BigInt(left) < BigInt(right) ? [left, right] : [right, left]
}

function same(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase()
}

function samePair(pool: StoredReferencePool, left: Address, right: Address) {
  return (same(pool.token0Address, left) && same(pool.token1Address, right)) ||
    (same(pool.token0Address, right) && same(pool.token1Address, left))
}

import type { Address, PublicClient } from 'viem'
import { formatUnits, getAddress, zeroAddress } from 'viem'
import { erc20Abi, v3PositionManagerAbi, v4PositionManagerAbi, type DeploymentAddresses } from '../contracts.js'
import { explorerTokenUrl } from '../chain.js'
import type { PositionSnapshot, TokenInfo } from '../types.js'
import type { StateDatabase } from '../state/database.js'
import type { DiscoveredPosition } from './discovery.js'
import { calculatePositionResult } from './accounting.js'
import { formatTokenAmount, getRangeStatus, isUsdg, tickToPrice } from './valuation.js'

const nativeEth: TokenInfo = { address: zeroAddress, symbol: 'ETH', decimals: 18 }

export async function buildPositionSnapshot(input: {
  client: PublicClient
  db: StateDatabase
  position: DiscoveredPosition
  deployments: DeploymentAddresses
  walletAddress: Address
  usdgAddress?: Address
  blockNumber: bigint
  nowMs: number
}): Promise<PositionSnapshot | undefined> {
  if (input.position.version === 'v3') return buildV3Snapshot(input)
  return buildV4Snapshot(input)
}

async function buildV3Snapshot(input: Parameters<typeof buildPositionSnapshot>[0]): Promise<PositionSnapshot | undefined> {
  const raw = await input.client.readContract({ address: input.position.manager, abi: v3PositionManagerAbi, functionName: 'positions', args: [input.position.tokenId] })
  const token0 = await getTokenInfo(input.client, input.db, getAddress(raw[2]))
  const token1 = await getTokenInfo(input.client, input.db, getAddress(raw[3]))
  const liquidity = raw[7]
  if (liquidity === 0n) return undefined
  const currentTick = Math.trunc((Number(raw[5]) + Number(raw[6])) / 2)
  return commonSnapshot({ ...input, token0, token1, feeTier: raw[4], tickLower: raw[5], tickUpper: raw[6], currentTick, liquidity, unclaimed0: raw[10], unclaimed1: raw[11] })
}

async function buildV4Snapshot(input: Parameters<typeof buildPositionSnapshot>[0]): Promise<PositionSnapshot | undefined> {
  const [poolKey, info] = await input.client.readContract({ address: input.position.manager, abi: v4PositionManagerAbi, functionName: 'getPoolAndPositionInfo', args: [input.position.tokenId] })
  const liquidity = await input.client.readContract({ address: input.position.manager, abi: v4PositionManagerAbi, functionName: 'getPositionLiquidity', args: [input.position.tokenId] })
  if (liquidity === 0n) return undefined
  const token0 = await getTokenInfo(input.client, input.db, getAddress(poolKey.currency0))
  const token1 = await getTokenInfo(input.client, input.db, getAddress(poolKey.currency1))
  const decoded = decodeV4PositionInfo(info)
  const currentTick = Math.trunc((decoded.tickLower + decoded.tickUpper) / 2)
  return commonSnapshot({ ...input, token0, token1, feeTier: poolKey.fee, tickLower: decoded.tickLower, tickUpper: decoded.tickUpper, currentTick, liquidity, unclaimed0: 0n, unclaimed1: 0n })
}

function commonSnapshot(input: Parameters<typeof buildPositionSnapshot>[0] & { token0: TokenInfo; token1: TokenInfo; feeTier: number; tickLower: number; tickUpper: number; currentTick: number; liquidity: bigint; unclaimed0: bigint; unclaimed1: bigint }): PositionSnapshot {
  const positionId = `${input.position.version}:${input.position.manager.toLowerCase()}:${input.position.tokenId.toString()}`
  const mintTimestampMs = input.db.getMintTimestamp(positionId) ?? input.nowMs
  input.db.upsertPosition({ positionId, version: input.position.version, manager: input.position.manager, tokenId: input.position.tokenId, mintTimestampMs })

  const accounting = input.db.getAccounting(positionId)
  const currentPriceUsdg = inferPrice(input.token0, input.token1, input.currentTick, input.usdgAddress)
  const lowerPriceUsdg = inferPrice(input.token0, input.token1, input.tickLower, input.usdgAddress)
  const upperPriceUsdg = inferPrice(input.token0, input.token1, input.tickUpper, input.usdgAddress)
  const status = getRangeStatus(input.currentTick, input.tickLower, input.tickUpper)
  const previous = input.db.getPositionStatus(positionId)
  const outOfRangeSinceMs = status === 'out_of_range' ? previous.outOfRangeSinceMs ?? input.nowMs : undefined

  const amount0 = estimateDisplayAmount(input.liquidity, input.token0.decimals)
  const amount1 = estimateDisplayAmount(input.liquidity, input.token1.decimals)
  const value0 = valueAmount(input.token0, amount0.raw, currentPriceUsdg, input.usdgAddress)
  const value1 = valueAmount(input.token1, amount1.raw, currentPriceUsdg, input.usdgAddress)
  const currentLpValueUsdg = value0 + value1
  const unclaimedFeesUsdg = valueAmount(input.token0, input.unclaimed0, currentPriceUsdg, input.usdgAddress) + valueAmount(input.token1, input.unclaimed1, currentPriceUsdg, input.usdgAddress)
  const result = calculatePositionResult({ ...accounting, currentLpValueUsdg, unclaimedFeesUsdg })

  return {
    id: positionId,
    tokenId: input.position.tokenId,
    version: input.position.version,
    manager: input.position.manager,
    token0: input.token0,
    token1: input.token1,
    feeTier: input.feeTier,
    tickLower: input.tickLower,
    tickUpper: input.tickUpper,
    currentTick: input.currentTick,
    currentPriceUsdg,
    lowerPriceUsdg,
    upperPriceUsdg,
    liquidity: input.liquidity,
    status,
    outOfRangeSinceMs,
    mintTimestampMs,
    blockNumber: input.blockNumber,
    amounts: [
      { token: input.token0, raw: amount0.raw, formatted: amount0.formatted, valueUsdg: value0 },
      { token: input.token1, raw: amount1.raw, formatted: amount1.formatted, valueUsdg: value1 },
    ],
    currentLpValueUsdg,
    claimedFeesUsdg: accounting.claimedFeesUsdg,
    unclaimedFeesUsdg,
    depositedUsdg: accounting.depositedUsdg,
    withdrawnUsdg: accounting.withdrawnUsdg,
    totalResultUsdg: result.totalResultUsdg,
    profitLossUsdg: result.profitLossUsdg,
    profitLossPercent: result.profitLossPercent,
    uniswapUrl: `https://app.uniswap.org/portfolio/${input.walletAddress}`,
    explorerUrl: explorerTokenUrl(input.position.manager, input.position.tokenId),
  }
}

async function getTokenInfo(client: PublicClient, db: StateDatabase, address: Address): Promise<TokenInfo> {
  if (address === zeroAddress) return nativeEth
  const cached = db.getToken(address)
  if (cached) return { address, ...cached }
  const [symbol, decimals] = await Promise.all([
    client.readContract({ address, abi: erc20Abi, functionName: 'symbol' }),
    client.readContract({ address, abi: erc20Abi, functionName: 'decimals' }),
  ])
  db.setToken(address, symbol, decimals)
  return { address, symbol, decimals }
}

function inferPrice(token0: TokenInfo, token1: TokenInfo, tick: number, usdgAddress?: Address) {
  if (isUsdg(token1, usdgAddress)) return tickToPrice(tick, token0.decimals, token1.decimals)
  if (isUsdg(token0, usdgAddress)) return 1 / tickToPrice(tick, token0.decimals, token1.decimals)
  return 0
}

function estimateDisplayAmount(liquidity: bigint, decimals: number) {
  const raw = liquidity / 1_000_000n
  return { raw, formatted: formatTokenAmount(raw, decimals) }
}

function valueAmount(token: TokenInfo, raw: bigint, memePriceUsdg: number, usdgAddress?: Address) {
  const amount = Number(formatUnits(raw, token.decimals))
  if (isUsdg(token, usdgAddress)) return amount
  return amount * memePriceUsdg
}

function decodeV4PositionInfo(value: bigint) {
  const raw = (shift: bigint) => {
    const number = Number((value >> shift) & 0xffffffn)
    return number >= 0x800000 ? number - 0x1000000 : number
  }
  return { tickLower: raw(8n), tickUpper: raw(32n) }
}
